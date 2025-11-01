# Dockerfile Optimization Recommendations

## Current State Analysis

### ✅ Good Practices Already in Place
- Multi-stage build (reduces final image size)
- Non-root user execution
- Multi-architecture support (AMD64/ARM64)
- Proper layer ordering for caching
- Production-only dependencies in final stage

### ⚠️ Issues and Optimization Opportunities

## 1. **Catalog Data Size (Critical - 2.4GB)**

**Current Issue:**
```dockerfile
COPY catalog-data ./catalog-data
```
- Catalog data is 2.4GB (mostly `configs/` directories)
- Makes image unnecessarily large
- Slow build, push, and pull times
- Operators only need `operators.json` files at runtime

**Recommendation: Copy only essential files**
```dockerfile
# Copy only operators.json files (much smaller, ~few MB total)
# Exclude large configs/ directories - not needed at runtime
COPY --from=builder /app/catalog-data/*/v*/operators.json ./catalog-data/*/v*/ || true
COPY --from=builder /app/catalog-data/catalog-index.json ./catalog-data/ || true
# OR make it optional with build arg:
ARG INCLUDE_CATALOG_DATA=false
RUN if [ "$INCLUDE_CATALOG_DATA" = "true" ]; then \
    mkdir -p ./catalog-data && \
    echo "Note: catalog-data should be provided via volume mount at runtime"; \
  fi
```

**Benefit:** Reduces image size by ~2.4GB, faster builds

---

## 2. **Remove Empty Lines / Consolidate RUN Commands**

**Current Issue:**
```dockerfile
RUN npm install --only=production --verbose && npm audit fix || true && npm cache clean --force



```
Empty lines create unnecessary layers.

**Recommendation:**
```dockerfile
# Install only production dependencies, clean up in same layer
RUN npm install --only=production && \
    npm audit fix || true && \
    npm cache clean --force
```
Remove all empty lines between commands.

**Benefit:** Cleaner Dockerfile, better layer management

---

## 3. **Add HEALTHCHECK**

**Current Issue:** No health check defined in Dockerfile

**Recommendation:**
```dockerfile
# Health check endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1
```

**Benefit:** Container orchestration can detect unhealthy containers

---

## 4. **Optimize apt-get Installation**

**Current:** Good (removes apt lists), but can be improved

**Recommendation:**
```dockerfile
# Install system dependencies in single layer with cleanup
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
```

**Benefits:**
- `--no-install-recommends` reduces size
- Combined cleanup reduces layers

---

## 5. **Add .dockerignore Entry for Optional catalog-data**

**Current:** `.dockerignore` doesn't exclude catalog-data

**Recommendation:** Add to `.dockerignore`:
```
# Optional: exclude catalog-data from build (provide at runtime via volume)
# Uncomment if you want to make catalog-data optional:
# catalog-data/
```

Or make it conditional in Dockerfile using build args.

---

## 6. **Pin Node.js Version More Specifically**

**Current:** `FROM node:20` (uses latest node:20 tag)

**Recommendation:**
```dockerfile
FROM node:20-slim AS builder  # Use slim variant
# Or pin to specific version:
FROM node:20.18.0-slim AS builder
```

**Benefits:**
- Slim variant reduces image size (~100MB smaller)
- Pinned version ensures reproducible builds

---

## 7. **Optimize Builder Stage**

**Current:** Good, but can improve caching

**Recommendation:**
```dockerfile
# Copy only package files first (better caching)
COPY package*.json ./

# Install dependencies (this layer cached unless package.json changes)
RUN npm ci --only=production && \
    npm cache clean --force

# Then copy source code
COPY src ./src
COPY public ./public
COPY server ./server

# Build (cached unless source changes)
RUN npm run build
```

**Note:** `npm ci` is faster and more reliable than `npm install` in CI/CD

---

## 8. **Add Build Arguments for Flexibility**

**Recommendation:**
```dockerfile
# Build arguments for flexibility
ARG NODE_ENV=production
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION=3.2

# Add labels for metadata
LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="OC Mirror Web App" \
      org.opencontainers.image.description="Web application for OpenShift Container Platform mirroring operations"
```

---

## 9. **Combine User Creation and Directory Setup**

**Current:** Separate RUN commands

**Recommendation:**
```dockerfile
# Create non-root user and directories in one layer
RUN groupadd -r nodejs -g 1001 && \
    useradd -r -g nodejs -u 1001 nodejs && \
    mkdir -p /app/data /app/downloads && \
    chown -R nodejs:nodejs /app
```

**Benefit:** Reduces number of layers

---

## 10. **Add Error Handling for Critical Steps**

**Recommendation:**
```dockerfile
# Add set -e for error handling
# Verify critical binaries are installed
RUN which oc && oc version --client && \
    which oc-mirror && oc-mirror version && \
    which node && node --version && \
    which npm && npm --version
```

---

## Priority Recommendations Summary

### 🔴 **High Priority (Do First)**
1. **Optimize catalog-data copying** (2.4GB reduction)
2. **Add HEALTHCHECK** (container orchestration)
3. **Remove empty lines** (code quality)

### 🟡 **Medium Priority**
4. **Use node:20-slim** (reduce base image size)
5. **Combine user/directory setup** (fewer layers)
6. **Add build metadata labels** (better image management)

### 🟢 **Low Priority (Nice to Have)**
7. **Optimize apt-get** (small size reduction)
8. **Add error verification** (better debugging)
9. **Use npm ci** (faster installs)

---

## Estimated Impact

| Optimization | Size Reduction | Build Time Impact |
|-------------|---------------|-------------------|
| Remove catalog-data | ~2.4GB | Faster builds |
| Use node:20-slim | ~100MB | Faster builds |
| Optimize apt-get | ~20MB | Minimal |
| Combine layers | ~10MB | Faster builds |
| **Total Potential** | **~2.5GB** | **Significantly faster** |

---

## Implementation Notes

1. **catalog-data strategy**: The application already has logic to work without catalog-data (loads from pre-fetched data or returns empty). Consider making it optional.

2. **Volume mounts**: catalog-data can be provided at runtime via volume mount in `container-run.sh`

3. **Backward compatibility**: Keep catalog-data copy as fallback with build arg to enable/disable

