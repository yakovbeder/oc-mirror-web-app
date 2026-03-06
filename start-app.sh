#!/bin/bash

# Application starter script for oc-mirror-web-app using pre-built images from Quay.io
# Automatically detects architecture and uses the appropriate image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Configuration
IMAGE_NAME="quay.io/rh-ee-ybeder/oc-mirror-web-app"
CONTAINER_NAME="oc-mirror-web-app"
WEB_PORT="3000"
CONTAINER_PORT="3001"
DATA_DIR="data"

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

# Fix directory permissions for container user
fix_permissions() {
    print_status "Ensuring data directories are writable by container user (UID 1000)..."

    local data_owner
    data_owner=$(stat -c '%u' "${DATA_DIR}/" 2>/dev/null || echo "unknown")

    if [ "$data_owner" = "1000" ]; then
        print_success "Directories already owned by container user (UID 1000)"
        return 0
    fi

    if chown -R 1000:1000 "${DATA_DIR}/" 2>/dev/null; then
        chmod -R 775 "${DATA_DIR}/" 2>/dev/null || true
        print_success "Ownership set to UID 1000 (node user)"
    elif sudo chown -R 1000:1000 "${DATA_DIR}/" 2>/dev/null; then
        sudo chmod -R 775 "${DATA_DIR}/" 2>/dev/null || true
        print_success "Ownership set to UID 1000 with sudo"
    else
        print_warning "Could not change host ownership. The container entrypoint will fix permissions as root."
        print_warning "If problems persist, run: sudo chown -R 1000:1000 ${DATA_DIR}/"
    fi
}

# Create data directories
create_data_directories() {
    print_status "Ensuring data directories exist..."

    mkdir -p \
        "$DATA_DIR/configs" \
        "$DATA_DIR/operations" \
        "$DATA_DIR/logs" \
        "$DATA_DIR/cache" \
        "$DATA_DIR/mirrors/default" \
        "$DATA_DIR/mirrors/custom"

    print_success "Data directories are ready"
    fix_permissions
}

# Pull image
pull_image() {
    local image_tag="${IMAGE_NAME}:latest-${ARCH}"
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
    local image_tag="${IMAGE_NAME}:latest-${ARCH}"
    
    print_status "Starting container: $CONTAINER_NAME"
    print_status "Image: $image_tag"
    print_status "Web UI: http://localhost:$WEB_PORT"
    print_status "API: http://localhost:$WEB_PORT/api"
    
    $CONTAINER_ENGINE run -d \
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
        "$image_tag"
    
    if [ $? -eq 0 ]; then
        print_success "Container started successfully"
    else
        print_error "Failed to start container"
        exit 1
    fi
}

# Show status
show_status() {
    if ! is_container_running; then
        print_warning "Application is not running"
        print_status "Start it with: ./start-app.sh --start"
        return 0
    fi

    echo ""
    echo "=========================================="
    echo "  OC Mirror v2 Web Application"
    echo "=========================================="
    echo ""
    print_success "Application is running!"
    echo ""
    echo "🌐 Web Interface: http://localhost:$WEB_PORT"
    echo "🔧 API Server: http://localhost:$WEB_PORT/api (proxied through web interface)"
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
            fi
            
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