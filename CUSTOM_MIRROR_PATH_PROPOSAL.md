# Custom Mirror Destination Path - Implementation Proposal

## Overview

Allow users to specify a custom destination path for each mirror operation, enabling:
- **Persistent storage** of mirror archives
- **Per-operation isolation** (different paths for different operations)
- **Flexible storage management** (choose where large files go)
- **Path validation** before starting operation

## Current Behavior

```javascript
// Hardcoded destination
spawn('oc-mirror', [
  '--v2',
  '--config', configPath,
  '--cache-dir', CACHE_DIR,
  'file://mirror'  // ❌ Always goes to /app/mirror (ephemeral)
]);
```

## Proposed Implementation

### 1. Frontend Changes (`src/components/MirrorOperations.js`)

#### Add State for Mirror Destination
```javascript
const [mirrorDestination, setMirrorDestination] = useState('');
const [showPathBrowser, setShowPathBrowser] = useState(false);
```

#### Add UI Component (Before "Start Operation" button)
```jsx
<div className="form-group" style={{ marginTop: '1rem' }}>
  <label>
    📁 Mirror Destination Path 
    <span style={{ color: '#6c757d', fontSize: '0.9rem', marginLeft: '0.5rem' }}>
      (Optional - defaults to /app/mirror)
    </span>
  </label>
  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
    <input
      type="text"
      className="form-control"
      placeholder="/app/mirror or /custom/path/to/mirror"
      value={mirrorDestination}
      onChange={(e) => setMirrorDestination(e.target.value)}
      style={{ flex: 1 }}
    />
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => setShowPathBrowser(true)}
      title="Browse available paths"
    >
      📂 Browse
    </button>
    <button
      type="button"
      className="btn btn-sm btn-outline-secondary"
      onClick={() => setMirrorDestination('')}
      title="Clear path (use default)"
    >
      ✕ Clear
    </button>
  </div>
  <small className="text-muted">
    Specify where to store mirrored files. Must be an absolute path accessible from container.
    <br />
    <strong>Recommended:</strong> Use mounted volume paths (e.g., /app/data/mirrors/operation-1)
  </small>
</div>
```

#### Update `startOperation` Function
```javascript
const startOperation = async () => {
  if (!selectedConfig) {
    toast.error('Please select a configuration file');
    return;
  }

  try {
    setLoading(true);
    const response = await axios.post('/api/operations/start', {
      configFile: selectedConfig,
      mirrorDestination: mirrorDestination.trim() || undefined  // Send only if provided
    });
    
    toast.success('Operation started successfully!');
    // Clear mirror destination after starting
    setMirrorDestination('');
    // ... rest of function
  } catch (error) {
    // ... error handling
  }
};
```

### 2. Backend Changes (`server/index.js`)

#### Update `/api/operations/start` Endpoint
```javascript
app.post('/api/operations/start', async (req, res) => {
  try {
    const { configFile, mirrorDestination } = req.body;
    const operationId = uuidv4();
    const configPath = path.join(CONFIGS_DIR, configFile);
    
    // Validate config file exists
    try {
      await fs.access(configPath);
    } catch (error) {
      return res.status(404).json({ error: 'Configuration file not found' });
    }

    // Determine mirror destination path
    let mirrorPath = '/app/mirror';  // Default
    if (mirrorDestination && mirrorDestination.trim()) {
      mirrorPath = mirrorDestination.trim();
      
      // Validate path format
      if (!path.isAbsolute(mirrorPath)) {
        return res.status(400).json({ 
          error: 'Mirror destination must be an absolute path',
          provided: mirrorPath
        });
      }
      
      // Validate path exists or can be created
      try {
        await fs.mkdir(mirrorPath, { recursive: true });
        // Check if writable
        await fs.access(mirrorPath, fs.constants.W_OK);
      } catch (error) {
        return res.status(400).json({ 
          error: 'Cannot access or create mirror destination directory',
          path: mirrorPath,
          details: error.message
        });
      }
    }

    // Create operation record (store mirror path)
    const operation = {
      id: operationId,
      name: `Mirror Operation ${operationId.slice(0, 8)}`,
      configFile,
      mirrorDestination: mirrorPath,  // Store for download later
      status: 'running',
      startedAt: new Date().toISOString(),
      logs: []
    };

    await saveOperation(operation);

    // Start oc-mirror process
    const logFile = path.join(LOGS_DIR, `${operationId}.log`);
    const logStream = require('fs').createWriteStream(logFile);
    
    // Convert absolute path to file:// URL format
    // /app/mirror -> file://mirror (relative to /app)
    // /custom/path -> file:///custom/path (absolute)
    let mirrorUrl;
    if (mirrorPath.startsWith('/app/')) {
      // Relative to /app
      mirrorUrl = `file://${mirrorPath.substring(5)}`;
    } else {
      // Absolute path (needs three slashes)
      mirrorUrl = `file://${mirrorPath}`;
    }
    
    // Spawn the oc-mirror process
    const child = spawn('oc-mirror', [
      '--v2',
      '--config', configPath,
      '--dest-tls-verify=false',
      '--src-tls-verify=false',
      '--cache-dir', CACHE_DIR,
      '--authfile', '/app/pull-secret.json',
      mirrorUrl  // ✅ Use custom path
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: '/app'  // Set working directory for relative paths
    });
    
    // ... rest of process handling
  } catch (error) {
    console.error('Error starting operation:', error);
    res.status(500).json({ error: 'Failed to start operation' });
  }
});
```

#### Update Download Endpoint to Use Stored Path
```javascript
app.get('/api/operations/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const operation = await getOperation(id);
    
    if (!operation) {
      return res.status(404).json({ error: 'Operation not found' });
    }
    
    if (operation.status !== 'success') {
      return res.status(400).json({ error: 'Operation must be successful to download files' });
    }
    
    // Use stored mirror destination or default
    const mirrorDir = operation.mirrorDestination || '/app/mirror';
    
    // Check if mirror directory exists
    try {
      await fs.access(mirrorDir);
    } catch (error) {
      return res.status(404).json({ 
        error: 'Mirror files not found',
        path: mirrorDir,
        message: 'Files may have been moved or deleted'
      });
    }
    
    // ... rest of download logic
  } catch (error) {
    // ... error handling
  }
});
```

### 3. Path Browser Component (Optional Enhancement)

Create a simple path browser API endpoint:

```javascript
// GET /api/system/paths - List common mount points
app.get('/api/system/paths', async (req, res) => {
  try {
    const commonPaths = [
      { path: '/app/mirror', label: 'Default (Container)', description: 'Ephemeral - lost on restart' },
      { path: '/app/data/mirrors', label: 'Data Mirrors', description: 'Persistent - mounted volume' },
      { path: '/app/downloads', label: 'Downloads', description: 'Persistent - mounted volume' }
    ];
    
    // Check which paths exist and are writable
    const availablePaths = [];
    for (const pathInfo of commonPaths) {
      try {
        await fs.access(pathInfo.path, fs.constants.W_OK);
        pathInfo.available = true;
      } catch {
        pathInfo.available = false;
      }
      availablePaths.push(pathInfo);
    }
    
    res.json({ paths: availablePaths });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list paths' });
  }
});
```

### 4. Container Setup Updates (`container-run.sh`)

Add recommended mirror directory creation:

```bash
# Create recommended mirror directory in mounted volume
if [ ! -d "data/mirrors" ]; then
    print_status "Creating recommended mirror storage directory..."
    mkdir -p data/mirrors
    chmod 777 data/mirrors
    print_success "Created data/mirrors (use /app/data/mirrors in operations)"
fi
```

---

## Implementation Steps

### Phase 1: Basic Implementation
1. ✅ Add `mirrorDestination` field to frontend form
2. ✅ Update `/api/operations/start` to accept `mirrorDestination`
3. ✅ Validate and use custom path in oc-mirror command
4. ✅ Store path in operation record
5. ✅ Update download endpoint to use stored path

### Phase 2: Enhanced Features
1. Add path validation with better error messages
2. Add path browser/suggestions UI
3. Add path history (remember last used paths)
4. Add disk space check before operation

### Phase 3: Advanced Features
1. Per-operation subdirectories (auto-create based on operation ID)
2. Path templates (e.g., `/app/data/mirrors/{operationId}`)
3. Cleanup old mirror directories
4. Storage usage reporting

---

## Example Usage Scenarios

### Scenario 1: Default Behavior
```javascript
// User doesn't specify path
POST /api/operations/start
{ "configFile": "my-config.yaml" }
// Uses: /app/mirror (default, ephemeral)
```

### Scenario 2: Persistent Storage
```javascript
// User specifies mounted volume path
POST /api/operations/start
{ 
  "configFile": "my-config.yaml",
  "mirrorDestination": "/app/data/mirrors/ocp-4.20"
}
// Uses: /app/data/mirrors/ocp-4.20 (persistent, survives restart)
```

### Scenario 3: Multiple Operations
```javascript
// Operation 1
{ "mirrorDestination": "/app/data/mirrors/operation-1" }

// Operation 2
{ "mirrorDestination": "/app/data/mirrors/operation-2" }
// Each operation isolated, both persistent
```

---

## Pros and Cons

### ✅ Pros

1. **Flexibility**
   - Users choose where to store large files
   - Can use different storage backends (local, NFS, etc.)
   - Supports multiple concurrent operations

2. **Persistent Storage**
   - Mirror files survive container restarts
   - Operation history remains valid
   - Downloads work for previous operations

3. **Storage Management**
   - Organize mirrors by operation, version, or purpose
   - Easier cleanup (delete specific directories)
   - Better disk space utilization

4. **Scalability**
   - Support multiple mirror repositories
   - Isolate large operations
   - Distribute across storage systems

5. **Backwards Compatible**
   - Default behavior unchanged (no path = `/app/mirror`)
   - Optional feature (can be ignored)
   - Existing operations continue to work

### ❌ Cons

1. **Complexity**
   - More UI elements to maintain
   - Path validation logic
   - Error handling for invalid paths

2. **User Responsibility**
   - Users must manage paths correctly
   - Risk of using invalid/non-writable paths
   - Need to remember paths for downloads

3. **Path Validation Challenges**
   - Need to validate paths exist and are writable
   - Container vs host path confusion
   - Relative vs absolute path handling

4. **Potential Issues**
   - Users might specify paths outside mounted volumes
   - Path might exist in container but not be mounted
   - Security concerns with arbitrary paths

5. **Maintenance**
   - Need to track paths per operation
   - Cleanup of old mirror directories
   - Documentation for users

---

## Security Considerations

### Input Validation
```javascript
// Whitelist approach - only allow certain base paths
const ALLOWED_BASE_PATHS = [
  '/app/data',
  '/app/downloads',
  '/app/mirror'
];

function isValidPath(userPath) {
  const normalized = path.normalize(userPath);
  return ALLOWED_BASE_PATHS.some(base => normalized.startsWith(base));
}
```

### Path Sanitization
```javascript
// Prevent directory traversal
const sanitizedPath = path.normalize(mirrorDestination)
  .replace(/\.\./g, '')  // Remove ..
  .replace(/^\/+/, '/');  // Normalize leading slashes
```

---

## Recommended Approach

### Option A: Whitelist Only (Most Secure)
- Only allow paths starting with `/app/data`, `/app/downloads`
- Block arbitrary absolute paths
- Simpler validation, safer

### Option B: Flexible with Validation (Recommended)
- Allow any absolute path
- Validate path exists and is writable before operation
- Store path per operation for downloads
- Show warnings for unmounted paths

### Option C: Template-Based (User Friendly)
- Provide path templates:
  - `/app/data/mirrors/{operationId}`
  - `/app/data/mirrors/{date}`
  - `/app/data/mirrors/{config-name}`
- Auto-generate paths, users just choose template

---

## Migration Strategy

1. **Backwards Compatibility**: Default to `/app/mirror` if no path provided
2. **Gradual Rollout**: Feature can be opt-in initially
3. **Operation History**: Old operations without `mirrorDestination` use default path
4. **Documentation**: Update README with examples

---

## Testing Checklist

- [ ] Default path works (no mirrorDestination provided)
- [ ] Custom absolute path works
- [ ] Path validation rejects invalid paths
- [ ] Path validation checks writability
- [ ] Download works with custom paths
- [ ] Multiple operations with different paths
- [ ] Error handling for non-existent paths
- [ ] Error handling for non-writable paths
- [ ] Operation history stores path correctly

---

## Estimated Implementation Time

- **Phase 1 (Basic)**: 2-3 hours
- **Phase 2 (Enhanced)**: 3-4 hours  
- **Phase 3 (Advanced)**: 4-6 hours

**Total**: 9-13 hours for full implementation

