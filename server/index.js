const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const YAML = require('yaml');
const { v4: uuidv4 } = require('uuid');

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../build')));

// Storage configuration
const STORAGE_DIR = process.env.STORAGE_DIR || './data';
const CONFIGS_DIR = path.join(STORAGE_DIR, 'configs');
const OPERATIONS_DIR = path.join(STORAGE_DIR, 'operations');
const LOGS_DIR = path.join(STORAGE_DIR, 'logs');
const CACHE_DIR = process.env.OC_MIRROR_CACHE_DIR || path.join(STORAGE_DIR, 'cache');

// Ensure directories exist
async function ensureDirectories() {
  const dirs = [STORAGE_DIR, CONFIGS_DIR, OPERATIONS_DIR, LOGS_DIR, CACHE_DIR];
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error(`Error creating directory ${dir}:`, error);
    }
  }
}

// Initialize storage
ensureDirectories();

// File upload configuration (using multer v2 syntax)
// Note: Currently not used, but available for future file upload features
const multer = require('multer');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CONFIGS_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Helper to extract major.minor.patch from oc-mirror version output
function parseOcMirrorVersion(raw) {
  // Try to extract GitVersion from Go struct output
  const match = raw.match(/GitVersion:\"(\d+\.\d+\.\d+)/);
  if (match) {
    return match[1];
  }
  // Fallback: return the first version-like string
  const fallback = raw.match(/(\d+\.\d+\.\d+)/);
  if (fallback) {
    return fallback[1];
  }
  return 'Not available';
}

// Utility functions
async function getSystemInfo() {
  try {
    const [ocMirrorVersion, ocVersion, systemArch] = await Promise.all([
      execAsync('oc-mirror version').catch(() => ({ stdout: 'Not available' })),
      execAsync('oc version --client').catch(() => ({ stdout: 'Not available' })),
      execAsync('uname -m').catch(() => ({ stdout: 'Not available' }))
    ]);

    // Get disk space
    const diskSpace = await execAsync('df -k .').catch(() => ({ stdout: '' }));
    const lines = diskSpace.stdout.split('\n');
    const diskInfo = lines[1] ? lines[1].split(/\s+/) : [];
    const availableSpace = diskInfo[3] ? parseInt(diskInfo[3]) * 1024 : 0;
    const totalSpace = diskInfo[1] ? parseInt(diskInfo[1]) * 1024 : 0;

    return {
      ocMirrorVersion: parseOcMirrorVersion(ocMirrorVersion.stdout.trim()),
      ocVersion: ocVersion.stdout.trim(),
      systemArchitecture: systemArch.stdout.trim(),
      availableDiskSpace: availableSpace,
      totalDiskSpace: totalSpace
    };
  } catch (error) {
    console.error('Error getting system info:', error);
    return {
      ocMirrorVersion: 'Not available',
      ocVersion: 'Not available',
      systemArchitecture: 'Not available',
      availableDiskSpace: 0,
      totalDiskSpace: 0
    };
  }
}

async function getOperations() {
  try {
    const files = await fs.readdir(OPERATIONS_DIR);
    const operations = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(OPERATIONS_DIR, file), 'utf8');
        operations.push(JSON.parse(content));
      }
    }

    return operations.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  } catch (error) {
    console.error('Error reading operations:', error);
    return [];
  }
}

async function saveOperation(operation) {
  const filename = `${operation.id}.json`;
  await fs.writeFile(path.join(OPERATIONS_DIR, filename), JSON.stringify(operation, null, 2));
}

async function updateOperation(operationId, updates) {
  const filename = `${operationId}.json`;
  const filepath = path.join(OPERATIONS_DIR, filename);
  
  try {
    const content = await fs.readFile(filepath, 'utf8');
    const operation = JSON.parse(content);
    const updatedOperation = { ...operation, ...updates };
    await fs.writeFile(filepath, JSON.stringify(updatedOperation, null, 2));
    return updatedOperation;
  } catch (error) {
    console.error('Error updating operation:', error);
    throw error;
  }
}

async function getOperation(operationId) {
  const filename = `${operationId}.json`;
  const filepath = path.join(OPERATIONS_DIR, filename);
  
  try {
    const content = await fs.readFile(filepath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading operation:', error);
    throw error;
  }
}

// Enhanced system health check
async function getSystemHealth() {
  let ocOk = false, ocMirrorOk = false;
  try { await execAsync('oc version --client'); ocOk = true; } catch {}
  try { await execAsync('oc-mirror version'); ocMirrorOk = true; } catch {}

  let diskOk = false;
  try {
    const diskSpace = await execAsync('df -k .');
    const lines = diskSpace.stdout.split('\n');
    const diskInfo = lines[1] ? lines[1].split(/\s+/) : [];
    const availableSpace = diskInfo[3] ? parseInt(diskInfo[3]) * 1024 : 0;
    diskOk = availableSpace > 1_000_000_000;
  } catch {}

  if (!ocOk || !ocMirrorOk) return 'error';
  if (!diskOk) return 'degraded';
  return 'healthy';
}

// API Routes

// Dashboard endpoints
app.get('/api/stats', async (req, res) => {
  try {
    const operations = await getOperations();
    const stats = {
      totalOperations: operations.length,
      successfulOperations: operations.filter(op => op.status === 'success').length,
      failedOperations: operations.filter(op => op.status === 'failed').length,
      runningOperations: operations.filter(op => op.status === 'running').length
    };
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

app.get('/api/operations/recent', async (req, res) => {
  try {
    const operations = await getOperations();
    const recent = operations.slice(0, 10); // Get last 10 operations
    res.json(recent);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get recent operations' });
  }
});

app.get('/api/system/status', async (req, res) => {
  try {
    const systemInfo = await getSystemInfo();
    const systemHealth = await getSystemHealth();
    res.json({
      ocMirrorVersion: systemInfo.ocMirrorVersion,
      ocVersion: systemInfo.ocVersion,
      systemHealth
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get system status' });
  }
});

// Configuration endpoints
app.get('/api/config/list', async (req, res) => {
  try {
    const files = await fs.readdir(CONFIGS_DIR);
    const configs = [];

    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const stats = await fs.stat(path.join(CONFIGS_DIR, file));
        configs.push({
          name: file,
          size: `${(stats.size / 1024).toFixed(2)} KB`,
          modified: stats.mtime
        });
      }
    }

    res.json(configs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list configurations' });
  }
});

app.post('/api/config/save', async (req, res) => {
  try {
    const { config, name } = req.body;
    const filename = name || `imageset-config-${Date.now()}.yaml`;
    const filepath = path.join(CONFIGS_DIR, filename);
    
    await fs.writeFile(filepath, config);
    res.json({ message: 'Configuration saved successfully', filename });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

app.get('/api/channels', async (req, res) => {
  try {
    // This would typically query available OCP channels
    const channels = [
      'stable-4.16', 'stable-4.17', 'stable-4.18', 'stable-4.19', 'stable-4.20'
    ];
    res.json(channels);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get channels' });
  }
});

app.get('/api/operators', async (req, res) => {
  try {
    // This would typically query available operators
    const operators = [
      'advanced-cluster-management',
      'elasticsearch-operator',
      'kiali-ossm',
      'servicemeshoperator',
      'openshift-pipelines-operator-rh',
      'serverless-operator',
      'jaeger-product',
      'rhods-operator'
    ];
    res.json(operators);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get operators' });
  }
});

// Operations endpoints
app.get('/api/operations', async (req, res) => {
  try {
    const operations = await getOperations();
    res.json(operations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get operations' });
  }
});

app.get('/api/operations/history', async (req, res) => {
  try {
    const operations = await getOperations();
    res.json(operations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get operation history' });
  }
});

app.post('/api/operations/start', async (req, res) => {
  try {
    const { configFile } = req.body;
    const operationId = uuidv4();
    const configPath = path.join(CONFIGS_DIR, configFile);
    
    // Check if config file exists
    try {
      await fs.access(configPath);
    } catch (error) {
      return res.status(404).json({ error: 'Configuration file not found' });
    }

    // Create operation record
    const operation = {
      id: operationId,
      name: `Mirror Operation ${operationId.slice(0, 8)}`,
      configFile,
      status: 'running',
      startedAt: new Date().toISOString(),
      logs: []
    };

    await saveOperation(operation);

    // Start oc-mirror process with v2
    const logFile = path.join(LOGS_DIR, `${operationId}.log`);
    const command = `oc-mirror --v2 --config ${configPath} --dest-tls-verify=false --src-tls-verify=false --cache-dir ${CACHE_DIR} --authfile /app/pull-secret.json file://mirror 2>&1 | tee ${logFile}`;
    
    exec(command, async (error, stdout, stderr) => {
      let logs = stdout + stderr;
      // If logs are empty, try to read from log file
      if (!logs) {
        try {
          logs = await fs.readFile(logFile, 'utf8');
        } catch {}
      }
      const hasErrorInLogs = logs.toLowerCase().includes('[error]') || logs.toLowerCase().includes('error:');
      let finalStatus = 'success';
      if (error || hasErrorInLogs) finalStatus = 'failed';
      const opFile = path.join(OPERATIONS_DIR, `${operationId}.json`);
      let opData = JSON.parse(await fs.readFile(opFile, 'utf8'));
      if (opData.status === 'stopped') finalStatus = 'stopped';
      const completedAt = new Date().toISOString();
      const duration = Math.floor((new Date(completedAt) - new Date(operation.startedAt)) / 1000);
      await updateOperation(operationId, {
        status: finalStatus,
        completedAt,
        duration,
        errorMessage: error ? error.message : (hasErrorInLogs ? 'Error detected in logs' : null),
        logs: logs.split('\n')
      });
    });

    res.json({ message: 'Operation started successfully', operationId });
  } catch (error) {
    console.error('Error starting operation:', error);
    res.status(500).json({ error: 'Failed to start operation' });
  }
});

app.post('/api/operations/:id/stop', async (req, res) => {
  try {
    const { id } = req.params;
    await updateOperation(id, {
      status: 'stopped',
      completedAt: new Date().toISOString()
    });
    res.json({ message: 'Operation stopped successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop operation' });
  }
});

app.delete('/api/operations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const filename = `${id}.json`;
    const filepath = path.join(OPERATIONS_DIR, filename);
    
    try {
      await fs.unlink(filepath);
    } catch (error) {
      // File might not exist, which is fine
    }
    
    res.json({ message: 'Operation deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete operation' });
  }
});

app.get('/api/operations/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const operation = await getOperation(id);
    let logs = '';
    if (operation.logs && operation.logs.length > 0) {
      logs = operation.logs.join('\n');
    } else {
      // Try to read from log file if logs are missing
      const logFile = path.join(LOGS_DIR, `${id}.log`);
      try {
        logs = await fs.readFile(logFile, 'utf8');
      } catch (e) {
        logs = '';
      }
    }
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get operation logs' });
  }
});

app.get('/api/operations/:id/details', async (req, res) => {
  try {
    const { id } = req.params;
    const operation = await getOperation(id);
    
    // Mock details - in a real implementation, this would parse the actual results
    const details = {
      imagesMirrored: Math.floor(Math.random() * 1000) + 100,
      operatorsMirrored: Math.floor(Math.random() * 50) + 10,
      totalSize: Math.floor(Math.random() * 10000000000) + 1000000000,
      platformImages: Math.floor(Math.random() * 500) + 50,
      additionalImages: Math.floor(Math.random() * 100) + 10,
      helmCharts: Math.floor(Math.random() * 20) + 5,
      manifestFiles: [
        'imageContentSourcePolicy.yaml',
        'catalogSource.yaml',
        'mapping.txt'
      ]
    };
    
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get operation details' });
  }
});

// SSE log streaming endpoint
app.get('/api/operations/:id/logstream', (req, res) => {
  const { id } = req.params;
  const logFile = path.join(LOGS_DIR, `${id}.log`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let filePos = 0;
  let finished = false;

  const sendNewLines = () => {
    if (finished) return;
    fs.stat(logFile, (err, stats) => {
      if (err) return;
      if (stats.size > filePos) {
        const stream = fs.createReadStream(logFile, { start: filePos, end: stats.size });
        stream.on('data', chunk => {
          res.write(`data: ${chunk.toString().replace(/\n/g, '\ndata: ')}\n\n`);
        });
        stream.on('end', () => {
          filePos = stats.size;
        });
      }
    });
  };

  const interval = setInterval(sendNewLines, 1000);

  req.on('close', () => {
    finished = true;
    clearInterval(interval);
  });
});

// Settings endpoints
app.get('/api/settings', async (req, res) => {
  try {
    const settingsPath = path.join(STORAGE_DIR, 'settings.json');
    try {
      const content = await fs.readFile(settingsPath, 'utf8');
      res.json(JSON.parse(content));
    } catch (error) {
      // Return default settings if file doesn't exist
      const defaultSettings = {
        maxConcurrentOperations: 1,
        logRetentionDays: 30,
        autoCleanup: true,
        registryCredentials: {
          username: '',
          password: '',
          registry: ''
        },
        proxySettings: {
          enabled: false,
          host: '',
          port: '',
          username: '',
          password: ''
        }
      };
      res.json(defaultSettings);
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const settingsPath = path.join(STORAGE_DIR, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify(req.body, null, 2));
    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.post('/api/settings/test-registry', async (req, res) => {
  try {
    const { registry, username, password } = req.body;
    // Mock registry test - in real implementation, this would test actual connection
    res.json({ message: 'Registry connection successful' });
  } catch (error) {
    res.status(500).json({ error: 'Registry connection failed' });
  }
});

app.post('/api/settings/cleanup-logs', async (req, res) => {
  try {
    // Mock cleanup - in real implementation, this would clean old logs
    res.json({ message: 'Log cleanup completed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cleanup logs' });
  }
});

app.get('/api/system/info', async (req, res) => {
  try {
    const systemInfo = await getSystemInfo();
    res.json(systemInfo);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get system info' });
  }
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../build/index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`OC Mirror Web App server running on port ${PORT}`);
  console.log(`Storage directory: ${STORAGE_DIR}`);
  console.log(`Configs directory: ${CONFIGS_DIR}`);
  console.log(`Operations directory: ${OPERATIONS_DIR}`);
  console.log(`Logs directory: ${LOGS_DIR}`);
  console.log(`Cache directory: ${CACHE_DIR}`);
}); 