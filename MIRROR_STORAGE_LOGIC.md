# Mirror Operation Storage Logic

## Current Implementation

When a mirror operation is started, the `oc-mirror` command is executed with the following parameters:

```javascript
spawn('oc-mirror', [
  '--v2',
  '--config', configPath,
  '--dest-tls-verify=false',
  '--src-tls-verify=false',
  '--cache-dir', CACHE_DIR,
  '--authfile', '/app/pull-secret.json',
  'file://mirror'
], {
  stdio: ['ignore', 'pipe', 'pipe']
});
```

### Storage Locations

1. **Mirror Destination: `/app/mirror`** (Inside Pod)
   - **Path:** `/app/mirror`
   - **Type:** File-based storage (file:// URL)
   - **Relative to:** Current working directory (`/app`)
   - **Persistence:** ❌ **NOT PERSISTENT** - Lost on container restart
   - **Contents:** Actual mirrored image files (tar archives, manifests, etc.)
   - **Mount:** NO volume mount - exists only inside container

2. **Cache Directory: `/app/data/cache`** (Mounted Volume)
   - **Path:** `/app/data/cache` (inside container)
   - **Host Path:** `./data/cache` (relative to workspace)
   - **Type:** oc-mirror metadata cache
   - **Persistence:** ✅ **PERSISTENT** - Survives container restarts
   - **Contents:** 
     - `.oc-mirror/.cache/` - Metadata about downloaded images
     - Catalog metadata
     - Download state information
   - **Mount:** YES - Volume mounted from host

### Configuration

```javascript
// From server/index.js
const STORAGE_DIR = process.env.STORAGE_DIR || './data';
const CACHE_DIR = process.env.OC_MIRROR_CACHE_DIR || path.join(STORAGE_DIR, 'cache');
// Default: './data/cache' (relative to /app)
```

### Problem Identified

**Issue:** The mirrored data (`/app/mirror`) is stored inside the container filesystem, which is **not persistent**. When the container restarts:
- ✅ Cache persists (helps avoid re-downloading metadata)
- ❌ Mirror files are lost (requires re-mirroring all images)
- ❌ Operation history shows "success" but download fails (files don't exist)

**Current Solution:** Operation history is cleared on startup to prevent showing stale operations.

### Volume Mounts

From `container-run.sh`:
- `-v "$(pwd)/data:/app/data:z"` - Maps `./data` on host to `/app/data` in container
  - This includes `data/cache/` (persistent)
  - This includes `data/operations/` (persistent)
  - This includes `data/logs/` (persistent)
  - This includes `data/configs/` (persistent)
- `-v "$(pwd)/downloads:/app/downloads:z"` - Maps downloads directory
- **NO mount for `/app/mirror`** - This is the issue

### What Happens During Mirror Operation

1. **oc-mirror starts** with `file://mirror` destination
2. **Cache is written to** `/app/data/cache/.oc-mirror/.cache/` (persistent volume)
3. **Mirror files are written to** `/app/mirror` (container filesystem, non-persistent)
4. **Operation completes** - files exist in `/app/mirror`
5. **Container restarts** - `/app/mirror` is empty, cache still exists
6. **Next operation** - Cache helps, but must re-download all images

### Recommendations

1. **Option A: Mount Mirror Directory** (Recommended)
   - Add volume mount: `-v "$(pwd)/mirror:/app/mirror:z"`
   - Mirror files would persist across restarts
   - Larger disk usage on host
   - Operation history could persist

2. **Option B: Keep Current Approach** (Current)
   - Clear operation history on startup (already implemented)
   - Accept that mirror files are ephemeral
   - Cache still helps avoid redundant work

3. **Option C: Download After Mirror** (Hybrid)
   - Mirror to `/app/mirror` (ephemeral)
   - Automatically tar and move to persistent location
   - Similar to current download functionality

