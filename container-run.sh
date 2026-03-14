#!/bin/bash

# OC Mirror v2 Web Application - Containerized Runner
# This script runs the application in a container without requiring any host installations
# Supports Podman only

set -e

# Optional behavior flags (can be set via env vars or script args)
# - BUILD_NO_CACHE=true -> pass --no-cache to podman build
# - IMAGE_VERSION=4.3   -> set OCI image version label during build
# - BUILD_VERSION=4.3   -> compatibility alias for IMAGE_VERSION
BUILD_NO_CACHE="${BUILD_NO_CACHE:-false}"
IMAGE_VERSION="${IMAGE_VERSION:-${BUILD_VERSION:-}}"

# Image name (use localhost/ prefix to prevent Podman from searching registries)
IMAGE_NAME="localhost/oc-mirror-web-app"
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

# Detect container runtime (Podman only)
detect_container_runtime() {
    if command -v podman &> /dev/null && podman info &> /dev/null; then
        CONTAINER_ENGINE="podman"
        print_success "Using Podman as container runtime"
    else
        print_error "Podman is not available or running."
        print_error "Please install Podman and try again."
        exit 1
    fi
}

# Detect system architecture
detect_system_architecture() {
    SYSTEM_ARCH=$(uname -m)
    case $SYSTEM_ARCH in
        x86_64)
            ARCH_NAME="AMD64 (x86_64)"
            ;;
        aarch64|arm64)
            ARCH_NAME="ARM64 (aarch64)"
            ;;
        *)
            ARCH_NAME="$SYSTEM_ARCH (unsupported)"
            print_warning "Architecture $SYSTEM_ARCH may not be fully supported"
            ;;
    esac
    print_status "System architecture: $ARCH_NAME"
}

# Check if container runtime is available
check_container_runtime() {
    detect_container_runtime
    
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

ensure_available_web_port() {
    if ! port_is_in_use "$WEB_PORT"; then
        return 0
    fi

    if [ "$WEB_PORT_WAS_SET" = "true" ]; then
        print_error "Requested WEB_PORT $WEB_PORT is already in use"
        print_error "Choose another port, for example: WEB_PORT=3002 ./container-run.sh --run-only"
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

# Create necessary directories and make them world-writable so both the
# host user and the container user (UID 1000) can read/write without chown.
create_directories() {
    print_status "Checking data directories..."

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

# Fetch catalogs on host before every build.
fetch_catalogs() {
    print_status "Fetching operator catalogs (this may take several minutes)..."

    if [ ! -f "fetch-catalogs-host.sh" ]; then
        print_error "Catalog fetch script not found: ./fetch-catalogs-host.sh"
        exit 1
    fi

    chmod +x fetch-catalogs-host.sh
    if ./fetch-catalogs-host.sh; then
        print_success "Catalog fetch completed successfully"
    else
        print_error "Catalog fetch failed"
        exit 1
    fi
}

# Build the container image
build_image() {
    print_status "Building container image with $CONTAINER_ENGINE..."

    local build_cmd=("$CONTAINER_ENGINE" "build")
    local build_date
    local vcs_ref=""

    if [ "$BUILD_NO_CACHE" = "true" ]; then
        print_status "Build cache disabled (BUILD_NO_CACHE=true)"
        build_cmd+=(--no-cache)
    fi

    build_date="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    build_cmd+=(--build-arg "BUILD_DATE=${build_date}")

    if command -v git >/dev/null 2>&1; then
        vcs_ref="$(git rev-parse --short HEAD 2>/dev/null || true)"
    fi

    if [ -n "$vcs_ref" ]; then
        build_cmd+=(--build-arg "VCS_REF=${vcs_ref}")
    fi

    if [ -n "$IMAGE_VERSION" ]; then
        print_status "Setting image version label to: $IMAGE_VERSION"
        build_cmd+=(--build-arg "VERSION=${IMAGE_VERSION}")
    fi

    build_cmd+=(-t "$IMAGE_NAME" .)

    if "${build_cmd[@]}"; then
        print_success "Container image built successfully"
    else
        print_error "Failed to build container image"
        exit 1
    fi
}

# Check if image exists locally
check_image_exists() {
    if ! $CONTAINER_ENGINE image exists "$IMAGE_NAME" 2>/dev/null; then
        print_error "Image '$IMAGE_NAME' not found locally."
        print_error "Please build the image first with: $0 --build-only"
        exit 1
    fi
    print_success "Image '$IMAGE_NAME' found locally"
}

is_container_running() {
    $CONTAINER_ENGINE ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"
}

container_exists() {
    $CONTAINER_ENGINE ps -a --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"
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

# Run the container
run_container() {
    local requested_port="$WEB_PORT"
    local bind_retry_limit=10
    local bind_attempt=1

    print_status "Starting OC Mirror Web Application container with $CONTAINER_ENGINE..."
    ensure_available_web_port

    # Check if container is already running
    if is_container_running; then
        print_warning "Container is already running. Stopping it first..."
        # Try graceful stop with timeout
        if ! $CONTAINER_ENGINE stop -t 30 "$CONTAINER_NAME" 2>/dev/null; then
            print_warning "Graceful stop failed, attempting force stop..."
            $CONTAINER_ENGINE stop -t 5 "$CONTAINER_NAME" 2>/dev/null || true
        fi
        $CONTAINER_ENGINE rm "$CONTAINER_NAME" 2>/dev/null || true
    fi
    
    # Also check for stopped container with same name
    if container_exists; then
        print_status "Removing stopped container..."
        $CONTAINER_ENGINE rm "$CONTAINER_NAME" 2>/dev/null || true
    fi

    while [ "$bind_attempt" -le "$bind_retry_limit" ]; do
        local run_output

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
            -e LOG_LEVEL=info \
            --restart unless-stopped \
            "$IMAGE_NAME" 2>&1)"
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
                print_error "Choose another port, for example: WEB_PORT=3002 ./container-run.sh --run-only"
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
        print_status "Start it with: ./container-run.sh"
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
    echo "🐳 Image Name: $IMAGE_NAME"
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

# Show help
show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help, -h          Show this help message"
    echo "  --build-only        Only build the container image"
    echo "  --run-only          Only run the container (assumes image exists)"
    echo "  --stop              Stop and remove the container"
    echo "  --logs              Show container logs"
    echo "  --status            Show container status"
    echo "  --engine            Show detected container engine"
    echo "  --no-cache          Rebuild the container image without using cache"
    echo "  --version VERSION   Set OCI image version label during build"
    echo ""
    echo "Environment Variables:"
    echo "  BUILD_NO_CACHE=true        Disable build cache when building the container image"
    echo "  IMAGE_VERSION=4.3          Set OCI image version label during build"
    echo "  BUILD_VERSION=4.3          Compatibility alias for IMAGE_VERSION"
    echo "  WEB_PORT=$DEFAULT_WEB_PORT            Override the host port used for the web UI"
    echo ""
    echo "Examples:"
    echo "  $0"
    echo "  $0 --build-only"
    echo "  $0 --build-only --version 4.3"
    echo "  $0 --build-only --no-cache"
    echo "  WEB_PORT=3002 $0 --run-only"
    echo ""
    echo "Container Engine Support:"
    echo "  - Podman (required)"
    echo ""
    echo "Catalog Fetching:"
    echo "  Every build path runs the host-side catalog fetch before the image build."
    echo "  Use --run-only only when you want to start an image that is already built locally."
    echo "  If port 3000 is busy, the script automatically picks the next free host port."
}

# Build image without running the container
build_only() {
    echo "=========================================="
    echo "  OC Mirror v2 Web Application"
    echo "  Containerized Runner"
    echo "=========================================="
    echo ""

    check_container_runtime
    detect_system_architecture
    create_directories

    fetch_catalogs
    build_image
    print_success "Image built successfully. Run with: $0 --run-only"
}

set_action() {
    local next_action="$1"

    if [ -n "${ACTION:-}" ] && [ "$ACTION" != "main" ] && [ "$ACTION" != "$next_action" ]; then
        print_error "Conflicting actions: '$ACTION' and '$next_action'"
        echo "Use --help for usage information"
        exit 1
    fi

    ACTION="$next_action"
}

parse_arguments() {
    ACTION="main"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --help|-h)
                set_action "help"
                shift
                ;;
            --build-only)
                set_action "build-only"
                shift
                ;;
            --run-only)
                set_action "run-only"
                shift
                ;;
            --stop)
                set_action "stop"
                shift
                ;;
            --logs)
                set_action "logs"
                shift
                ;;
            --status)
                set_action "status"
                shift
                ;;
            --engine)
                set_action "engine"
                shift
                ;;
            --no-cache)
                BUILD_NO_CACHE=true
                shift
                ;;
            --version)
                if [ $# -lt 2 ]; then
                    print_error "--version requires a value"
                    echo "Use --help for usage information"
                    exit 1
                fi
                IMAGE_VERSION="$2"
                shift 2
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
}

# Main execution
main() {
    echo "=========================================="
    echo "  OC Mirror v2 Web Application"
    echo "  Containerized Runner"
    echo "=========================================="
    echo ""
    
    check_container_runtime
    detect_system_architecture
    create_directories

    fetch_catalogs
    build_image
    run_container
    sleep 2
    show_status
}

# Handle script arguments
parse_arguments "$@"

case "$ACTION" in
    help)
        show_help
        exit 0
        ;;
    build-only)
        build_only
        exit 0
        ;;
    run-only)
        check_container_runtime
        detect_system_architecture
        create_directories
        check_image_exists
        run_container
        sleep 2
        show_status
        exit 0
        ;;
    stop)
        detect_container_runtime
        print_status "Stopping and removing container..."
        
        # Try graceful stop first
        if $CONTAINER_ENGINE stop -t 30 "$CONTAINER_NAME" 2>/dev/null; then
            print_success "Container stopped gracefully"
        else
            # If graceful stop fails, try with shorter timeout and then force
            print_warning "Graceful stop failed, attempting force stop..."
            $CONTAINER_ENGINE stop -t 5 "$CONTAINER_NAME" 2>/dev/null || true
        fi
        
        # Remove container
        $CONTAINER_ENGINE rm "$CONTAINER_NAME" 2>/dev/null || true
        print_success "Container stopped and removed"
        exit 0
        ;;
    logs)
        detect_container_runtime
        $CONTAINER_ENGINE logs -f "$CONTAINER_NAME"
        exit 0
        ;;
    engine)
        detect_container_runtime
        echo "Detected container engine: $CONTAINER_ENGINE"
        exit 0
        ;;
    status)
        detect_container_runtime
        detect_system_architecture
        show_status
        exit 0
        ;;
    main)
        main
        ;;
esac
