#!/bin/bash

# Cron script for daily catalog fetch and Quay.io build
# Runs at 00:00 daily via cron

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs/cron"
LOG_FILE="${LOG_DIR}/build-$(date +%Y%m%d-%H%M%S).log"
VERSION="${BUILD_VERSION:-3.3}"

# Create log directory if it doesn't exist
mkdir -p "${LOG_DIR}"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOG_FILE}"
}

# Main execution
main() {
    log "=========================================="
    log "Starting daily build process"
    log "Version: ${VERSION}"
    log "Working directory: ${SCRIPT_DIR}"
    log "=========================================="
    
    cd "${SCRIPT_DIR}"
    
    # Step 1: Fetch catalogs
    log "Step 1: Fetching operator catalogs..."
    if ./container-run.sh --fetch-catalogs >> "${LOG_FILE}" 2>&1; then
        log "✓ Catalog fetch completed successfully"
    else
        log "✗ Catalog fetch failed!"
        exit 1
    fi
    
    # Step 2: Build and push to Quay.io
    log "Step 2: Building and pushing to Quay.io..."
    if ./build-for-quay/build-for-quay.sh --version "${VERSION}" >> "${LOG_FILE}" 2>&1; then
        log "✓ Quay.io build and push completed successfully"
    else
        log "✗ Quay.io build failed!"
        exit 1
    fi
    
    log "=========================================="
    log "Daily build process completed successfully"
    log "=========================================="
    
    # Cleanup old logs (keep last 30 days)
    find "${LOG_DIR}" -name "build-*.log" -mtime +30 -delete 2>/dev/null || true
}

main "$@"
