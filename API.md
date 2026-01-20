# OC Mirror v2 Web Application - API Documentation

**Current Version: v3.4**

## Overview

The OC Mirror v2 Web Application provides a RESTful API for managing OpenShift Container Platform mirroring operations. All endpoints are available at `http://localhost:3001/api/` when the application is running.

### Key Features
- **Archive Size Control**: Optional `archiveSize` parameter to limit archive file sizes (in GiB)
- **Persistent Mirror Storage**: Mirror archives are saved to host filesystem and survive container restarts
- **Custom Mirror Destinations**: Optional subdirectory specification for organized mirror storage
- **Health Monitoring**: Dedicated health check endpoint for container orchestration
- **OCP Versions**: Supports OpenShift Container Platform versions 4.16, 4.17, 4.18, 4.19, and 4.20

## Base URL
```
http://localhost:3001/api
```

## Authentication
Currently, the API does not require authentication. All endpoints are accessible without credentials.

## Response Format
All API responses are returned in JSON format with the following structure:
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully"
}
```

## Error Responses
Error responses follow this format:
```json
{
  "success": false,
  "error": "Error description",
  "code": "ERROR_CODE"
}
```

## Validation Features

The application includes comprehensive validation for configuration parameters:

### Version Range Validation
- **Platform Channels**: Validates that min/max versions are compatible with the selected channel
- **Operator Channels**: Validates version ranges against available operator versions
- **Auto-correction**: Automatically fixes invalid ranges (min > max scenarios)
- **Channel Compatibility**: Ensures versions match channel major.minor versions (e.g., `stable-4.19` requires `4.19.x` versions)

### Validation Triggers
- **Platform Channels**: Validation triggers on `onBlur` events (when user finishes typing)
- **Operator Channels**: Validation triggers after dropdown selection
- **Real-time Feedback**: Toast notifications provide immediate validation feedback

### Validation Examples
```json
// Valid configuration for stable-4.19 channel
{
  "channel": "stable-4.19",
  "minVersion": "4.19.1",
  "maxVersion": "4.19.9"
}

// Invalid configuration - version mismatch
{
  "channel": "stable-4.19", 
  "minVersion": "4.18.1",  // ❌ Wrong major.minor version
  "maxVersion": "4.19.9"
}

// Invalid configuration - min > max
{
  "channel": "stable-4.19",
  "minVersion": "4.19.9",  // ❌ Greater than max
  "maxVersion": "4.19.1"   // ❌ Less than min
}
```

## Endpoints

### System Information

#### GET /api/health
Health check endpoint for container orchestration and monitoring.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

#### GET /api/system/info
Get system information and health status.

**Response:**
```json
{
  "success": true,
  "data": {
    "ocMirrorVersion": "2.0.0",
    "ocVersion": "4.18.0",
    "systemArch": "x86_64",
    "availableSpace": 107374182400,
    "totalSpace": 500107862016,
    "uptime": 3600
  }
}
```

#### GET /api/system/status
Get system health status (alias for /api/system/info).

#### GET /api/system/paths
Get available system paths for mirror storage and other operations.

**Response:**
```json
{
  "success": true,
  "data": {
    "commonPaths": [
      {
        "path": "/app/data",
        "label": "Data Directory",
        "description": "Persistent - mounted volume, contains configs, operations, logs, cache, and mirrors"
      },
      {
        "path": "/app/data/mirrors",
        "label": "Mirror Storage",
        "description": "Persistent - base directory for all mirror archives"
      }
    ]
  }
}
```

### Statistics and Dashboard

#### GET /api/stats
Get application statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalOperations": 10,
    "successfulOperations": 8,
    "failedOperations": 1,
    "runningOperations": 1,
    "stoppedOperations": 0
  }
}
```

#### GET /api/operations/recent
Get recent operations for dashboard display.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Operation Name",
      "status": "running",
      "startTime": "2024-01-15T10:30:00Z",
      "endTime": null
    }
  ]
}
```

### Configuration Management

#### GET /api/config/list
Get list of saved configurations.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "config-id",
      "name": "Configuration Name",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

#### POST /api/config/save
Save a new configuration.

**Request Body:**
```json
{
  "name": "Configuration Name",
  "config": {
    "kind": "ImageSetConfiguration",
    "apiVersion": "mirror.openshift.io/v2alpha1",
    "archiveSize": 4,
    "mirror": { ... }
  }
}
```

**Configuration Parameters:**
- `archiveSize` (number, optional): Maximum size in GiB for archive files when mirroring to disk. Leave empty/omit to use default behavior.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "config-id",
    "message": "Configuration saved successfully"
  }
}
```

#### POST /api/config/upload
Upload a YAML configuration file.

**Request Body:**
```json
{
  "filename": "my-config.yaml",
  "content": "kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\nmirror:\n  operators:\n  - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.19\n    packages:\n    - name: advanced-cluster-management"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Configuration uploaded successfully",
    "filename": "my-config.yaml"
  }
}
```

**Error Response (File Already Exists):**
```json
{
  "success": false,
  "error": "File already exists",
  "code": "FILE_EXISTS",
  "data": {
    "filename": "my-config.yaml"
  }
}
```

#### DELETE /api/config/delete/:filename
Delete a configuration file.

**Parameters:**
- `filename`: Name of the configuration file to delete

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Configuration deleted successfully",
    "filename": "my-config.yaml"
  }
}
```

**Error Response (File Not Found):**
```json
{
  "success": false,
  "error": "Configuration file not found",
  "code": "FILE_NOT_FOUND"
}
```

### Platform Channels

#### GET /api/channels
Get available OpenShift Container Platform channels.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "stable-4.18",
      "description": "Stable 4.18 channel"
    }
  ]
}
```

### Operator Catalogs and Discovery

#### GET /api/catalogs
Get available operator catalogs.

**Query Parameters:**
- `version` (optional): Filter by OCP version (4.16, 4.17, 4.18, 4.19, 4.20)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "redhat-operator-index",
      "url": "registry.redhat.io/redhat/redhat-operator-index",
      "description": "Red Hat certified operators",
      "ocpVersion": "4.20",
      "type": "redhat"
    },
    {
      "name": "certified-operator-index",
      "url": "registry.redhat.io/redhat/certified-operator-index",
      "description": "Certified operators",
      "ocpVersion": "4.20",
      "type": "certified"
    },
    {
      "name": "community-operator-index",
      "url": "registry.redhat.io/redhat/community-operator-index",
      "description": "Community operators",
      "ocpVersion": "4.20",
      "type": "community"
    }
  ]
}
```

**Supported OCP Versions:**
- 4.16
- 4.17
- 4.18
- 4.19
- 4.20

#### GET /api/operators
Get available operators from catalogs.

**Query Parameters:**
- `catalog` (optional): Filter by specific catalog URL

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "advanced-cluster-management",
      "catalog": "registry.redhat.io/redhat/redhat-operator-index:v4.18",
      "description": "Advanced Cluster Management for Kubernetes"
    }
  ]
}
```

#### GET /api/operator-channels/:operator
Get available channels for a specific operator.

**Parameters:**
- `operator`: Operator name

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "release-2.8",
      "description": "Release 2.8 channel"
    }
  ]
}
```

#### GET /api/operator-dependencies
Get dependencies for selected operators.

**Query Parameters:**
- `operators` (required): JSON array of operator objects with name and catalog

**Example Request:**
```bash
curl "http://localhost:3001/api/operator-dependencies?operators=%5B%7B%22name%22%3A%22odf-operator%22%2C%22catalog%22%3A%22registry.redhat.io%2Fredhat%2Fredhat-operator-index%3Av4.18%22%7D%5D"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "dependencies": [
      {
        "packageName": "mcg-operator",
        "versionRange": ">=4.9.0 <=4.17.0",
        "requiredBy": "odf-operator",
        "catalog": "registry.redhat.io/redhat/redhat-operator-index:v4.18"
      }
    ],
    "operatorsChecked": ["odf-operator"],
    "catalogsSearched": ["redhat-operator-index:v4.18"]
  }
}
```

**Notes:**
- Dependencies are pre-computed during catalog fetch for faster runtime lookups
- Returns dependencies that are not already in the selected operators list
- Each dependency includes the operator that requires it and suggested catalog

### Operations Management

#### GET /api/operations
Get list of all operations.

**Query Parameters:**
- `status` (optional): Filter by status (running, completed, failed, stopped)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "operation-id",
      "name": "Operation Name",
      "status": "success",
      "startedAt": "2024-01-15T10:30:00Z",
      "completedAt": "2024-01-15T10:45:00Z",
      "duration": 900,
      "configFile": "my-config.yaml",
      "mirrorDestination": "/app/data/mirrors/default"
    }
  ]
}
```

**Operation Status Values:**
- `running` - Operation is currently executing
- `success` - Operation completed successfully
- `failed` - Operation failed with errors
- `stopped` - Operation was manually stopped

#### GET /api/operations/history
Get operation history (alias for /api/operations).

#### POST /api/operations/start
Start a new mirror operation.

**Request Body:**
```json
{
  "name": "Operation Name",
  "configId": "config-id",
  "mirrorDestinationSubdir": "default"
}
```

**Request Parameters:**
- `name` (string, required): Name for the operation
- `configId` (string, required): Configuration file name (e.g., "my-config.yaml")
- `mirrorDestinationSubdir` (string, optional): Subdirectory name within `/app/data/mirrors/` where mirror files will be saved. 
  - If not provided or empty, defaults to `default`
  - Must be alphanumeric with dashes and underscores only (no slashes or special characters)
  - Examples: `default`, `odf`, `production`, `test-123`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "operation-id",
    "message": "Operation started successfully",
    "mirrorDestination": "/app/data/mirrors/default"
  }
}
```

**Error Response (Invalid Subdirectory):**
```json
{
  "success": false,
  "error": "Subdirectory name contains invalid characters",
  "provided": "invalid/path",
  "help": "Use only letters, numbers, dashes (-), and underscores (_)"
}
```

**Error Response (Permission Denied):**
```json
{
  "success": false,
  "error": "Mirror destination directory exists but is not writable",
  "path": "/app/data/mirrors/custom",
  "code": "EACCES",
  "details": "Permission denied",
  "help": "The directory exists but the container cannot write to it. Check permissions on the host."
}
```

**Notes:**
- Mirror archives are saved persistently to the host filesystem at `data/mirrors/{subdirectory}/` on the host
- Files survive container restarts
- The full host path is displayed in the operation details after completion

#### GET /api/operations/:id/details
Get detailed information about a specific operation.

**Parameters:**
- `id`: Operation ID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "operation-id",
    "name": "Operation Name",
    "status": "success",
    "startedAt": "2024-01-15T10:30:00Z",
    "completedAt": "2024-01-15T10:45:00Z",
    "duration": 900,
    "configFile": "my-config.yaml",
    "mirrorDestination": "/app/data/mirrors/default",
    "config": { ... },
    "logs": "..."
  }
}
```

**Response Fields:**
- `mirrorDestination`: The full container path where mirror files are saved (e.g., `/app/data/mirrors/default`)
- Host path is `{project-root}/data/mirrors/{subdirectory}/` where `{project-root}` is typically the application directory

#### GET /api/operations/:id/logs
Get operation logs.

**Parameters:**
- `id`: Operation ID

**Response:**
```json
{
  "success": true,
  "data": {
    "logs": "Operation log content..."
  }
}
```

#### GET /api/operations/:id/logstream
Get real-time operation log stream (Server-Sent Events).

**Parameters:**
- `id`: Operation ID

**Response:** Server-Sent Events stream

**Note:** Logs are persisted to `data/logs/` directory and survive container restarts.

#### POST /api/operations/:id/stop
Stop a running operation.

**Parameters:**
- `id`: Operation ID

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Operation stopped successfully"
  }
}
```

#### DELETE /api/operations/:id
Delete an operation.

**Parameters:**
- `id`: Operation ID

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Operation deleted successfully"
  }
}
```

### Settings Management

#### GET /api/settings
Get application settings.

**Response:**
```json
{
  "success": true,
  "data": {
    "concurrentOperations": 2,
    "logRetentionDays": 30,
    "registryCredentials": {
      "username": "user",
      "password": "***"
    },
    "proxySettings": {
      "enabled": false,
      "url": "",
      "username": "",
      "password": ""
    }
  }
}
```

#### POST /api/settings
Update application settings.

**Request Body:**
```json
{
  "concurrentOperations": 2,
  "logRetentionDays": 30,
  "registryCredentials": {
    "username": "user",
    "password": "password"
  }
}
```

#### POST /api/settings/test-registry
Test registry connection.

**Request Body:**
```json
{
  "username": "user",
  "password": "password"
}
```

#### POST /api/settings/cleanup-logs
Clean up old log files.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Logs cleaned up successfully",
    "filesRemoved": 5
  }
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `CONFIG_NOT_FOUND` | Configuration not found |
| `OPERATION_NOT_FOUND` | Operation not found |
| `INVALID_CONFIG` | Invalid configuration format |
| `OPERATION_FAILED` | Operation execution failed |
| `REGISTRY_AUTH_FAILED` | Registry authentication failed |
| `CATALOG_FETCH_FAILED` | Failed to fetch operator catalog |
| `FILE_EXISTS` | Configuration file already exists |
| `FILE_NOT_FOUND` | Configuration file not found |
| `INVALID_YAML` | Invalid YAML format in uploaded file |
| `INVALID_KIND` | Invalid ImageSetConfiguration kind |
| `INVALID_API_VERSION` | Invalid API version in uploaded file |
| `EACCES` | Permission denied (file system access error) |
| `INVALID_SUBDIRECTORY` | Invalid subdirectory name (contains path separators or invalid characters) |
| `SUBDIRECTORY_NOT_WRITABLE` | Mirror destination subdirectory exists but is not writable |
| `SYSTEM_ERROR` | Internal system error |

## Rate Limiting

Currently, there are no rate limits implemented on the API endpoints.

## CORS

The API supports CORS and can be accessed from web browsers. All origins are allowed in development mode.

## Health Check

The application provides multiple health check endpoints:

- **`/api/health`**: Simple JSON health check endpoint for container orchestration (Docker HEALTHCHECK, Kubernetes liveness probes, etc.)
- **`/api/system/info`**: Detailed system information including versions, architecture, and resource usage

Both endpoints can be used by load balancers, monitoring systems, and container orchestration platforms.

## Examples

### Using curl

```bash
# Get system information
curl http://localhost:3001/api/system/info

# Health check
curl http://localhost:3001/api/health

# Get system paths
curl http://localhost:3001/api/system/paths

# Start an operation with default mirror destination
curl -X POST http://localhost:3001/api/operations/start \
  -H "Content-Type: application/json" \
  -d '{"name": "My Operation", "configId": "my-config.yaml"}'

# Start an operation with custom mirror destination subdirectory
curl -X POST http://localhost:3001/api/operations/start \
  -H "Content-Type: application/json" \
  -d '{"name": "My Operation", "configId": "my-config.yaml", "mirrorDestinationSubdir": "odf"}'

# Get operation logs
curl http://localhost:3001/api/operations/operation-123/logs
```

### Using JavaScript

```javascript
// Get available operators
const response = await fetch('/api/operators');
const data = await response.json();

// Start operation with default mirror destination
const startResponse = await fetch('/api/operations/start', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'My Operation',
    configId: 'my-config.yaml'
  })
});

// Start operation with custom mirror destination subdirectory
const startResponseCustom = await fetch('/api/operations/start', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'ODF Mirror Operation',
    configId: 'odf-config.yaml',
    mirrorDestinationSubdir: 'odf'
  })
});

// Check health
const healthResponse = await fetch('/api/health');
const healthData = await healthResponse.json();
console.log('Health status:', healthData.status);
``` 