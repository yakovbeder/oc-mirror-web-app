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

OCP_VERSIONS=("4.16" "4.17" "4.18" "4.19" "4.20")

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
CATALOG_FRESHNESS_HOURS=${CATALOG_FRESHNESS_HOURS:-24}  # Skip if catalog is newer than this (hours)
CLEANUP_IMAGES=${CLEANUP_IMAGES:-true}  # Remove images after extraction to save space

# Create output directory
mkdir -p "$CATALOG_DATA_DIR"

# Track processing statistics
TOTAL_CATALOGS=0
SUCCESSFUL_CATALOGS=0
FAILED_CATALOGS=0
SKIPPED_CATALOGS=0
FAILED_LIST=()

print_status "Starting catalog fetch for ${#OCP_VERSIONS[@]} OCP versions..."

# Function to check if catalog is fresh and can be skipped
is_catalog_fresh() {
    local catalog_type=$1
    local ocp_version=$2
    local catalog_dir="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}"
    local catalog_info="${catalog_dir}/catalog-info.json"
    
    if [ ! -f "$catalog_info" ]; then
        return 1  # Not fresh (doesn't exist)
    fi
    
    # Check if catalog-info.json is recent enough
    local catalog_age_seconds=$(( $(date +%s) - $(stat -c %Y "$catalog_info" 2>/dev/null || echo 0) ))
    local freshness_seconds=$((CATALOG_FRESHNESS_HOURS * 3600))
    
    if [ $catalog_age_seconds -lt $freshness_seconds ]; then
        return 0  # Fresh
    else
        return 1  # Stale
    fi
}

# Function to extract catalog data from container (based on existing container.sh logic)
extract_catalog_data() {
    local catalog_type=$1
    local ocp_version=$2
    local catalog_url="registry.redhat.io/redhat/${catalog_type}:v${ocp_version}"
    local output_dir="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}"
    
    print_status "Fetching ${catalog_type} for OCP v${ocp_version}..."
    
    # Check if catalog is fresh and can be skipped
    if is_catalog_fresh "$catalog_type" "$ocp_version"; then
        print_status "Skipping ${catalog_type} v${ocp_version} (catalog is fresh, less than ${CATALOG_FRESHNESS_HOURS} hours old)"
        return 0
    fi
    
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

# Function to process catalog data and create operator index (based on existing logic)
process_catalog_data() {
    local catalog_type=$1
    local ocp_version=$2
    local catalog_dir="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}"
    local operators_file="${catalog_dir}/operators.json"
    
    if [ ! -d "${catalog_dir}/configs" ]; then
        print_warning "No configs directory found for ${catalog_type} v${ocp_version}"
        return
    fi
    
    print_status "Processing operators for ${catalog_type} v${ocp_version}..."
    
    # Initialize operators array
    echo '[]' > "$operators_file"
    
    # Process each operator directory (based on existing container.sh logic)
    for operator_dir in "${catalog_dir}/configs"/*; do
        if [ -d "$operator_dir" ]; then
            local catalog_json="${operator_dir}/catalog.json"
            local index_json="${operator_dir}/index.json"
            local index_yaml="${operator_dir}/index.yaml"
            local package_json="${operator_dir}/package.json"
            local channel_json="${operator_dir}/channels.json"
            local catalog_yaml="${operator_dir}/catalog.yaml"
            local catalog_yml="${operator_dir}/catalog.yml"
            
            local json_file=""
            local operator_name=""
            local default_channel=""
            local channels=""
            
            # Try different file formats
            if [ -f "$catalog_json" ]; then
                json_file="$catalog_json"
                # Handle catalog.json with multiple JSON objects (using -cs for compact and slurp)
                # Get operator name and default channel from olm.package object
                operator_name=$(jq -cs -r '.[] | select(.schema == "olm.package") | .name // empty' "$json_file" 2>/dev/null)
                default_channel=$(jq -cs -r '.[] | select(.schema == "olm.package") | .defaultChannel // empty' "$json_file" 2>/dev/null)
                if [ -n "$default_channel" ] && [ "$default_channel" != "null" ]; then
                    # Extract only channel names from olm.channel schema objects (not bundle names from olm.bundle)
                    channels=$(jq -cs -r '.[] | select(.schema == "olm.channel") | .name // empty' "$json_file" 2>/dev/null | grep -v "^$" | sort -u | tr '\n' ' ' | sed 's/ $//')
                    
                    # Also check for separate channel files (e.g., stable-3.9.json, stable-3.10.json, quay-v3.5.json)
                    # These files contain olm.channel schema objects for additional channels
                    for channel_file in "${operator_dir}"/*.json; do
                        if [ -f "$channel_file" ] && [ "$channel_file" != "$catalog_json" ] && [ "$(basename "$channel_file")" != "released-bundles.json" ]; then
                            # Extract channel name from separate channel file
                            local extra_channel=$(jq -cs -r '.[] | select(.schema == "olm.channel") | .name // empty' "$channel_file" 2>/dev/null | head -1)
                            if [ -n "$extra_channel" ] && [ "$extra_channel" != "null" ]; then
                                channels="$channels $extra_channel"
                            fi
                        fi
                    done
                    # Remove duplicates and sort
                    channels=$(echo "$channels" | tr ' ' '\n' | grep -v "^$" | sort -V | uniq | tr '\n' ' ' | sed 's/ $//')
                    
                    # If no channels found, try alternative approach looking for channel entries
                    if [ -z "$channels" ]; then
                        channels=$(jq -cs -r '.[] | .entries[].name // empty' "$json_file" 2>/dev/null | grep -v "^$" | sort -u | tr '\n' ' ' | sed 's/ $//')
                    fi
                fi
            elif [ -f "$index_json" ]; then
                json_file="$index_json"
                # Handle index.json with multiple JSON objects (same as catalog.json)
                # Get operator name and default channel from olm.package object
                operator_name=$(jq -cs -r '.[] | select(.schema == "olm.package") | .name // empty' "$json_file" 2>/dev/null)
                default_channel=$(jq -cs -r '.[] | select(.schema == "olm.package") | .defaultChannel // empty' "$json_file" 2>/dev/null)
                if [ -n "$default_channel" ] && [ "$default_channel" != "null" ]; then
                    # Extract only channel names from olm.channel schema objects (not bundle names from olm.bundle)
                    channels=$(jq -cs -r '.[] | select(.schema == "olm.channel") | .name // empty' "$json_file" 2>/dev/null | grep -v "^$" | sort -u | tr '\n' ' ' | sed 's/ $//')
                    
                    # Also check for separate channel files (e.g., stable-3.9.json, stable-3.10.json, quay-v3.5.json)
                    # These files contain olm.channel schema objects for additional channels
                    for channel_file in "${operator_dir}"/*.json; do
                        if [ -f "$channel_file" ] && [ "$channel_file" != "$index_json" ] && [ "$(basename "$channel_file")" != "released-bundles.json" ]; then
                            # Extract channel name from separate channel file
                            local extra_channel=$(jq -cs -r '.[] | select(.schema == "olm.channel") | .name // empty' "$channel_file" 2>/dev/null | head -1)
                            if [ -n "$extra_channel" ] && [ "$extra_channel" != "null" ]; then
                                channels="$channels $extra_channel"
                            fi
                        fi
                    done
                    # Remove duplicates and sort
                    channels=$(echo "$channels" | tr ' ' '\n' | grep -v "^$" | sort -V | uniq | tr '\n' ' ' | sed 's/ $//')
                    
                    # If no channels found, try alternative approach looking for channel entries
                    if [ -z "$channels" ]; then
                        channels=$(jq -cs -r '.[] | .entries[].name // empty' "$json_file" 2>/dev/null | grep -v "^$" | sort -u | tr '\n' ' ' | sed 's/ $//')
                    fi
                fi
            elif [ -f "$index_yaml" ]; then
                # Handle index.yaml files (like lightspeed-operator)
                operator_name=$(grep "^name:" "$index_yaml" | head -1 | sed 's/^name: //' 2>/dev/null)
                default_channel=$(grep "^defaultChannel:" "$index_yaml" | head -1 | sed 's/^defaultChannel: //' 2>/dev/null)
                # For index.yaml files, we'll set channels to empty for now (complex structure)
                channels=""
            elif [ -f "$package_json" ] && [ -f "$channel_json" ]; then
                # Handle package.json + channels.json format
                operator_name=$(jq -r '.name // empty' "$package_json" 2>/dev/null)
                default_channel=$(jq -r '.defaultChannel // empty' "$package_json" 2>/dev/null)
                if [ -n "$default_channel" ] && [ "$default_channel" != "null" ]; then
                    # Extract all channel names from channels.json (multiple JSON objects)
                    channels=$(jq -r '.name // empty' "$channel_json" 2>/dev/null | grep -v "^$" | sort -u | tr '\n' ' ' | sed 's/ $//')
                fi
            elif [ -f "$catalog_yaml" ] || [ -f "$catalog_yml" ]; then
                # Handle catalog.yaml or catalog.yml files (YAML format)
                if [ -f "$catalog_yaml" ]; then
                    yaml_file="$catalog_yaml"
                else
                    yaml_file="$catalog_yml"
                fi
                # Use grep/sed approach which is more reliable for this YAML structure
                operator_name=$(grep -n "name:" "$yaml_file" | grep -v "package:" | head -1 | sed 's/.*name: //' 2>/dev/null)
                default_channel=$(grep "defaultChannel:" "$yaml_file" | head -1 | sed 's/.*defaultChannel: //' 2>/dev/null)
                # For YAML files, we'll set channels to empty for now (complex structure)
                channels=""
            elif [ -f "$package_json" ] && [ -d "${operator_dir}/channels" ]; then
                # Handle package.json + channels/ directory format (like volsync-product)
                operator_name=$(jq -r '.name // empty' "$package_json" 2>/dev/null)
                default_channel=$(jq -r '.defaultChannel // empty' "$package_json" 2>/dev/null)
                if [ -n "$default_channel" ] && [ "$default_channel" != "null" ]; then
                    # Extract channel names and bundle names from channel files in channels/ directory
                    local channel_names=""
                    local bundle_names=""
                    
                    # Get channel names from filenames
                    channel_names=$(find "${operator_dir}/channels" -name "channel-*.json" -exec basename {} \; | sed 's/channel-\(.*\)\.json/\1/' | sort -u | tr '\n' ' ' | sed 's/ $//')
                    
                    # Get bundle names from entries in each channel file
                    for channel_file in "${operator_dir}/channels"/channel-*.json; do
                        if [ -f "$channel_file" ]; then
                            local entries=$(jq -r '.entries[].name // empty' "$channel_file" 2>/dev/null | grep -v "^$")
                            if [ -n "$entries" ]; then
                                bundle_names="${bundle_names}${entries}"$'\n'
                            fi
                        fi
                    done
                    
                    # Combine channel names and bundle names, remove duplicates
                    channels=$(echo "${channel_names} ${bundle_names}" | tr '\n' ' ' | tr -s ' ' | sed 's/^ *//;s/ *$//')
                fi
            elif [ -f "$package_json" ]; then
                # Handle package.json only (fallback)
                operator_name=$(jq -r '.name // empty' "$package_json" 2>/dev/null)
                default_channel=$(jq -r '.defaultChannel // empty' "$package_json" 2>/dev/null)
                # For package.json only, we'll set a placeholder for channels
                channels=""
            else
                print_warning "No supported catalog files found in $operator_dir"
                continue
            fi
            
            # Extract operator information using jq (based on existing logic)
            if command -v jq >/dev/null 2>&1 && [ -n "$operator_name" ] && [ "$operator_name" != "null" ]; then
                # Create operator entry using jq to avoid JSON escaping issues
                jq --arg name "$operator_name" \
                   --arg defaultChannel "$default_channel" \
                   --arg channels "$channels" \
                   --arg catalog "${catalog_type}" \
                   --arg ocpVersion "v${ocp_version}" \
                   --arg catalogUrl "registry.redhat.io/redhat/${catalog_type}:v${ocp_version}" \
                   -n '{
                     name: $name,
                     defaultChannel: $defaultChannel,
                     channels: ($channels | split(" ") | map(select(. != ""))),
                     catalog: $catalog,
                     ocpVersion: $ocpVersion,
                     catalogUrl: $catalogUrl
                   }' | jq --argjson entry "$(cat)" '. += [$entry]' "$operators_file" > "${operators_file}.tmp" && mv "${operators_file}.tmp" "$operators_file"
                
                # Debug output
                print_status "Successfully extracted operator: $operator_name (default: $default_channel, all channels: $channels)"
            else
                print_warning "Could not extract operator information from $operator_dir"
            fi
        fi
    done
    
    local operator_count=$(jq '. | length' "$operators_file")
    print_success "Processed $operator_count operators for ${catalog_type} v${ocp_version}"
    
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
    export -f extract_catalog_data process_catalog_data is_catalog_fresh
    export -f print_status print_success print_warning print_error
    export CATALOG_DATA_DIR CATALOG_FRESHNESS_HOURS CLEANUP_IMAGES
    
    # Use background jobs for parallel processing
    local active_jobs=0
    local job_num=0
    local results_file=$(mktemp)
    
    # Function to process single catalog in background
    process_catalog_job() {
        local catalog_type="$1"
        local ocp_version="$2"
        local job_num="$3"
        
        # Check freshness first
        if is_catalog_fresh "$catalog_type" "$ocp_version"; then
            echo "SKIPPED:${catalog_type}:${ocp_version}" >> "$results_file"
            return 0
        fi
        
        # Extract and process
        if extract_catalog_data "$catalog_type" "$ocp_version"; then
            process_catalog_data "$catalog_type" "$ocp_version"
            echo "SUCCESS:${catalog_type}:${ocp_version}" >> "$results_file"
            return 0
        else
            echo "FAILED:${catalog_type}:${ocp_version}" >> "$results_file"
            return 1
        fi
    }
    export -f process_catalog_job
    
    # Process catalogs with controlled parallelism
    for catalog_job in "${CATALOG_JOBS[@]}"; do
        IFS=':' read -r catalog_type ocp_version <<< "$catalog_job"
        job_num=$((job_num + 1))
        
        # Wait for slot if we've reached max parallel jobs
        while [ $active_jobs -ge "$MAX_PARALLEL_JOBS" ]; do
            # Wait for any background job to finish (bash 4.3+)
            if command -v wait >/dev/null 2>&1; then
                # Try wait -n (bash 4.3+), fallback to polling
                wait -n 2>/dev/null && active_jobs=$((active_jobs - 1)) || {
                    sleep 1
                    # Check which jobs finished
                    for pid in $(jobs -p); do
                        if ! kill -0 "$pid" 2>/dev/null; then
                            wait "$pid" 2>/dev/null
                            active_jobs=$((active_jobs - 1))
                        fi
                    done
                }
            else
                sleep 1
                # Check which jobs finished
                for pid in $(jobs -p); do
                    if ! kill -0 "$pid" 2>/dev/null; then
                        wait "$pid" 2>/dev/null
                        active_jobs=$((active_jobs - 1))
                    fi
                done
            fi
        done
        
        # Start job in background
        process_catalog_job "$catalog_type" "$ocp_version" "$job_num" &
        active_jobs=$((active_jobs + 1))
    done
    
    # Wait for all remaining jobs
    for pid in $(jobs -p); do
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
            elif [[ "$result_line" == SKIPPED:* ]]; then
                SKIPPED_CATALOGS=$((SKIPPED_CATALOGS + 1))
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
    
    # Calculate final statistics
    local processed_catalogs=$((SUCCESSFUL_CATALOGS + FAILED_CATALOGS + SKIPPED_CATALOGS))
    
    print_success "Catalog fetch process completed!"
    print_status "Catalog data available in: $CATALOG_DATA_DIR"
    
    # Show summary
    echo ""
    echo "=========================================="
    echo "  Catalog Fetch Summary"
    echo "=========================================="
    echo ""
    local progress_percent=0
    if [ $TOTAL_CATALOGS -gt 0 ]; then
        local processed=$((SUCCESSFUL_CATALOGS + FAILED_CATALOGS + SKIPPED_CATALOGS))
        progress_percent=$((processed * 100 / TOTAL_CATALOGS))
    fi
    
    echo "Statistics:"
    echo "  Total catalogs: ${TOTAL_CATALOGS}"
    echo "  Successful: ${SUCCESSFUL_CATALOGS}"
    echo "  Failed: ${FAILED_CATALOGS}"
    echo "  Skipped (fresh): ${SKIPPED_CATALOGS}"
    echo "  Progress: ${progress_percent}%"
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
            --freshness-hours)
                CATALOG_FRESHNESS_HOURS="$2"
                shift 2
                ;;
            --no-cleanup-images)
                CLEANUP_IMAGES=false
                shift
                ;;
            --force)
                CATALOG_FRESHNESS_HOURS=0  # Force refresh all catalogs
                shift
                ;;
            --help|-h)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --parallel N              Number of parallel catalog fetches (default: 3)"
                echo "  --freshness-hours N       Skip catalogs newer than N hours (default: 24)"
                echo "  --force                   Force refresh all catalogs (ignore freshness)"
                echo "  --no-cleanup-images       Don't remove images after extraction"
                echo "  --help, -h                Show this help message"
                echo ""
                echo "Environment Variables:"
                echo "  MAX_PARALLEL_JOBS         Same as --parallel"
                echo "  CATALOG_FRESHNESS_HOURS   Same as --freshness-hours"
                echo "  CLEANUP_IMAGES           Set to 'false' to disable image cleanup"
                echo ""
                echo "Examples:"
                echo "  $0                        # Use defaults (3 parallel, 24h freshness)"
                echo "  $0 --parallel 5           # Use 5 parallel jobs"
                echo "  $0 --force                # Force refresh all catalogs"
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