#!/bin/bash

# Build and push script for Quay.io
# Detects architecture and builds/pushes appropriate image

set -e

# Configuration
IMAGE_NAME="quay.io/rh-ee-ybeder/oc-mirror-web-app"
VERSION="3.0"  # Semantic versioning
TAG="${VERSION}"

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
            print_error "Unsupported architecture: $SYSTEM_ARCH"
            exit 1
            ;;
    esac
    print_status "Detected architecture: $ARCH_NAME"
}

# Check container runtime
check_container_runtime() {
    if command -v podman &> /dev/null; then
        CONTAINER_ENGINE="podman"
        print_success "Using Podman as container engine"
    elif command -v docker &> /dev/null; then
        CONTAINER_ENGINE="docker"
        print_success "Using Docker as container engine"
    else
        print_error "Neither Podman nor Docker found. Please install one of them."
        exit 1
    fi
}

# Check Quay.io login
check_quay_login() {
    print_status "Checking Quay.io login..."
    
    if ! $CONTAINER_ENGINE login quay.io --get-login &> /dev/null; then
        print_warning "Not logged into Quay.io. Please run: $CONTAINER_ENGINE login quay.io"
        print_status "Attempting to login..."
        $CONTAINER_ENGINE login quay.io
    else
        print_success "Already logged into Quay.io"
    fi
}

# Check if image already exists
check_existing_image() {
    local quay_tag="${IMAGE_NAME}:${TAG}-${ARCH}"
    
    print_status "Checking if image already exists: $quay_tag"
    
    if $CONTAINER_ENGINE manifest inspect $quay_tag &> /dev/null; then
        print_warning "Image $quay_tag already exists on Quay.io"
        read -p "Do you want to overwrite it? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Build cancelled by user"
            exit 0
        fi
        print_status "Proceeding with overwrite..."
    else
        print_success "Image does not exist, proceeding with build"
    fi
}

# Build image using container-run.sh
build_image() {
    print_status "Building image using container-run.sh..."
    
    # Build the image using the existing container-run.sh script
    ./container-run.sh --build-only
    
    if [ $? -eq 0 ]; then
        print_success "Image built successfully"
    else
        print_error "Failed to build image"
        exit 1
    fi
}

# Tag and push image
tag_and_push() {
    local local_tag="oc-mirror-web-app"
    local quay_tag="${IMAGE_NAME}:${TAG}-${ARCH}"
    local latest_tag="${IMAGE_NAME}:latest-${ARCH}"
    
    print_status "Tagging image for Quay.io..."
    print_status "Local tag: $local_tag"
    print_status "Quay tag: $quay_tag"
    print_status "Latest tag: $latest_tag"
    
    # Tag with version
    $CONTAINER_ENGINE tag $local_tag $quay_tag
    
    # Tag as latest
    $CONTAINER_ENGINE tag $local_tag $latest_tag
    
    print_status "Pushing versioned image to Quay.io..."
    $CONTAINER_ENGINE push $quay_tag
    
    if [ $? -eq 0 ]; then
        print_success "Versioned image pushed successfully: $quay_tag"
    else
        print_error "Failed to push versioned image"
        exit 1
    fi
    
    print_status "Pushing latest image to Quay.io..."
    $CONTAINER_ENGINE push $latest_tag
    
    if [ $? -eq 0 ]; then
        print_success "Latest image pushed successfully: $latest_tag"
    else
        print_error "Failed to push latest image"
        exit 1
    fi
}

# Clean up local images
cleanup_local_images() {
    print_status "Cleaning up local images..."
    
    local local_tag="oc-mirror-web-app"
    
    if $CONTAINER_ENGINE image exists $local_tag; then
        $CONTAINER_ENGINE rmi $local_tag
        print_success "Local image removed: $local_tag"
    fi
}

# Display final information
display_final_info() {
    print_success "Build and push completed successfully!"
    echo
    print_status "Available images on Quay.io:"
    print_status "  - ${IMAGE_NAME}:${TAG}-${ARCH} (versioned)"
    print_status "  - ${IMAGE_NAME}:latest-${ARCH} (latest)"
    echo
    print_status "Pull commands:"
    print_status "  $CONTAINER_ENGINE pull ${IMAGE_NAME}:${TAG}-${ARCH}"
    print_status "  $CONTAINER_ENGINE pull ${IMAGE_NAME}:latest-${ARCH}"
    echo
    print_status "Run commands:"
    print_status "  $CONTAINER_ENGINE run -p 3000:3001 ${IMAGE_NAME}:${TAG}-${ARCH}"
    print_status "  $CONTAINER_ENGINE run -p 3000:3001 ${IMAGE_NAME}:latest-${ARCH}"
}

# Show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  --version VERSION    Set custom version (default: $VERSION)"
    echo "  --no-cleanup         Skip cleanup of local images"
    echo "  --help               Show this help message"
    echo
    echo "Examples:"
    echo "  $0                    # Build and push with default version"
    echo "  $0 --version 3.1      # Build and push with custom version"
    echo "  $0 --no-cleanup       # Build and push without cleanup"
}

# Parse command line arguments
parse_arguments() {
    CLEANUP=true
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --version)
                VERSION="$2"
                TAG="$VERSION"
                shift 2
                ;;
            --no-cleanup)
                CLEANUP=false
                shift
                ;;
            --help)
                show_usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
}

# Main function
main() {
    print_status "Starting build and push for Quay.io"
    print_status "Image: $IMAGE_NAME"
    print_status "Version: $VERSION"
    print_status "Tag: $TAG"
    
    detect_architecture
    check_container_runtime
    check_quay_login
    check_existing_image
    build_image
    tag_and_push
    
    if [ "$CLEANUP" = true ]; then
        cleanup_local_images
    fi
    
    display_final_info
}

# Parse arguments and run main function
parse_arguments "$@"
main 