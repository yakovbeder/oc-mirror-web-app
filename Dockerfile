# Multi-stage build for production
FROM node:20 AS builder

# Set working directory
WORKDIR /app

# Upgrade npm to latest
RUN npm install -g npm@latest

# Copy package files
COPY package*.json ./

# Install dependencies and fix non-breaking vulnerabilities
RUN npm install && npm audit fix || true

# Copy source code
COPY . .

# Fix linting issues automatically
RUN npm run lint:fix || true

# Build the React app
RUN npm run build

# Production stage
FROM node:20 AS production

# Set build argument for architecture (default to amd64)
ARG TARGETARCH=amd64

# Upgrade npm to latest
RUN npm install -g npm@latest

# Install system dependencies and OpenShift tools
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    bash \
    tar \
    gzip \
    ca-certificates \
    libgpgme11 \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Set URLs for oc and oc-mirror based on architecture
ENV OC_URL_AMD64="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/openshift-client-linux.tar.gz"
ENV OC_URL_ARM64="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/openshift-client-linux-arm64.tar.gz"
ENV OCMIRROR_URL_AMD64="https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/latest/oc-mirror.rhel9.tar.gz"
ENV OCMIRROR_URL_ARM64="https://mirror.openshift.com/pub/openshift-v4/aarch64/clients/ocp/latest/oc-mirror.rhel9.tar.gz"

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
    rm /tmp/oc-mirror.tar.gz

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies and fix non-breaking vulnerabilities
RUN npm install --only=production && npm audit fix || true && npm cache clean --force



# Copy built React app from builder stage
COPY --from=builder /app/build ./build

# Copy server code
COPY server ./server

# Copy pre-fetched catalog data (if available)
COPY catalog-data ./catalog-data

# Create data directory
RUN mkdir -p /app/data

# Create non-root user
RUN groupadd -r nodejs -g 1001 && \
    useradd -r -g nodejs -u 1001 nodejs

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check (Docker format - Podman will show warning but ignore gracefully)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/api/system/info || exit 1

# Start the application
CMD ["node", "server/index.js"] 