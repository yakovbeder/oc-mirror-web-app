#!/bin/bash

# OC Mirror v2 Web Application - Containerized Runner
# This script runs the application in a container without requiring any host installations
# Supports both Docker and Podman

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

# Detect container runtime (Docker or Podman)
detect_container_runtime() {
    if command -v docker &> /dev/null && docker info &> /dev/null; then
        CONTAINER_ENGINE="docker"
        print_success "Using Docker as container runtime"
    elif command -v podman &> /dev/null && podman info &> /dev/null; then
        CONTAINER_ENGINE="podman"
        print_success "Using Podman as container runtime"
    else
        print_error "Neither Docker nor Podman is available or running."
        print_error "Please install Docker or Podman and try again."
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

# Create necessary directories
create_directories() {
    print_status "Checking data directories..."
    
    # Check if directories already exist and have proper permissions
    if [ -d "data" ] && [ -d "downloads" ] && [ -w "data" ] && [ -w "downloads" ]; then
        print_success "Data directories already exist with proper permissions"
        return 0
    fi
    
    print_status "Creating data directories..."
    
    mkdir -p data/configs
    mkdir -p data/operations
    mkdir -p data/logs
    mkdir -p data/cache
    mkdir -p downloads
    
    # Fix permissions for nodejs user (UID 1001)
    print_status "Setting proper permissions for container user..."
    chmod -R 755 data/ downloads/
    chown -R 1001:1001 data/ downloads/ 2>/dev/null || {
        print_warning "Could not change ownership (may need sudo). Trying alternative approach..."
        # Alternative: make directories writable by all
        chmod -R 777 data/ downloads/
    }
    
    print_success "Data directories created with proper permissions"
}

    # Fetch catalogs on host (if explicitly requested)
    fetch_catalogs() {
        if [ "$FETCH_CATALOGS" != "true" ]; then
            print_status "Skipping catalog fetch (will use fallback data)"
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
    if [ "$CONTAINER_ENGINE" = "podman" ] || [ "$CONTAINER_ENGINE" = "docker" ]; then
        if $CONTAINER_ENGINE build -t oc-mirror-web-app .; then
            print_success "Container image built successfully (native arch)"
        else
            print_error "Failed to build container image (native arch)"
            exit 1
        fi
    else
        print_error "Unsupported container engine: $CONTAINER_ENGINE"
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

# Fix permissions for existing installations
fix_permissions() {
    print_status "Checking data directory permissions..."
    
    # Check if permissions are already correct
    if [ -d "data" ] && [ -w "data" ] && [ -d "downloads" ] && [ -w "downloads" ]; then
        print_success "Data directories already have proper permissions"
        return 0
    fi
    
    print_status "Fixing data directory permissions..."
    
    if [ -d "data" ]; then
        # Try to change ownership to nodejs user (UID 1001)
        if chown -R 1001:1001 data/ 2>/dev/null; then
            chmod -R 755 data/
            print_success "Data directory permissions fixed successfully"
        else
            print_warning "Could not change ownership. Making directories world-writable..."
            chmod -R 777 data/
            print_success "Made data directories world-writable"
        fi
    fi
    
    if [ -d "downloads" ]; then
        # Try to change ownership to nodejs user (UID 1001)
        if chown -R 1001:1001 downloads/ 2>/dev/null; then
            chmod -R 755 downloads/
            print_success "Downloads directory permissions fixed successfully"
        else
            print_warning "Could not change ownership. Making directories world-writable..."
            chmod -R 777 downloads/
            print_success "Made downloads directories world-writable"
        fi
    fi
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
        print_status "Skipping catalog fetch (using pre-cached catalogs)"
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
        echo "  - Docker (if available)"
        echo "  - Podman (if available)"
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
