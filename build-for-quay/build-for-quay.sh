#!/bin/bash

# Build and push script for Quay.io
# Detects architecture and builds/pushes appropriate image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACKAGE_JSON="${PROJECT_DIR}/package.json"

read_package_version() {
    if [ ! -f "${PACKAGE_JSON}" ]; then
        echo "4.1"
        return 0
    fi

    local package_version
    package_version="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "${PACKAGE_JSON}" | sed -n '1p')"

    if [ -n "${package_version}" ]; then
        echo "${package_version}"
    else
        echo "4.1"
    fi
}

# Configuration
IMAGE_NAME="quay.io/rh-ee-ybeder/oc-mirror-web-app"
LOCAL_IMAGE_NAME="localhost/oc-mirror-web-app"
VERSION="${BUILD_VERSION:-$(read_package_version)}"
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
    else
        print_error "Podman not found. Please install Podman."
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
    "${PROJECT_DIR}/container-run.sh" --build-only --version "${VERSION}"
    
    if [ $? -eq 0 ]; then
        print_success "Image built successfully"
    else
        print_error "Failed to build image"
        exit 1
    fi
}

# Tag and push image
tag_and_push() {
    local quay_tag="${IMAGE_NAME}:${TAG}-${ARCH}"
    local latest_tag="${IMAGE_NAME}:latest-${ARCH}"
    
    print_status "Tagging image for Quay.io..."
    print_status "Local tag: $LOCAL_IMAGE_NAME"
    print_status "Quay tag: $quay_tag"
    print_status "Latest tag: $latest_tag"
    
    # Tag with version
    $CONTAINER_ENGINE tag "$LOCAL_IMAGE_NAME" "$quay_tag"
    
    # Tag as latest
    $CONTAINER_ENGINE tag "$LOCAL_IMAGE_NAME" "$latest_tag"
    
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

    local image_refs=(
        "${IMAGE_NAME}:latest-${ARCH}"
        "${IMAGE_NAME}:${TAG}-${ARCH}"
        "${LOCAL_IMAGE_NAME}"
    )

    for image_ref in "${image_refs[@]}"; do
        if $CONTAINER_ENGINE image exists "$image_ref"; then
            $CONTAINER_ENGINE rmi "$image_ref" >/dev/null
            print_success "Local image removed: $image_ref"
        fi
    done
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
      echo "  --tag TAG            Set custom tag (default: $VERSION)"
      echo "  --version VERSION    Set custom version (default: $VERSION)"
      echo "  --no-cleanup         Skip cleanup of local images"
      echo "  --help               Show this help message"
      echo
      echo "Examples:"
      echo "  $0                    # Build and push with default version"
      echo "  $0 --tag v4.1         # Build and push with custom tag"
      echo "  $0 --version 4.1      # Build and push with custom version"
      echo "  $0 --no-cleanup       # Build and push without cleanup"
}

# Parse command line arguments
parse_arguments() {
    CLEANUP=true
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --tag)
                if [ $# -lt 2 ]; then
                    print_error "--tag requires a value"
                    exit 1
                fi
                TAG="$2"
                shift 2
                ;;
            --version)
                if [ $# -lt 2 ]; then
                    print_error "--version requires a value"
                    exit 1
                fi
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
    cd "${PROJECT_DIR}"

    print_status "Starting build and push for Quay.io"
    print_status "Image: $IMAGE_NAME"
    print_status "Local image: $LOCAL_IMAGE_NAME"
    print_status "Version: $VERSION"
    print_status "Tag: $TAG"
    
    detect_architecture
    check_container_runtime
    check_quay_login
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