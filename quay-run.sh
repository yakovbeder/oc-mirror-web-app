#!/bin/bash

# Simplified runner script for oc-mirror-web-app using Quay.io images
# Automatically detects architecture and uses the appropriate image

set -e

# Configuration
IMAGE_NAME="quay.io/rh-ee-ybeder/oc-mirror-web-app"
CONTAINER_NAME="oc-mirror-web-app"
WEB_PORT="3000"
API_PORT="3001"
DATA_DIR="./data"

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
    if command -v podman &> /dev/null; then
        CONTAINER_ENGINE="podman"
        print_success "Using Podman as container engine"
    else
        print_error "Podman not found. Please install Podman."
        exit 1
    fi
}

# Check if container is running
is_container_running() {
    $CONTAINER_ENGINE ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"
}

# Stop container
stop_container() {
    print_status "Stopping container: $CONTAINER_NAME"
    $CONTAINER_ENGINE stop $CONTAINER_NAME 2>/dev/null || true
    $CONTAINER_ENGINE rm $CONTAINER_NAME 2>/dev/null || true
    print_success "Container stopped and removed"
}

# Create data directories
create_data_directories() {
    print_status "Creating data directories..."
    mkdir -p "$DATA_DIR"/{configs,operations,logs,cache}
    mkdir -p downloads
    print_success "Data directories created"
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
    print_status "API: http://localhost:$API_PORT"
    
    $CONTAINER_ENGINE run -d \
        --name $CONTAINER_NAME \
        -p $WEB_PORT:3001 \
        -v "$(pwd)/$DATA_DIR:/app/data:z" \
        -v "$(pwd)/downloads:/app/downloads:z" \
        -v "$(pwd)/pull-secret/pull-secret.json:/app/pull-secret.json:z" \
        -e NODE_ENV=production \
        -e PORT=3001 \
        -e STORAGE_DIR=/app/data \
        -e DOWNLOADS_DIR=/app/downloads \
        -e OC_MIRROR_CACHE_DIR=/app/data/cache \
        -e LOG_LEVEL=info \
        --restart unless-stopped \
        $image_tag
    
    if [ $? -eq 0 ]; then
        print_success "Container started successfully"
    else
        print_error "Failed to start container"
        exit 1
    fi
}

# Show status
show_status() {
    print_status "Container Status:"
    $CONTAINER_ENGINE ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    
    print_status "Application URLs:"
    print_status "  Web UI: http://localhost:$WEB_PORT"
    print_status "  API: http://localhost:$API_PORT"
    
    print_status "Data Directory: $DATA_DIR"
    print_status "Downloads Directory: $(pwd)/downloads"
    print_status "Architecture: $ARCH_NAME"
}

# Show logs
show_logs() {
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
            print_status "Starting oc-mirror-web-app from Quay.io"
            detect_architecture
            check_container_runtime
            
            if is_container_running; then
                print_warning "Container is already running"
                show_status
                exit 0
            fi
            
            create_data_directories
            pull_image
            run_container
            
            # Wait a moment for container to start
            sleep 2
            
            show_status
            print_success "Application started successfully!"
            ;;
        stop)
            print_status "Stopping oc-mirror-web-app"
            check_container_runtime
            stop_container
            print_success "Application stopped"
            ;;
        restart)
            print_status "Restarting oc-mirror-web-app"
            check_container_runtime
            stop_container
            sleep 2
            detect_architecture
            create_data_directories
            pull_image
            run_container
            sleep 2
            show_status
            print_success "Application restarted successfully!"
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