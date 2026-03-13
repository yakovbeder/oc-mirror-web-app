#!/bin/bash

# Host-side script to fetch all operator catalogs for different OCP versions
# This script runs on the host system where podman is available

# Allow errors to be collected instead of exiting immediately
set +e

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

OCP_VERSIONS=("4.16" "4.17" "4.18" "4.19" "4.20" "4.21")

# Catalog types to fetch
CATALOG_TYPES=(
    "redhat-operator-index"
    "certified-operator-index"
    "community-operator-index"
)

# Output directory for catalog data
CATALOG_DATA_DIR="./catalog-data"

# Configuration
MAX_PARALLEL_JOBS=${MAX_PARALLEL_JOBS:-3}  # Number of parallel catalog fetches
CLEANUP_IMAGES=${CLEANUP_IMAGES:-true}  # Remove images after extraction to save space

# Create output directory
mkdir -p "$CATALOG_DATA_DIR"

# Track processing statistics
TOTAL_CATALOGS=0
SUCCESSFUL_CATALOGS=0
FAILED_CATALOGS=0
FAILED_LIST=()

print_status "Starting catalog fetch for ${#OCP_VERSIONS[@]} OCP versions..."

# Function to extract catalog data from container (based on existing container.sh logic)
extract_catalog_data() {
    local catalog_type=$1
    local ocp_version=$2
    local catalog_url="registry.redhat.io/redhat/${catalog_type}:v${ocp_version}"
    local output_dir="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}"
    
    print_status "Fetching ${catalog_type} for OCP v${ocp_version}..."
    
    # Create output directory
    mkdir -p "$output_dir"
    
    # Generate unique container name
    local container_name="${catalog_type}-v${ocp_version}-$(date +%s)"
    local image_to_remove=""
    
    try_count=0
    max_retries=3
    
    while [ $try_count -lt $max_retries ]; do
        try_count=$((try_count + 1))
        
        print_status "Attempt $try_count: Pulling ${catalog_url}..."
        
        # Add timeout to prevent hanging and use pull secret if available
        local pull_args="--tls-verify=false"
        if [ -f "pull-secret/pull-secret.json" ]; then
            pull_args="--authfile pull-secret/pull-secret.json"
        fi
        
        # Try to pull the image
        if podman pull $pull_args "$catalog_url" 2>/dev/null; then
            print_success "Successfully pulled ${catalog_url}"
            image_to_remove="$catalog_url"
            break
        else
            print_warning "Failed to pull ${catalog_url} (attempt $try_count/$max_retries)"
            if [ $try_count -eq $max_retries ]; then
                print_error "Failed to pull ${catalog_url} after $max_retries attempts"
                return 1
            fi
            sleep 2
        fi
    done
    
    print_status "Running container to extract catalog data..."
    
    if podman run -d --name "$container_name" "$catalog_url" 2>/dev/null; then
        print_status "Container started, copying catalog data..."
        
        if podman cp "$container_name:/configs" "$output_dir/" 2>/dev/null; then
            print_success "Successfully extracted catalog data for ${catalog_type} v${ocp_version}"
            
            # Clean up container
            podman rm -f "$container_name" 2>/dev/null || true
            
            # Clean up image if requested (saves disk space)
            if [ "$CLEANUP_IMAGES" = "true" ] && [ -n "$image_to_remove" ]; then
                print_status "Removing image to save disk space: ${image_to_remove}"
                podman rmi "$image_to_remove" 2>/dev/null || true
            fi
            
            return 0
        else
            print_error "Failed to copy catalog data from container"
            podman rm -f "$container_name" 2>/dev/null || true
            return 1
        fi
    else
        print_error "Failed to start container for ${catalog_type} v${ocp_version}"
        return 1
    fi
}

# Function to process catalog data and generate operator/dependency metadata
process_catalog_data() {
    local catalog_type=$1
    local ocp_version=$2
    local catalog_dir="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}"
    local operators_file="${catalog_dir}/operators.json"
    local dependencies_file="${catalog_dir}/dependencies.json"
    
    if [ ! -d "${catalog_dir}/configs" ]; then
        print_warning "No configs directory found for ${catalog_type} v${ocp_version}"
        return 1
    fi
    
    print_status "Generating operator metadata for ${catalog_type} v${ocp_version}..."
    
    if ! python3 "scripts/catalog_metadata.py" generate \
        --catalog-dir "$catalog_dir" \
        --catalog-type "$catalog_type" \
        --ocp-version "v${ocp_version}" \
        --operators-file "$operators_file" \
        --dependencies-file "$dependencies_file"; then
        print_error "Failed to generate metadata for ${catalog_type} v${ocp_version}"
        return 1
    fi
    
    local operator_count=$(jq '. | length' "$operators_file" 2>/dev/null || echo "0")
    local dep_count=$(jq 'keys | length' "$dependencies_file" 2>/dev/null || echo "0")
    print_success "Generated metadata for $operator_count operators and $dep_count dependency entries in ${catalog_type} v${ocp_version}"
    
    # Create/update catalog-info.json with operator count
    cat > "${catalog_dir}/catalog-info.json" << EOF
{
  "catalog_type": "${catalog_type}",
  "ocp_version": "v${ocp_version}",
  "catalog_url": "registry.redhat.io/redhat/${catalog_type}:v${ocp_version}",
  "extracted_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "operator_count": ${operator_count}
}
EOF
}

# Main execution
main() {
    print_status "Starting catalog fetch process..."
    
    # Check if pull-secret.json exists
    if [ ! -f "pull-secret/pull-secret.json" ]; then
        print_error "pull-secret.json not found in pull-secret/ directory."
        print_error "Please ensure you have a valid pull-secret.json file to authenticate with Red Hat Registry."
        print_error "You can download it from: https://console.redhat.com/openshift/install/pull-secret"
        exit 1
    fi
    
    # Check if podman is available
    if ! command -v podman >/dev/null 2>&1; then
        print_error "podman is not available. Cannot fetch catalogs."
        print_error "Please install podman and try again."
        exit 1
    fi
    
    # Check if jq is available
    if ! command -v jq >/dev/null 2>&1; then
        print_error "jq is not available. Cannot process catalog data."
        print_error "Please install jq and try again."
        exit 1
    fi

    # Check if python3 is available
    if ! command -v python3 >/dev/null 2>&1; then
        print_error "python3 is not available. Cannot generate catalog metadata."
        print_error "Please install python3 and try again."
        exit 1
    fi

    # Check if PyYAML is available for structured catalog parsing
    if ! python3 - <<'PY' >/dev/null 2>&1
import yaml  # noqa: F401
PY
    then
        print_error "PyYAML is not available for python3. Cannot generate catalog metadata."
        print_error "Please install the python3 yaml package (for example, PyYAML) and try again."
        exit 1
    fi
    
    # Calculate total catalogs to process
    TOTAL_CATALOGS=$((${#OCP_VERSIONS[@]} * ${#CATALOG_TYPES[@]}))
    CURRENT_CATALOG=0
    
    # Build list of catalogs to process
    CATALOG_JOBS=()
    for ocp_version in "${OCP_VERSIONS[@]}"; do
        for catalog_type in "${CATALOG_TYPES[@]}"; do
            CATALOG_JOBS+=("${catalog_type}:${ocp_version}")
        done
    done
    
    print_status "Processing ${#CATALOG_JOBS[@]} catalogs with up to ${MAX_PARALLEL_JOBS} parallel jobs..."
    
    # Export functions for background jobs
    export -f extract_catalog_data process_catalog_data
    export -f print_status print_success print_warning print_error
    export CATALOG_DATA_DIR CLEANUP_IMAGES
    
    # Use background jobs for parallel processing
    # Track PIDs explicitly (avoids jobs -p in subshell, which is unreliable on macOS bash 3.2)
    local job_pids=()
    local job_num=0
    local results_file=$(mktemp)
    
    # Function to process single catalog in background
    process_catalog_job() {
        local catalog_type="$1"
        local ocp_version="$2"
        local job_num="$3"
        
        # Extract if needed, then always regenerate metadata from the extracted configs.
        if extract_catalog_data "$catalog_type" "$ocp_version"; then
            if process_catalog_data "$catalog_type" "$ocp_version"; then
                echo "SUCCESS:${catalog_type}:${ocp_version}" >> "$results_file"
                return 0
            fi
        fi
        
        echo "FAILED:${catalog_type}:${ocp_version}" >> "$results_file"
        return 1
    }
    export -f process_catalog_job
    
    # Process catalogs with controlled parallelism
    for catalog_job in "${CATALOG_JOBS[@]}"; do
        IFS=':' read -r catalog_type ocp_version <<< "$catalog_job"
        job_num=$((job_num + 1))
        
        # Wait for slot if we've reached max parallel jobs
        while [ ${#job_pids[@]} -ge "$MAX_PARALLEL_JOBS" ]; do
            # Poll for finished jobs (portable: works on macOS bash 3.2)
            for i in "${!job_pids[@]}"; do
                pid=${job_pids[$i]}
                if ! kill -0 "$pid" 2>/dev/null; then
                    wait "$pid" 2>/dev/null
                    unset 'job_pids[i]'
                    job_pids=("${job_pids[@]}")
                    break
                fi
            done
            sleep 1
        done
        
        # Start job in background
        process_catalog_job "$catalog_type" "$ocp_version" "$job_num" &
        job_pids+=($!)
    done
    
    # Wait for all remaining jobs
    for pid in "${job_pids[@]}"; do
        wait "$pid" 2>/dev/null
    done
    
    # Process results file to count successes/failures
    if [ -f "$results_file" ]; then
        while IFS= read -r result_line || [ -n "$result_line" ]; do
            if [[ "$result_line" == SUCCESS:* ]]; then
                SUCCESSFUL_CATALOGS=$((SUCCESSFUL_CATALOGS + 1))
            elif [[ "$result_line" == FAILED:* ]]; then
                FAILED_CATALOGS=$((FAILED_CATALOGS + 1))
                FAILED_LIST+=("${result_line#FAILED:}")
            fi
        done < "$results_file"
    fi
    
    rm -f "$results_file"
    
    # Create a master index of all catalogs
    print_status "Creating master catalog index..."
    
    cat > "${CATALOG_DATA_DIR}/catalog-index.json" << EOF
{
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "ocp_versions": $(printf '%s\n' "${OCP_VERSIONS[@]}" | jq -R . | jq -s .),
  "catalog_types": $(printf '%s\n' "${CATALOG_TYPES[@]}" | jq -R . | jq -s .),
  "catalogs": []
}
EOF
    
    # Add catalog entries to master index
    for ocp_version in "${OCP_VERSIONS[@]}"; do
        for catalog_type in "${CATALOG_TYPES[@]}"; do
            local catalog_dir="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}"
            local catalog_info="${catalog_dir}/catalog-info.json"
            
            if [ -f "$catalog_info" ]; then
                local catalog_entry=$(cat "$catalog_info")
                jq --argjson entry "$catalog_entry" '.catalogs += [$entry]' "${CATALOG_DATA_DIR}/catalog-index.json" > "${CATALOG_DATA_DIR}/catalog-index.json.tmp" && mv "${CATALOG_DATA_DIR}/catalog-index.json.tmp" "${CATALOG_DATA_DIR}/catalog-index.json"
            fi
        done
    done
    
    # Create master dependencies.json by merging all per-catalog dependency files
    print_status "Creating master dependencies index..."
    echo '{}' > "${CATALOG_DATA_DIR}/dependencies.json"
    
    for ocp_version in "${OCP_VERSIONS[@]}"; do
        for catalog_type in "${CATALOG_TYPES[@]}"; do
            local catalog_dir="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}"
            local deps_file="${catalog_dir}/dependencies.json"
            local catalog_key="${catalog_type}:v${ocp_version}"
            
            if [ -f "$deps_file" ]; then
                local deps_content=$(cat "$deps_file")
                jq --arg key "$catalog_key" --argjson deps "$deps_content" \
                   '. + {($key): $deps}' "${CATALOG_DATA_DIR}/dependencies.json" > "${CATALOG_DATA_DIR}/dependencies.json.tmp" && \
                mv "${CATALOG_DATA_DIR}/dependencies.json.tmp" "${CATALOG_DATA_DIR}/dependencies.json"
            fi
        done
    done
    
    local total_deps=$(jq '[.[] | keys | length] | add // 0' "${CATALOG_DATA_DIR}/dependencies.json" 2>/dev/null || echo "0")
    print_success "Created master dependencies.json with dependencies for $total_deps operators"
    
    print_success "Catalog fetch process completed!"
    print_status "Catalog data available in: $CATALOG_DATA_DIR"
    
    # Show summary
    echo ""
    echo "=========================================="
    echo "  Catalog Fetch Summary"
    echo "=========================================="
    echo ""
    
    echo "Statistics:"
    echo "  Total catalogs: ${TOTAL_CATALOGS}"
    echo "  Successful: ${SUCCESSFUL_CATALOGS}"
    echo "  Failed: ${FAILED_CATALOGS}"
    echo ""
    
    if [ ${#FAILED_LIST[@]} -gt 0 ]; then
        echo "Failed catalogs:"
        printf "  - %s\n" "${FAILED_LIST[@]}"
        echo ""
    fi
    
    for ocp_version in "${OCP_VERSIONS[@]}"; do
        echo "OCP v${ocp_version}:"
        for catalog_type in "${CATALOG_TYPES[@]}"; do
            local catalog_dir="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}"
            local operators_file="${catalog_dir}/operators.json"
            
            if [ -f "$operators_file" ]; then
                local operator_count=$(jq '. | length' "$operators_file" 2>/dev/null || echo "0")
                echo "  - ${catalog_type}: $operator_count operators"
            else
                echo "  - ${catalog_type}: failed"
            fi
        done
        echo ""
    done

    # Exit with error if any catalogs failed
    if [ $FAILED_CATALOGS -gt 0 ]; then
        exit 1
    fi
}

# Parse command line arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --parallel)
                MAX_PARALLEL_JOBS="$2"
                shift 2
                ;;
            --no-cleanup-images)
                CLEANUP_IMAGES=false
                shift
                ;;
            --help|-h)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --parallel N              Number of parallel catalog fetches (default: 3)"
                echo "  --no-cleanup-images       Don't remove images after extraction"
                echo "  --help, -h                Show this help message"
                echo ""
                echo "Environment Variables:"
                echo "  MAX_PARALLEL_JOBS         Same as --parallel"
                echo "  CLEANUP_IMAGES           Set to 'false' to disable image cleanup"
                echo ""
                echo "Examples:"
                echo "  $0                        # Use defaults (3 parallel)"
                echo "  $0 --parallel 5           # Use 5 parallel jobs"
                echo "  $0 --no-cleanup-images    # Keep images after extraction"
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
}

# Parse arguments before running main
parse_arguments "$@"

# Run main function
main 