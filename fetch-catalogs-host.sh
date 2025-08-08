#!/bin/bash

# Host-side script to fetch all operator catalogs for different OCP versions
# This script runs on the host system where podman is available

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

OCP_VERSIONS=("4.15" "4.16" "4.17" "4.18" "4.19")

# Catalog types to fetch
CATALOG_TYPES=(
    "redhat-operator-index"
    "certified-operator-index"
    "community-operator-index"
)

# Output directory for catalog data
CATALOG_DATA_DIR="./catalog-data"

# Create output directory
mkdir -p "$CATALOG_DATA_DIR"

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
        if podman pull $pull_args "$catalog_url"; then
            print_success "Successfully pulled ${catalog_url}"
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
            
            # Create a summary file with catalog info
            cat > "${output_dir}/catalog-info.json" << EOF
{
  "catalog_type": "${catalog_type}",
  "ocp_version": "v${ocp_version}",
  "catalog_url": "${catalog_url}",
  "extracted_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "operator_count": $(jq '. | length' "${output_dir}/operators.json" 2>/dev/null || echo "0")
}
EOF
        else
            print_error "Failed to copy catalog data from container"
        fi
        
        # Clean up container
        podman rm -f "$container_name" 2>/dev/null || true
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
                operator_name=$(jq -cs -r '.[0] | .name // empty' "$json_file" 2>/dev/null)
                default_channel=$(jq -cs -r '.[0] | .defaultChannel // empty' "$json_file" 2>/dev/null)
                if [ -n "$default_channel" ] && [ "$default_channel" != "null" ]; then
                    # Extract all channels using the pattern from user's example
                    # Look for entries that are channels (not the operator name itself)
                    channels=$(jq -cs -r '.[] | .name // empty' "$json_file" 2>/dev/null | grep -v "^$" | grep -v "^${operator_name}$" | sort -u | tr '\n' ' ' | sed 's/ $//')
                    
                    # If no channels found, try alternative approach looking for channel entries
                    if [ -z "$channels" ]; then
                        channels=$(jq -cs -r '.[] | .entries[].name // empty' "$json_file" 2>/dev/null | grep -v "^$" | sort -u | tr '\n' ' ' | sed 's/ $//')
                    fi
                fi
            elif [ -f "$index_json" ]; then
                json_file="$index_json"
                # Handle index.json with multiple JSON objects (same as catalog.json)
                operator_name=$(jq -cs -r '.[0] | .name // empty' "$json_file" 2>/dev/null)
                default_channel=$(jq -cs -r '.[0] | .defaultChannel // empty' "$json_file" 2>/dev/null)
                if [ -n "$default_channel" ] && [ "$default_channel" != "null" ]; then
                    # Extract all channels using the pattern from user's example
                    # Look for entries that are channels (not the operator name itself)
                    channels=$(jq -cs -r '.[] | .name // empty' "$json_file" 2>/dev/null | grep -v "^$" | grep -v "^${operator_name}$" | sort -u | tr '\n' ' ' | sed 's/ $//')
                    
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
                    # Extract all channel names from channel files in channels/ directory
                    channels=$(find "${operator_dir}/channels" -name "channel-*.json" -exec basename {} \; | sed 's/channel-\(.*\)\.json/\1/' | sort -u | tr '\n' ' ' | sed 's/ $//')
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
                     channels: [$channels],
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
}

# Main execution
main() {
    print_status "Starting catalog fetch process..."
    
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
    
    # Fetch catalogs for each version and type
    for ocp_version in "${OCP_VERSIONS[@]}"; do
        for catalog_type in "${CATALOG_TYPES[@]}"; do
            if extract_catalog_data "$catalog_type" "$ocp_version"; then
                process_catalog_data "$catalog_type" "$ocp_version"
            else
                print_warning "Skipping ${catalog_type} v${ocp_version} due to fetch failure"
            fi
        done
    done
    
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
    
    print_success "Catalog fetch process completed!"
    print_status "Catalog data available in: $CATALOG_DATA_DIR"
    
    # Show summary
    echo ""
    echo "=========================================="
    echo "  Catalog Fetch Summary"
    echo "=========================================="
    echo ""
    
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
}

# Run main function
main "$@" 