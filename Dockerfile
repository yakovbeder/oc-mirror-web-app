# Multi-stage build for production
FROM node:22-slim AS builder

# Build arguments for metadata (all optional with defaults)
ARG BUILD_DATE=""
ARG VCS_REF=""
ARG VERSION=3.2

# Set working directory
WORKDIR /app

# Upgrade npm to latest
RUN npm install -g npm@11.6.2

# Copy package files
COPY package*.json ./

# Install dependencies and fix non-breaking vulnerabilities
# Use npm ci for faster, more reliable installs (requires package-lock.json)
# Suppress deprecation warnings from transitive dependencies (they don't affect functionality)
# Increase timeout to handle slow network connections
RUN npm config set fetch-timeout 300000 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    if [ -f package-lock.json ]; then \
      npm ci --no-fund --no-audit && npm audit fix || true; \
    else \
      npm install --no-fund --no-audit && npm audit fix || true; \
    fi

# Copy source code
COPY . .

# Fix linting issues automatically
RUN npm run lint:fix || true

# Build the React app
# Deprecation warnings are from transitive dependencies and don't affect functionality
RUN npm run build

# Production stage
FROM node:22-slim AS production

# Build arguments for metadata (all optional with defaults)
ARG BUILD_DATE=""
ARG VCS_REF=""
ARG VERSION=3.2
ARG TARGETARCH

# Upgrade npm to latest
RUN npm install -g npm@11.6.2

# Install system dependencies and OpenShift tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        wget \
        bash \
        tar \
        gzip \
        ca-certificates \
        libgpgme11 \
        jq && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Multi-architecture OpenShift client downloads
# Supports AMD64 and ARM64 architectures
# Uses the new multi-architecture mirror URLs for better architecture detection
ENV OC_URL_AMD64="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable/openshift-client-linux.tar.gz"
ENV OC_URL_ARM64="https://mirror.openshift.com/pub/openshift-v4/multi/clients/ocp/stable/arm64/openshift-client-linux.tar.gz"
ENV OCMIRROR_URL_AMD64="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable/oc-mirror.tar.gz"
ENV OCMIRROR_URL_ARM64="https://mirror.openshift.com/pub/openshift-v4/aarch64/clients/ocp/stable/oc-mirror.rhel9.tar.gz"

# Download and install oc and oc-mirror for the correct architecture
RUN if [ "$TARGETARCH" = "arm64" ]; then \
      OC_URL=$OC_URL_ARM64; \
      OCMIRROR_URL=$OCMIRROR_URL_ARM64; \
    else \
      OC_URL=$OC_URL_AMD64; \
      OCMIRROR_URL=$OCMIRROR_URL_AMD64; \
    fi && \
    wget -O /tmp/oc.tar.gz "$OC_URL" && \
    tar -xzf /tmp/oc.tar.gz -C /usr/local/bin/ && \
    chmod +x /usr/local/bin/oc && \
    rm /tmp/oc.tar.gz && \
    wget -O /tmp/oc-mirror.tar.gz "$OCMIRROR_URL" && \
    tar -xzf /tmp/oc-mirror.tar.gz -C /usr/local/bin/ && \
    chmod +x /usr/local/bin/oc-mirror && \
    rm /tmp/oc-mirror.tar.gz && \
    which oc && oc version --client && \
    which oc-mirror && oc-mirror version && \
    which node && node --version && \
    which npm && npm --version && \
    which curl && curl --version

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies and fix non-breaking vulnerabilities
# Use npm ci for faster, more reliable installs (requires package-lock.json)
# Suppress deprecation warnings from transitive dependencies
# Increase timeout to handle slow network connections
RUN npm config set fetch-timeout 300000 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    if [ -f package-lock.json ]; then \
      npm ci --only=production --no-fund --no-audit && \
      npm audit fix || true && \
      npm cache clean --force; \
    else \
      npm install --only=production --no-fund --no-audit && \
      npm audit fix || true && \
      npm cache clean --force; \
    fi

# Copy built React app from builder stage
COPY --from=builder /app/build ./build

# Copy server code
COPY server ./server

# Copy pre-fetched catalog data - only essential files (~2.4MB instead of ~2.4GB)
# These files contain all operator information: names, channels, defaultChannel, and dependencies
# Temporarily copy entire catalog-data from builder stage to filter essential files
COPY --from=builder /app/catalog-data /tmp/builder-catalog

# Extract only essential files: catalog-index.json, operators.json, and dependencies.json
# (excludes large configs/ directories ~2.4GB)
# This reduces image size from ~2.4GB to ~2.4MB for catalog data while preserving all functionality
RUN mkdir -p ./catalog-data && \
    (cp /tmp/builder-catalog/catalog-index.json ./catalog-data/ 2>/dev/null || \
     echo '{"generated_at":"","ocp_versions":[],"catalog_types":[],"catalogs":[]}' > ./catalog-data/catalog-index.json) && \
    (cp /tmp/builder-catalog/dependencies.json ./catalog-data/ 2>/dev/null || \
     echo '{}' > ./catalog-data/dependencies.json) && \
    find /tmp/builder-catalog -type f \( -name "operators.json" -o -name "dependencies.json" \) ! -path "*/configs/*" 2>/dev/null | while read file; do \
      rel_path=$(echo "$file" | sed 's|/tmp/builder-catalog/||'); \
      mkdir -p "./catalog-data/$(dirname "$rel_path")"; \
      cp "$file" "./catalog-data/$rel_path"; \
    done && \
    rm -rf /tmp/builder-catalog

# Use existing 'node' user from official Node.js image (UID 1000)
# Create directories and set ownership
RUN mkdir -p /app/data && \
    chown -R node:node /app

# Add build metadata labels
LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="OC Mirror Web App" \
      org.opencontainers.image.description="Web application for OpenShift Container Platform mirroring operations" \
      org.opencontainers.image.source="https://github.com/yakovbeder/oc-mirror-web-app"

# Copy entrypoint script to fix permissions on mounted volumes at runtime
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Switch to non-root user (node user with UID 1000 already exists in official Node.js image)
USER node

# Expose port
EXPOSE 3001

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

# Use entrypoint to fix permissions before starting application
ENTRYPOINT ["/entrypoint.sh"]

# Start the application
CMD ["node", "server/index.js"] 