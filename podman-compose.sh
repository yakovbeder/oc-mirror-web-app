#!/bin/bash

# Podman Compose Runner for OC Mirror v2 Web Application
# This script provides Podman-compatible alternatives to docker-compose

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

# Check if Podman is available
check_podman() {
    if ! command -v podman &> /dev/null; then
        print_error "Podman is not installed or not in PATH."
        print_error "Please install Podman and try again."
        exit 1
    fi
    
    if ! podman info &> /dev/null; then
        print_error "Podman is not running or you don't have permission to use it."
        print_error "Please start Podman and ensure you have proper permissions."
        exit 1
    fi
    
    print_success "Podman is available and running"
}

# Check if podman-compose is available
check_podman_compose() {
    if command -v podman-compose &> /dev/null; then
        PODMAN_COMPOSE_CMD="podman-compose"
        print_success "Using podman-compose"
    elif command -v docker-compose &> /dev/null; then
        PODMAN_COMPOSE_CMD="docker-compose"
        print_warning "Using docker-compose with Podman (may have limitations)"
    else
        print_error "Neither podman-compose nor docker-compose is available."
        print_error "Please install podman-compose or docker-compose."
        exit 1
    fi
}

# Create necessary directories
create_directories() {
    print_status "Creating data directories..."
    
    mkdir -p data/configs
    mkdir -p data/operations
    mkdir -p data/logs
    mkdir -p data/cache
    
    print_success "Data directories created"
}

# Start services
start_services() {
    print_status "Starting services with $PODMAN_COMPOSE_CMD..."
    
    if $PODMAN_COMPOSE_CMD up -d; then
        print_success "Services started successfully"
    else
        print_error "Failed to start services"
        exit 1
    fi
}

# Stop services
stop_services() {
    print_status "Stopping services..."
    
    if $PODMAN_COMPOSE_CMD down; then
        print_success "Services stopped successfully"
    else
        print_error "Failed to stop services"
        exit 1
    fi
}

# Show status
show_status() {
    echo ""
    echo "=========================================="
    echo "  OC Mirror v2 Web Application"
    echo "  Podman Compose Status"
    echo "=========================================="
    echo ""
    
    echo "📊 Container Status:"
    podman ps --filter "name=oc-mirror" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    
    echo "🌐 Web Interface: http://localhost:3000"
    echo "🔧 API Server: http://localhost:3001"
    echo ""
    
    echo "📝 Useful Commands:"
    echo "  View logs:     $PODMAN_COMPOSE_CMD logs -f"
    echo "  Stop services: $PODMAN_COMPOSE_CMD down"
    echo "  Restart:       $PODMAN_COMPOSE_CMD restart"
    echo "  Shell access:  podman exec -it oc-mirror-web-app /bin/sh"
    echo ""
}

# Main execution
main() {
    echo "=========================================="
    echo "  OC Mirror v2 Web Application"
    echo "  Podman Compose Runner"
    echo "=========================================="
    echo ""
    
    check_podman
    check_podman_compose
    create_directories
    start_services
    show_status
}

# Handle script arguments
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  up             Start services (default)"
        echo "  down           Stop services"
        echo "  restart        Restart services"
        echo "  logs           Show service logs"
        echo "  status         Show service status"
        echo "  build          Build images"
        echo ""
        echo "Examples:"
        echo "  $0              # Start services"
        echo "  $0 up           # Start services"
        echo "  $0 down         # Stop services"
        echo "  $0 logs         # View logs"
        echo "  $0 status       # Show status"
        echo ""
        echo "Note: This script works with both podman-compose and docker-compose"
        exit 0
        ;;
    up|start)
        check_podman
        check_podman_compose
        create_directories
        start_services
        show_status
        ;;
    down|stop)
        check_podman
        check_podman_compose
        stop_services
        print_success "Services stopped"
        ;;
    restart)
        check_podman
        check_podman_compose
        print_status "Restarting services..."
        $PODMAN_COMPOSE_CMD restart
        print_success "Services restarted"
        show_status
        ;;
    logs)
        check_podman
        check_podman_compose
        $PODMAN_COMPOSE_CMD logs -f
        ;;
    status)
        check_podman
        show_status
        ;;
    build)
        check_podman
        check_podman_compose
        print_status "Building images..."
        $PODMAN_COMPOSE_CMD build
        print_success "Images built successfully"
        ;;
    *)
        main
        ;;
esac 