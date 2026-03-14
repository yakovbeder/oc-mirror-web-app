#!/bin/bash

# Application starter script for oc-mirror-web-app using pre-built images from Quay.io
# Automatically detects architecture and uses the appropriate image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Configuration
if [ -n "${IMAGE_NAME:-}" ]; then
    IMAGE_NAME_WAS_SET="true"
else
    IMAGE_NAME_WAS_SET="false"
    IMAGE_NAME="quay.io/rh-ee-ybeder/oc-mirror-web-app"
fi
CONTAINER_NAME="oc-mirror-web-app"
DEFAULT_WEB_PORT="3000"
CONTAINER_PORT="3001"
DATA_DIR="data"

if [ -n "${WEB_PORT:-}" ]; then
    WEB_PORT_WAS_SET="true"
else
    WEB_PORT_WAS_SET="false"
    WEB_PORT="$DEFAULT_WEB_PORT"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print functions
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Detect system architecture
detect_architecture() {
    SYSTEM_ARCH=$(uname -m)
    case $SYSTEM_ARCH in
        x86_64)
            ARCH="amd64"
            ARCH_NAME="AMD64 (x86_64)"
            ;;
        aarch64|arm64)
            ARCH="arm64"
            ARCH_NAME="ARM64 (aarch64)"
            ;;
        *)
            ARCH="amd64"  # Default to amd64 for unsupported architectures
            ARCH_NAME="$SYSTEM_ARCH (falling back to amd64)"
            print_warning "Architecture $SYSTEM_ARCH not directly supported, using amd64"
            ;;
    esac
    print_status "Detected architecture: $ARCH_NAME"
}

# Check container runtime
check_container_runtime() {
    if command -v podman &> /dev/null && podman info &> /dev/null; then
        CONTAINER_ENGINE="podman"
        print_success "Using Podman as container runtime"
    else
        print_error "Podman is not available or running."
        print_error "Please install Podman and try again."
        exit 1
    fi
    
    if ! $CONTAINER_ENGINE info &> /dev/null; then
        print_error "$CONTAINER_ENGINE is not running or you don't have permission to use it."
        print_error "Please start $CONTAINER_ENGINE and ensure you have proper permissions."
        exit 1
    fi
    
    print_success "$CONTAINER_ENGINE is available and running"
}

port_is_in_use() {
    local port="$1"

    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
        return $?
    fi

    if command -v nc >/dev/null 2>&1; then
        nc -z 127.0.0.1 "$port" >/dev/null 2>&1
        return $?
    fi

    return 1
}

find_available_port() {
    local candidate_port="$1"

    while port_is_in_use "$candidate_port"; do
        candidate_port=$((candidate_port + 1))

        if [ "$candidate_port" -gt 65535 ]; then
            return 1
        fi
    done

    echo "$candidate_port"
}

resolve_image_tag() {
    if [ "$IMAGE_NAME_WAS_SET" = "true" ] && $CONTAINER_ENGINE image exists "${IMAGE_NAME}:latest" 2>/dev/null; then
        echo "${IMAGE_NAME}:latest"
        return 0
    fi

    echo "${IMAGE_NAME}:latest-${ARCH}"
}

ensure_available_web_port() {
    if ! port_is_in_use "$WEB_PORT"; then
        return 0
    fi

    if [ "$WEB_PORT_WAS_SET" = "true" ]; then
        print_error "Requested WEB_PORT $WEB_PORT is already in use"
        print_error "Choose another port, for example: WEB_PORT=3002 ./start-app.sh --start"
        exit 1
    fi

    local replacement_port
    replacement_port="$(find_available_port "$((WEB_PORT + 1))")" || {
        print_error "Unable to find a free host port for the web UI"
        exit 1
    }

    print_warning "Host port $WEB_PORT is already in use. Using port $replacement_port instead."
    WEB_PORT="$replacement_port"
}

get_running_web_port() {
    if ! is_container_running; then
        return 1
    fi

    local published_port
    published_port="$($CONTAINER_ENGINE port "$CONTAINER_NAME" "$CONTAINER_PORT/tcp" 2>/dev/null | awk -F: 'NR==1 {print $NF}')"

    if [ -n "$published_port" ]; then
        echo "$published_port"
        return 0
    fi

    return 1
}

# Check if container is running
is_container_running() {
    $CONTAINER_ENGINE ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"
}

container_exists() {
    $CONTAINER_ENGINE ps -a --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"
}

# Stop container
stop_container() {
    print_status "Stopping container: $CONTAINER_NAME"
    
    # Try graceful stop first
    if $CONTAINER_ENGINE stop -t 30 $CONTAINER_NAME 2>/dev/null; then
        print_success "Container stopped gracefully"
    else
        # If graceful stop fails, try with shorter timeout and then force
        print_warning "Graceful stop failed, attempting force stop..."
        $CONTAINER_ENGINE stop -t 5 $CONTAINER_NAME 2>/dev/null || true
    fi
    
    # Remove container
    $CONTAINER_ENGINE rm $CONTAINER_NAME 2>/dev/null || true
    print_success "Container stopped and removed"
}

# Check pull secret
check_pull_secret() {
    local pull_secret_path="${SCRIPT_DIR}/pull-secret/pull-secret.json"

    if [ ! -s "${pull_secret_path}" ]; then
        print_error "Required pull secret not found at ${pull_secret_path}"
        print_error "Download it from https://console.redhat.com/openshift/downloads#tool-pull-secret"
        print_error "and save it to pull-secret/pull-secret.json before starting the app."
        exit 1
    fi

    print_success "Found pull secret at ${pull_secret_path}"
}

# Create data directories and ensure they are writable by both the host user and the container (UID 1000)
create_data_directories() {
    print_status "Ensuring data directories exist..."

    mkdir -p \
        "$DATA_DIR/configs" \
        "$DATA_DIR/operations" \
        "$DATA_DIR/logs" \
        "$DATA_DIR/cache" \
        "$DATA_DIR/mirrors/default" \
    2>/dev/null || {
        print_status "Fixing data/ permissions for directory creation..."
        chmod -R 777 "$DATA_DIR" 2>/dev/null || sudo chmod -R 777 "$DATA_DIR"
        mkdir -p \
            "$DATA_DIR/configs" \
            "$DATA_DIR/operations" \
            "$DATA_DIR/logs" \
            "$DATA_DIR/cache" \
            "$DATA_DIR/mirrors/default"
    }

    chmod -R 777 "$DATA_DIR" 2>/dev/null || sudo chmod -R 777 "$DATA_DIR" 2>/dev/null || true
    print_success "Data directories are ready"
}

# Pull image
pull_image() {
    local image_tag
    image_tag="$(resolve_image_tag)"

    if [ "$IMAGE_NAME_WAS_SET" = "true" ] && $CONTAINER_ENGINE image exists "$image_tag" 2>/dev/null; then
        print_success "Using local image (IMAGE_NAME override), skipping pull"
        return 0
    fi

    image_tag="${IMAGE_NAME}:latest-${ARCH}"
    print_status "Pulling image: $image_tag"
    
    $CONTAINER_ENGINE pull $image_tag
    
    if [ $? -eq 0 ]; then
        print_success "Image pulled successfully"
    else
        print_error "Failed to pull image. Please check your internet connection and Quay.io access."
        exit 1
    fi
}

# Run container
run_container() {
    local image_tag
    image_tag="$(resolve_image_tag)"

    local requested_port="$WEB_PORT"
    local bind_retry_limit=10
    local bind_attempt=1

    while [ "$bind_attempt" -le "$bind_retry_limit" ]; do
        local run_output

        print_status "Starting container: $CONTAINER_NAME"
        print_status "Image: $image_tag"
        print_status "Web UI: http://localhost:$WEB_PORT"
        print_status "API: http://localhost:$WEB_PORT/api"

        set +e
        run_output="$($CONTAINER_ENGINE run -d \
            --name "$CONTAINER_NAME" \
            -p "$WEB_PORT:$CONTAINER_PORT" \
            -v "$(pwd)/$DATA_DIR:/app/data:z" \
            -v "$(pwd)/pull-secret/pull-secret.json:/app/pull-secret.json:z" \
            -e NODE_ENV=production \
            -e PORT="$CONTAINER_PORT" \
            -e STORAGE_DIR=/app/data \
            -e OC_MIRROR_CACHE_DIR=/app/data/cache \
            -e OC_MIRROR_BASE_MIRROR_DIR=/app/data/mirrors \
            -e OC_MIRROR_AUTHFILE=/app/pull-secret.json \
            --restart unless-stopped \
            "$image_tag" 2>&1)"
        local run_status=$?
        set -e

        if [ "$run_status" -eq 0 ]; then
            echo "$run_output"
            print_success "Container started successfully"
            return 0
        fi

        if container_exists; then
            $CONTAINER_ENGINE rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
        fi

        if echo "$run_output" | grep -qiE 'address already in use|port is already allocated'; then
            if [ "$WEB_PORT_WAS_SET" = "true" ]; then
                print_error "Requested WEB_PORT $WEB_PORT is unavailable to Podman"
                print_error "Choose another port, for example: WEB_PORT=3002 ./start-app.sh --start"
                exit 1
            fi

            if [ "$bind_attempt" -eq "$bind_retry_limit" ]; then
                print_error "Failed to find a usable host port after $bind_retry_limit attempts starting at $requested_port"
                exit 1
            fi

            print_warning "Podman could not bind host port $WEB_PORT. Trying the next available port..."
            WEB_PORT="$(find_available_port "$((WEB_PORT + 1))")" || {
                print_error "Unable to find a free host port for the web UI"
                exit 1
            }
            bind_attempt=$((bind_attempt + 1))
            continue
        fi

        echo "$run_output"
        print_error "Failed to start container"
        exit 1
    done
}

# Show status
show_status() {
    if ! is_container_running; then
        print_warning "Application is not running"
        print_status "Start it with: ./start-app.sh --start"
        return 0
    fi

    local active_web_port
    active_web_port="$(get_running_web_port || true)"
    if [ -z "$active_web_port" ]; then
        active_web_port="$WEB_PORT"
    fi

    echo ""
    echo "=========================================="
    echo "  OC Mirror v2 Web Application"
    echo "=========================================="
    echo ""
    print_success "Application is running!"
    echo ""
    echo "🌐 Web Interface: http://localhost:$active_web_port"
    echo "🔧 API Server: http://localhost:$active_web_port/api (proxied through web interface)"
    echo ""
    echo "📁 Data Directory: $(pwd)/$DATA_DIR"
    echo "📦 Mirror Storage: $(pwd)/$DATA_DIR/mirrors/default → /app/data/mirrors/default (persistent)"
    echo "📋 Container Name: $CONTAINER_NAME"
    echo "🔧 Container Engine: $CONTAINER_ENGINE"
    echo "🏗️  System Architecture: $ARCH_NAME"
    echo ""
    echo "📊 Container Status:"
    $CONTAINER_ENGINE ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    echo "📝 Useful Commands:"
    echo "  View logs:     $CONTAINER_ENGINE logs -f $CONTAINER_NAME"
    echo "  Stop app:      $CONTAINER_ENGINE stop $CONTAINER_NAME"
    echo "  Remove app:    $CONTAINER_ENGINE rm $CONTAINER_NAME"
    echo "  Shell access:  $CONTAINER_ENGINE exec -it $CONTAINER_NAME /bin/sh"
    echo ""
}

# Show logs
show_logs() {
    if ! container_exists; then
        print_warning "Container '$CONTAINER_NAME' does not exist"
        return 0
    fi

    print_status "Container logs:"
    $CONTAINER_ENGINE logs -f $CONTAINER_NAME
}

# Parse command argument (only support --command format)
parse_command() {
    local cmd="${1:---start}"
    # Remove leading -- if present
    cmd="${cmd#--}"
    echo "$cmd"
}

# Main function
main() {
    local command=$(parse_command "${1:-start}")
    
    case "$command" in
        start)
            echo "=========================================="
            echo "  OC Mirror v2 Web Application"
            echo "  Application Starter"
            echo "=========================================="
            echo ""
            detect_architecture
            check_container_runtime
            check_pull_secret
            
            if is_container_running; then
                print_warning "Container is already running. Stopping it first..."
                stop_container
            elif container_exists; then
                print_warning "Removing stale container: $CONTAINER_NAME"
                $CONTAINER_ENGINE rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
            fi

            ensure_available_web_port
            create_data_directories
            pull_image
            run_container
            
            # Wait a moment for container to start
            sleep 2
            
            show_status
            ;;
        stop)
            print_status "Stopping oc-mirror-web-app"
            check_container_runtime
            stop_container
            print_success "Application stopped"
            ;;
        restart)
            echo "=========================================="
            echo "  OC Mirror v2 Web Application"
            echo "  Application Starter"
            echo "=========================================="
            echo ""
            detect_architecture
            check_container_runtime
            check_pull_secret
            stop_container
            sleep 2
            ensure_available_web_port
            create_data_directories
            pull_image
            run_container
            sleep 2
            show_status
            ;;
        status)
            check_container_runtime
            detect_architecture
            show_status
            ;;
        logs)
            check_container_runtime
            show_logs
            ;;
        help|--help|-h)
            echo "Usage: $0 {--start|--stop|--restart|--status|--logs}"
            echo ""
            echo "Commands:"
            echo "  --start   - Start the application (default)"
            echo "  --stop    - Stop the application"
            echo "  --restart - Restart the application"
            echo "  --status  - Show container status"
            echo "  --logs    - Show container logs"
            echo "  --help, -h - Show this help message"
            echo ""
            echo "Environment:"
            echo "  WEB_PORT   - Override the host port used for the web UI (default: $DEFAULT_WEB_PORT)"
            echo "  IMAGE_NAME - Override the container image (default: quay.io/rh-ee-ybeder/oc-mirror-web-app)"
            exit 0
            ;;
        *)
            echo "Error: Unknown command '$1'"
            echo ""
            echo "Usage: $0 {--start|--stop|--restart|--status|--logs}"
            echo ""
            echo "Use '$0 --help' for more information"
            exit 1
            ;;
    esac
}

# Run main function
main "$@" 