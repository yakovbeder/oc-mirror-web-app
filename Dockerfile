FROM node:22-slim AS builder

ARG BUILD_DATE=""
ARG VCS_REF=""
ARG VERSION=4.2

WORKDIR /app
RUN npm install -g npm@11.6.2

COPY package*.json ./
RUN npm config set fetch-timeout 300000 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    if [ -f package-lock.json ]; then \
      npm ci --no-fund --no-audit && npm audit fix || true; \
    else \
      npm install --no-fund --no-audit && npm audit fix || true; \
    fi

COPY . .
RUN npx vite build

FROM node:22-slim AS production

ARG BUILD_DATE=""
ARG VCS_REF=""
ARG VERSION=4.2
ARG TARGETARCH

RUN npm install -g npm@11.6.2

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl wget bash tar gzip ca-certificates libgpgme11 jq && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

ENV OC_URL_AMD64="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable/openshift-client-linux.tar.gz"
ENV OC_URL_ARM64="https://mirror.openshift.com/pub/openshift-v4/multi/clients/ocp/stable/arm64/openshift-client-linux.tar.gz"
ENV OCMIRROR_URL_AMD64="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable/oc-mirror.tar.gz"
ENV OCMIRROR_URL_ARM64="https://mirror.openshift.com/pub/openshift-v4/aarch64/clients/ocp/stable/oc-mirror.rhel9.tar.gz"

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

WORKDIR /app

COPY package*.json ./
RUN npm config set fetch-timeout 300000 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    if [ -f package-lock.json ]; then \
      npm ci --no-fund --no-audit && \
      npm audit fix || true && \
      npm cache clean --force; \
    else \
      npm install --no-fund --no-audit && \
      npm audit fix || true && \
      npm cache clean --force; \
    fi

COPY --from=builder /app/dist ./dist
COPY server ./server

# Copy only essential catalog files (~2.4MB) instead of full configs (~2.4GB)
COPY --from=builder /app/catalog-data /tmp/builder-catalog
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

RUN mkdir -p /app/data && chown -R node:node /app

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="OC Mirror Web App" \
      org.opencontainers.image.description="Web application for OpenShift Container Platform mirroring operations" \
      org.opencontainers.image.source="https://github.com/yakovbeder/oc-mirror-web-app"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npx", "tsx", "server/index.ts"]
