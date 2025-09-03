#!/bin/bash

# OC Mirror v2 Web Application - Containerized Runner
# This script runs the application in a container without requiring any host installations
# Supports Podman only

set -e

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

# Fix directory permissions for container user
fix_permissions() {
    print_status "Checking directory permissions..."
    
    # Check if directories are writable by current user
    if [ -w "data" ] && [ -w "downloads" ]; then
        print_success "Directories have proper permissions"
        return 0
    fi
    
    # Check if directories are already owned by container user (UID 1001 or similar)
    local data_owner=$(stat -c '%u' data/ 2>/dev/null || echo "unknown")
    local downloads_owner=$(stat -c '%u' downloads/ 2>/dev/null || echo "unknown")
    
    if [ "$data_owner" != "1001" ] && [ "$data_owner" != "101000" ]; then
        print_status "Fixing directory permissions for container user..."
        
        # Try to fix permissions, but don't fail if we can't
        if chmod -R 755 data/ downloads/ 2>/dev/null; then
            print_success "Permissions set to 755"
        else
            print_warning "Could not set permissions to 755, trying alternative approach..."
            if chmod -R 777 data/ downloads/ 2>/dev/null; then
                print_success "Permissions set to 777 (world-writable)"
            else
                print_warning "Could not change permissions. Container may have issues."
                print_warning "You may need to run: sudo chmod -R 755 data/ downloads/"
            fi
        fi
        
        # Try to change ownership, but don't fail if we can't
        if chown -R 1001:1001 data/ downloads/ 2>/dev/null; then
            print_success "Ownership changed to container user (UID 1001)"
        else
            print_warning "Could not change ownership (may need sudo). Continuing anyway..."
        fi
    else
        print_success "Directories already owned by container user (UID $data_owner)"
    fi
}

# Create necessary directories
create_directories() {
    print_status "Checking data directories..."
    
    # Create directories if they don't exist
    if [ ! -d "data" ]; then
        print_status "Creating data directory structure..."
        mkdir -p data/configs
        mkdir -p data/operations
        mkdir -p data/logs
        mkdir -p data/cache
    else
        print_success "Data directory already exists"
    fi
    
    if [ ! -d "downloads" ]; then
        print_status "Creating downloads directory..."
        mkdir -p downloads
    else
        print_success "Downloads directory already exists"
    fi
    
    # Fix permissions for container user
    fix_permissions
}

    # Fetch catalogs on host (if explicitly requested)
    fetch_catalogs() {
        if [ "$FETCH_CATALOGS" != "true" ]; then
            print_status "Skipping catalog fetch (using existing catalog data)"
            return 0
        fi

        print_status "Fetching operator catalogs (this may take several minutes)..."

        # Check if catalog data already exists and is recent (less than 24 hours old)
        if [ -d "catalog-data" ] && [ -f "catalog-data/catalog-index.json" ]; then
            local catalog_age=$(( $(date +%s) - $(stat -c %Y catalog-data/catalog-index.json 2>/dev/null || echo 0) ))
            if [ $catalog_age -lt 86400 ]; then # 24 hours = 86400 seconds
                print_success "Using existing catalog data (less than 24 hours old)"
                return 0
            else
                print_status "Existing catalog data is old, refreshing..."
            fi
        else
            print_status "No catalog data found, fetching operator catalogs..."
        fi

        # Run the host-side catalog fetch script
        if [ -f "fetch-catalogs-host.sh" ]; then
            chmod +x fetch-catalogs-host.sh
            if ./fetch-catalogs-host.sh; then
                print_success "Catalog fetch completed successfully"
            else
                print_warning "Catalog fetch failed, will use fallback data"
            fi
        else
            print_warning "Catalog fetch script not found, will use fallback data"
        fi
    }

# Build the container image
build_image() {
    print_status "Building container image with $CONTAINER_ENGINE..."
    
    # Build for native architecture (do not force amd64)
    if $CONTAINER_ENGINE build -t oc-mirror-web-app .; then
        print_success "Container image built successfully (native arch)"
    else
        print_error "Failed to build container image (native arch)"
        exit 1
    fi
}

# Run the container
run_container() {
    print_status "Starting OC Mirror Web Application container with $CONTAINER_ENGINE..."
    
    # Check if container is already running
    if $CONTAINER_ENGINE ps --format "table {{.Names}}" | grep -q "oc-mirror-web-app"; then
        print_warning "Container is already running. Stopping it first..."
        $CONTAINER_ENGINE stop oc-mirror-web-app
        $CONTAINER_ENGINE rm oc-mirror-web-app
    fi
    
    # Run the container
    $CONTAINER_ENGINE run -d \
        --name oc-mirror-web-app \
        -p 3000:3001 \
        -v "$(pwd)/data:/app/data:z" \
        -v "$(pwd)/downloads:/app/downloads:z" \
        -v "$(pwd)/pull-secret/pull-secret.json:/app/pull-secret.json:z" \
        -e NODE_ENV=production \
        -e PORT=3001 \
        -e STORAGE_DIR=/app/data \
        -e DOWNLOADS_DIR=/app/downloads \
        -e OC_MIRROR_CACHE_DIR=/app/data/cache \
        -e LOG_LEVEL=info \
        --restart unless-stopped \
        oc-mirror-web-app
    
    print_success "Container started successfully"
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
    echo "🌐 Web Interface: http://localhost:3000"
    echo "🔧 API Server: http://localhost:3001"
    echo ""
    echo "📁 Data Directory: $(pwd)/data"
    echo "📥 Downloads Directory: $(pwd)/downloads"
    echo "📋 Container Name: oc-mirror-web-app"
    echo "🔧 Container Engine: $CONTAINER_ENGINE"
    echo "🏗️  System Architecture: $ARCH_NAME"
    echo ""
    echo "📊 Container Status:"
    $CONTAINER_ENGINE ps --filter "name=oc-mirror-web-app" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    echo "📝 Useful Commands:"
    echo "  View logs:     $CONTAINER_ENGINE logs -f oc-mirror-web-app"
    echo "  Stop app:      $CONTAINER_ENGINE stop oc-mirror-web-app"
    echo "  Remove app:    $CONTAINER_ENGINE rm oc-mirror-web-app"
    echo "  Shell access:  $CONTAINER_ENGINE exec -it oc-mirror-web-app /bin/sh"
    echo ""
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
    fix_permissions
    
    # Only fetch catalogs if explicitly requested
    if [ "$FETCH_CATALOGS" = "true" ]; then
        fetch_catalogs
    else
        print_status "Skipping catalog fetch (using existing catalog data)"
    fi
    
    build_image
    run_container
    show_status
}

# Handle script arguments
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --build-only   Only build the container image"
        echo "  --run-only     Only run the container (assumes image exists)"
        echo "  --stop         Stop and remove the container"
        echo "  --logs         Show container logs"
        echo "  --status       Show container status"
        echo "  --engine       Show detected container engine"
        echo "  --fetch-catalogs Fetch operator catalogs during build (slower but complete)"
        echo ""
        echo "Environment Variables:"
        echo "  FETCH_CATALOGS=true  Fetch operator catalogs during build"
        echo ""
        echo "Examples:"
        echo "  $0              # Build and run the application (fast build)"
        echo "  $0 --build-only # Only build the image"
        echo "  $0 --stop       # Stop the application"
        echo "  $0 --logs       # View application logs"
        echo "  $0 --fetch-catalogs # Build with catalog fetching (complete data)"
        echo ""
        echo "Container Engine Support:"
        echo "  - Podman (required)"
        echo ""
        echo "Catalog Fetching:"
        echo "  By default, the build process skips catalog fetching for faster builds."
        echo "  Use --fetch-catalogs to fetch operator catalogs for OCP versions 4.15-4.19."
        echo "  Catalog fetching can take several minutes but provides complete operator data."
        exit 0
        ;;
    --build-only)
        check_container_runtime
        build_image
        print_success "Image built successfully. Run with: $0 --run-only"
        exit 0
        ;;
    --run-only)
        check_container_runtime
        detect_system_architecture
        run_container
        show_status
        exit 0
        ;;
    --stop)
        detect_container_runtime
        print_status "Stopping and removing container..."
        $CONTAINER_ENGINE stop oc-mirror-web-app 2>/dev/null || true
        $CONTAINER_ENGINE rm oc-mirror-web-app 2>/dev/null || true
        print_success "Container stopped and removed"
        exit 0
        ;;
    --logs)
        detect_container_runtime
        $CONTAINER_ENGINE logs -f oc-mirror-web-app
        exit 0
        ;;
    --fetch-catalogs)
        export FETCH_CATALOGS=true
        main
        ;;
    --engine)
        detect_container_runtime
        echo "Detected container engine: $CONTAINER_ENGINE"
        exit 0
        ;;
    --status)
        detect_container_runtime
        show_status
        exit 0
        ;;
    *)
        main
        ;;
esac 
