#!/bin/bash

# Simplified runner script for oc-mirror-web-app using Quay.io images
# Automatically detects architecture and uses the appropriate image

set -e

# Configuration
IMAGE_NAME="quay.io/rh-ee-ybeder/oc-mirror-web-app"
CONTAINER_NAME="oc-mirror-web-app"
WEB_PORT="3000"
API_PORT="3001"
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

# Fix directory permissions for container user
fix_permissions() {
    print_status "Checking directory permissions..."
    
    # Check if directories are writable by current user
    if [ -w "data" ]; then
        print_success "Directories have proper permissions"
        return 0
    fi
    
    # Check if directories are already owned by container user (UID 1000 - node user in node:22-slim image)
    local data_owner=$(stat -c '%u' data/ 2>/dev/null || echo "unknown")
    
    # Container runs as node user (UID 1000), check if ownership needs fixing
    # Also check mirror directories
    local mirror_owner=$(stat -c '%u' data/mirrors/ 2>/dev/null || echo "unknown")
    
    if [ "$data_owner" != "1000" ] && [ "$data_owner" != "unknown" ]; then
        print_status "Fixing directory permissions for container user (UID 1000)..."
        
        # Try to fix permissions - use 777 (world-writable) to ensure node user can write
        # This is safe for local data directories and handles volume mount ownership issues
        if chmod -R 777 data/ 2>/dev/null; then
            print_success "Permissions set to 777 (world-writable - required for volume mounts)"
        else
            print_warning "Could not set permissions. Trying with sudo..."
            if sudo chmod -R 777 data/ 2>/dev/null; then
                print_success "Permissions set to 777 with sudo"
            else
                print_warning "Could not change permissions even with sudo."
                print_warning "Manual fix required: sudo chmod -R 777 data/"
            fi
        fi
        
        # Try to change ownership to node user (UID 1000), but don't fail if we can't
        if chown -R 1000:1000 data/ 2>/dev/null; then
            print_success "Ownership changed to container user (UID 1000 - node user)"
        else
            print_warning "Could not change ownership (may need sudo). Continuing anyway..."
            print_warning "To fix manually, run: sudo chown -R 1000:1000 data/"
        fi
    else
        if [ "$data_owner" = "1000" ]; then
            print_success "Directories already owned by container user (UID 1000)"
        else
            print_status "Directories will be created by container with correct permissions"
        fi
    fi
}

# Create data directories
create_data_directories() {
    print_status "Checking data directories..."
    
    # Create directories if they don't exist
    if [ ! -d "$DATA_DIR" ]; then
        print_status "Creating data directory structure..."
        mkdir -p "$DATA_DIR"/{configs,operations,logs,cache}
    else
        print_success "Data directory already exists"
    fi
    
    # Create default mirror directory in mounted volume (persistent)
    if [ ! -d "$DATA_DIR/mirrors" ]; then
        print_status "Creating mirror storage base directory..."
        mkdir -p "$DATA_DIR/mirrors"
        chmod -R 777 "$DATA_DIR/mirrors" 2>/dev/null || true
        print_success "Created $DATA_DIR/mirrors (persistent mirror location - survives container restarts)"
    else
        print_success "Mirror storage directory already exists"
        chmod -R 777 "$DATA_DIR/mirrors" 2>/dev/null || true
    fi
    
    # Ensure default subdirectory exists
    if [ ! -d "$DATA_DIR/mirrors/default" ]; then
        mkdir -p "$DATA_DIR/mirrors/default"
        chmod -R 777 "$DATA_DIR/mirrors/default" 2>/dev/null || true
    fi
    
    # Fix permissions for container user
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
    print_status "API: http://localhost:$API_PORT"
    
    $CONTAINER_ENGINE run -d \
        --name $CONTAINER_NAME \
        -p $WEB_PORT:3001 \
        -v "$(pwd)/$DATA_DIR:/app/data:z" \
        -v "$(pwd)/pull-secret/pull-secret.json:/app/pull-secret.json:z" \
        -e NODE_ENV=production \
        -e PORT=3001 \
        -e STORAGE_DIR=/app/data \
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
            echo "  Quay.io Image Runner"
            echo "=========================================="
            echo ""
            detect_architecture
            check_container_runtime
            
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
            echo "  Quay.io Image Runner"
            echo "=========================================="
            echo ""
            detect_architecture
            check_container_runtime
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