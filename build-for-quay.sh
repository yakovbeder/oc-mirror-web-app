#!/bin/bash

# Build and push script for Quay.io
# Detects architecture and builds/pushes appropriate image

set -e

# Configuration
IMAGE_NAME="quay.io/rh-ee-ybeder/oc-mirror-web-app"
VERSION=$(date +%Y%m%d-%H%M%S)
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

# Main function
main() {
    print_status "Starting build and push for Quay.io"
    print_status "Image: $IMAGE_NAME"
    print_status "Tag: $TAG"
    
    detect_architecture
    check_container_runtime
    check_quay_login
    build_image
    tag_and_push
    
    print_success "Build and push completed successfully!"
    print_status "Available images:"
    print_status "  - ${IMAGE_NAME}:${TAG}-${ARCH} (versioned)"
    print_status "  - ${IMAGE_NAME}:latest-${ARCH} (latest)"
}

# Run main function
main "$@" 