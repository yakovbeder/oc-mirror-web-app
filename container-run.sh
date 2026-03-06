#!/bin/bash

# OC Mirror v2 Web Application - Containerized Runner
# This script runs the application in a container without requiring any host installations
# Supports Podman only

set -e

# Optional behavior flags (can be set via env vars or script args)
# - BUILD_NO_CACHE=true  -> pass --no-cache to podman build
# - FETCH_CATALOGS=true -> refresh catalog-data before building
# - FORCE_CATALOG_REFRESH=true -> pass --force to fetch-catalogs-host.sh
# - IMAGE_VERSION=4.2 -> set OCI image version label during build
# - BUILD_VERSION=4.2 -> compatibility alias for IMAGE_VERSION
BUILD_NO_CACHE="${BUILD_NO_CACHE:-false}"
FETCH_CATALOGS="${FETCH_CATALOGS:-false}"
FORCE_CATALOG_REFRESH="${FORCE_CATALOG_REFRESH:-false}"
IMAGE_VERSION="${IMAGE_VERSION:-${BUILD_VERSION:-}}"

# Image name (use localhost/ prefix to prevent Podman from searching registries)
IMAGE_NAME="localhost/oc-mirror-web-app"
CONTAINER_NAME="oc-mirror-web-app"

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

# Fix directory permissions for container user (UID 1000 - node user)
# The entrypoint runs as root and handles permissions inside the container,
# but we also do a best-effort fix on the host to avoid startup errors.
fix_permissions() {
    print_status "Ensuring data directories are writable by container user (UID 1000)..."

    local data_owner
    data_owner=$(stat -c '%u' data/ 2>/dev/null || echo "unknown")

    if [ "$data_owner" = "1000" ]; then
        print_success "Directories already owned by container user (UID 1000)"
        return 0
    fi

    # Best-effort: try chown first, then chmod as fallback
    if chown -R 1000:1000 data/ 2>/dev/null; then
        chmod -R 775 data/ 2>/dev/null || true
        print_success "Ownership set to UID 1000 (node user)"
    elif sudo chown -R 1000:1000 data/ 2>/dev/null; then
        sudo chmod -R 775 data/ 2>/dev/null || true
        print_success "Ownership set to UID 1000 with sudo"
    else
        print_warning "Could not change host ownership. The container entrypoint will fix permissions as root."
        print_warning "If problems persist: sudo chown -R 1000:1000 data/"
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
    
    # Create default mirror directory in mounted volume (persistent)
    if [ ! -d "data/mirrors" ]; then
        print_status "Creating mirror storage base directory..."
        mkdir -p data/mirrors
        chmod -R 777 data/mirrors 2>/dev/null || true
        print_success "Created data/mirrors (persistent mirror location - survives container restarts)"
    else
        print_success "Mirror storage directory already exists"
        chmod -R 777 data/mirrors 2>/dev/null || true
    fi
    
    # Ensure default subdirectory exists
    if [ ! -d "data/mirrors/default" ]; then
        mkdir -p data/mirrors/default
        chmod -R 777 data/mirrors/default 2>/dev/null || true
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

        local fetch_args=()
        if [ "$FORCE_CATALOG_REFRESH" = "true" ]; then
            print_status "Forcing catalog refresh via fetch-catalogs-host.sh --force"
            fetch_args+=(--force)
        elif [ -d "catalog-data" ] && [ -f "catalog-data/catalog-index.json" ]; then
            local catalog_age=$(( $(date +%s) - $(stat -c %Y catalog-data/catalog-index.json 2>/dev/null || echo 0) ))
            local max_age=$((7 * 24 * 3600))  # 7 days in seconds
            
            if [ $catalog_age -lt $max_age ]; then
                print_success "Using existing catalog data (less than 7 days old)"
                return 0
            else
                print_status "Existing catalog data is older than 7 days, refreshing..."
            fi
        else
            print_status "No catalog data found, fetching operator catalogs..."
        fi

        # Run the host-side catalog fetch script
        if [ -f "fetch-catalogs-host.sh" ]; then
            chmod +x fetch-catalogs-host.sh
            if ./fetch-catalogs-host.sh "${fetch_args[@]}"; then
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

# Run the container
run_container() {
    print_status "Starting OC Mirror Web Application container with $CONTAINER_ENGINE..."
    
    # Check if container is already running
    if $CONTAINER_ENGINE ps --format "table {{.Names}}" | grep -q "$CONTAINER_NAME"; then
        print_warning "Container is already running. Stopping it first..."
        # Try graceful stop with timeout
        if ! $CONTAINER_ENGINE stop -t 30 "$CONTAINER_NAME" 2>/dev/null; then
            print_warning "Graceful stop failed, attempting force stop..."
            $CONTAINER_ENGINE stop -t 5 "$CONTAINER_NAME" 2>/dev/null || true
        fi
        $CONTAINER_ENGINE rm "$CONTAINER_NAME" 2>/dev/null || true
    fi
    
    # Also check for stopped container with same name
    if $CONTAINER_ENGINE ps -a --format "table {{.Names}}" | grep -q "$CONTAINER_NAME"; then
        print_status "Removing stopped container..."
        $CONTAINER_ENGINE rm "$CONTAINER_NAME" 2>/dev/null || true
    fi
    
    # Run the container
    $CONTAINER_ENGINE run -d \
        --name "$CONTAINER_NAME" \
        -p 3000:3001 \
        -v "$(pwd)/data:/app/data:z" \
        -v "$(pwd)/pull-secret/pull-secret.json:/app/pull-secret.json:z" \
        -e NODE_ENV=production \
        -e PORT=3001 \
        -e STORAGE_DIR=/app/data \
        -e OC_MIRROR_CACHE_DIR=/app/data/cache \
        -e LOG_LEVEL=info \
        --restart unless-stopped \
        "$IMAGE_NAME"
    
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
    echo "🔧 API Server: http://localhost:3000/api (proxied through web interface)"
    echo ""
    echo "📁 Data Directory: $(pwd)/data"
    echo "📦 Mirror Storage: $(pwd)/data/mirrors/default → /app/data/mirrors/default (persistent)"
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
    echo "  --fetch-catalogs    Fetch operator catalogs during build"
    echo "  --force-catalogs    Force host catalog refetch and ignore freshness"
    echo "  --no-cache          Rebuild the container image without using cache"
    echo "  --version VERSION   Set OCI image version label during build"
    echo ""
    echo "Environment Variables:"
    echo "  FETCH_CATALOGS=true         Fetch operator catalogs during build"
    echo "  FORCE_CATALOG_REFRESH=true Force host catalog refetch during build"
    echo "  BUILD_NO_CACHE=true        Disable build cache when building the container image"
    echo "  IMAGE_VERSION=4.2          Set OCI image version label during build"
    echo "  BUILD_VERSION=4.2          Compatibility alias for IMAGE_VERSION"
    echo ""
    echo "Examples:"
    echo "  $0"
    echo "  $0 --build-only"
    echo "  $0 --fetch-catalogs"
    echo "  $0 --fetch-catalogs --force-catalogs"
    echo "  $0 --build-only --version 4.2"
    echo "  $0 --build-only --fetch-catalogs --force-catalogs --no-cache"
    echo ""
    echo "Container Engine Support:"
    echo "  - Podman (required)"
    echo ""
    echo "Catalog Fetching:"
    echo "  By default, the build process skips catalog fetching for faster builds."
    echo "  Use --fetch-catalogs to refresh when the existing snapshot is stale."
    echo "  Use --force-catalogs to force a full host-side refetch before the image build."
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
    fix_permissions

    if [ "$FETCH_CATALOGS" = "true" ]; then
        fetch_catalogs
    else
        print_status "Skipping catalog fetch (using existing catalog data)"
    fi

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
            --fetch-catalogs)
                FETCH_CATALOGS=true
                shift
                ;;
            --force-catalogs)
                FETCH_CATALOGS=true
                FORCE_CATALOG_REFRESH=true
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
        show_status
        exit 0
        ;;
    main)
        main
        ;;
esac
