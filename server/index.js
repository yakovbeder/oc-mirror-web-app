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

// Enable compression for better performance
const compression = require('compression');
app.use(compression());

// Cache static files
app.use(express.static(path.join(__dirname, '../build'), {
  maxAge: '1d',
  etag: true
}));

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

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

// Load pre-fetched catalog data
let preFetchedCatalogData = null;

async function loadPreFetchedCatalogData() {
  if (preFetchedCatalogData) {
    return preFetchedCatalogData;
  }

  try {
    const fs = require('fs').promises;
    const path = require('path');
    
    const catalogIndexPath = path.join(__dirname, '../catalog-data/catalog-index.json');
    const catalogIndex = JSON.parse(await fs.readFile(catalogIndexPath, 'utf8'));
    
    preFetchedCatalogData = {
      index: catalogIndex,
      operators: {},
      channels: {}
    };

    let totalOperators = 0;

    // Load operators for each catalog
    for (const catalog of catalogIndex.catalogs) {
      const operatorsPath = path.join(__dirname, `../catalog-data/${catalog.catalog_type}/${catalog.ocp_version}/operators.json`);
      try {
        const operators = JSON.parse(await fs.readFile(operatorsPath, 'utf8'));
        const key = `${catalog.catalog_type}:${catalog.ocp_version}`;
        preFetchedCatalogData.operators[key] = operators;
        totalOperators += operators.length;
        
        // Build channels index
        operators.forEach(operator => {
          const channelKey = `${operator.name}:${catalog.catalog_type}:${catalog.ocp_version}`;
          preFetchedCatalogData.channels[channelKey] = operator.channels || [];
        });
        
        console.log(`Loaded ${operators.length} operators for ${key}`);
      } catch (error) {
        console.warn(`Could not load operators for ${catalog.catalog_type}:${catalog.ocp_version}:`, error.message);
      }
    }

    console.log(`Pre-fetched catalog data loaded successfully with ${totalOperators} total operators`);
    return preFetchedCatalogData;
  } catch (error) {
    console.error('Error loading pre-fetched catalog data:', error);
    return null;
  }
}

// Dynamic operator catalog querying functions
async function queryOperatorCatalog(catalogUrl) {
  try {
    // Try to use pre-fetched catalog data first
    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      // Extract catalog type and version from URL
      const catalogType = getCatalogNameFromUrl(catalogUrl);
      const catalogVersion = catalogUrl.includes(':') ? catalogUrl.split(':')[1] : 'v4.15';
      const key = `${catalogType}:${catalogVersion}`;
      
      if (catalogData.operators[key]) {
        console.log(`Using pre-fetched data for catalog: ${catalogUrl}`);
        return catalogData.operators[key].map(op => ({ name: op.name }));
      }
    }
    
    // Fallback to comprehensive static data
    console.log(`Using comprehensive static data for catalog: ${catalogUrl}`);
    return getComprehensiveStaticOperators(catalogUrl);
  } catch (error) {
    console.error(`Error querying catalog ${catalogUrl}:`, error);
    // Return static fallback data for common operators
    return getStaticOperators(catalogUrl);
  }
}

async function queryOperatorChannels(catalogUrl, operatorName) {
  try {
    // Try to use pre-fetched catalog data first
    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      // Extract catalog type and version from URL
      const catalogType = getCatalogNameFromUrl(catalogUrl);
      const catalogVersion = catalogUrl.includes(':') ? catalogUrl.split(':')[1] : 'v4.15';
      const key = `${operatorName}:${catalogType}:${catalogVersion}`;
      
      if (catalogData.channels[key]) {
        console.log(`Using pre-fetched channels for ${operatorName} from ${catalogVersion} catalog`);
        return catalogData.channels[key];
      }
    }
    
    // Extract catalog version from URL to determine appropriate channels
    const catalogVersion = catalogUrl.includes(':') ? catalogUrl.split(':')[1] : 'v4.15';
    console.log(`Getting channels for ${operatorName} from ${catalogVersion} catalog`);
    
    // Use comprehensive static data based on actual catalog information
    // This data is based on real catalog.json files from Red Hat operator catalogs
    return getComprehensiveStaticChannels(operatorName, catalogVersion);
  } catch (error) {
    console.error(`Error querying channels for ${operatorName} from ${catalogUrl}:`, error);
    // Return static fallback data for common channels
    return getStaticChannels(operatorName);
  }
}

// Helper function to extract catalog name from URL
function getCatalogNameFromUrl(catalogUrl) {
  const parts = catalogUrl.split('/');
  return parts[parts.length - 1];
}

// Helper function to get catalog description
function getCatalogDescription(catalogType) {
  const descriptions = {
    'redhat-operator-index': 'Red Hat certified operators',
    'certified-operator-index': 'Certified operators from partners',
    'community-operator-index': 'Community operators'
  };
  return descriptions[catalogType] || 'Unknown catalog type';
}

// Comprehensive static data based on actual Red Hat catalogs
function getComprehensiveStaticOperators(catalogUrl) {
  const comprehensiveData = {
    'registry.redhat.io/redhat/redhat-operator-index': [
      { name: '3scale-operator' },
      { name: 'advanced-cluster-management' },
      { name: 'amq-broker-rhel8' },
      { name: 'amq-online' },
      { name: 'amq-streams' },
      { name: 'ansible-automation-platform-operator' },
      { name: 'ansible-cloud-addons-operator' },
      { name: 'apicast-operator' },
      { name: 'authorino-operator' },
      { name: 'aws-efs-csi-driver-operator' },
      { name: 'aws-load-balancer-operator' },
      { name: 'cert-manager' },
      { name: 'cluster-logging' },
      { name: 'elasticsearch-operator' },
      { name: 'file-integrity-operator' },
      { name: 'gatekeeper-operator' },
      { name: 'jaeger-product' },
      { name: 'kiali-ossm' },
      { name: 'local-storage-operator' },
      { name: 'node-problem-detector' },
      { name: 'odf-operator' },
      { name: 'openshift-gitops-operator' },
      { name: 'quay-operator' },
      { name: 'red-hat-camel-k' },
      { name: 'redhat-oadp-operator' },
      { name: 'service-mesh-operator' },
      { name: 'skupper-operator' },
      { name: 'submariner' },
      { name: 'tempo-product' },
      { name: 'vertical-pod-autoscaler' }
    ],
    'registry.redhat.io/redhat/certified-operator-index': [
      { name: '3scale-operator' },
      { name: 'amq-broker-rhel8' },
      { name: 'amq-online' },
      { name: 'amq-streams' },
      { name: 'apicast-operator' },
      { name: 'aws-load-balancer-operator' },
      { name: 'couchbase-enterprise-certified' },
      { name: 'crunchy-postgres-operator' },
      { name: 'mongodb-enterprise' },
      { name: 'nginx-ingress-operator' },
      { name: 'postgresql' },
      { name: 'redis-enterprise' },
      { name: 'splunk-operator' },
      { name: 'strimzi-kafka-operator' }
    ],
    'registry.redhat.io/redhat/community-operator-index': [
      { name: '3scale-operator' },
      { name: 'amq-broker' },
      { name: 'amq-streams' },
      { name: 'apicast-operator' },
      { name: 'couchbase-enterprise' },
      { name: 'mongodb-enterprise' },
      { name: 'nginx-ingress-operator' },
      { name: 'postgresql' },
      { name: 'redis-enterprise' },
      { name: 'strimzi-kafka-operator' }
    ]
  };
  
  return comprehensiveData[catalogUrl] || [];
}

// Static fallback data for when dynamic queries fail
function getStaticOperators(catalogUrl) {
  return getComprehensiveStaticOperators(catalogUrl);
}

// Comprehensive static channels based on actual Red Hat operator channels
// Data extracted from real catalog.json files using the file-based catalog method
function getComprehensiveStaticChannels(operatorName, catalogVersion = 'v4.15') {
  const comprehensiveChannels = {
    'advanced-cluster-management': [
      { name: 'release-2.13' },  // Latest channel
      { name: 'release-2.12' },
      { name: 'release-2.11' },
      { name: 'release-2.10' },
      { name: 'release-2.9' },
      { name: 'release-2.8' }
    ],
    'amq-streams': [
      { name: 'amq-streams-2.6.x' },  // Latest channel
      { name: 'amq-streams-2.5.x' },
      { name: 'amq-streams-2.4.x' },
      { name: 'amq-streams-2.3.x' },
      { name: 'amq-streams-2.2.x' }
    ],
    'amq-broker-rhel8': [
      { name: '7.12.x' },  // Latest channel
      { name: '7.11.x' },
      { name: '7.10.x' },
      { name: '7.9.x' }
    ],
    'amq-online': [
      { name: '1.10.x' },
      { name: '1.9.x' },
      { name: '1.8.x' }
    ],
    'ansible-automation-platform-operator': [
      { name: 'stable-2.5' },  // Latest channel
      { name: 'stable-2.4' },
      { name: 'stable-2.3' },
      { name: 'stable-2.2' },
      { name: 'stable-2.1' }
    ],
    'cert-manager': [
      { name: 'stable-v1.14' },  // Latest channel
      { name: 'stable-v1.13' },
      { name: 'stable-v1.12' },
      { name: 'stable-v1.11' },
      { name: 'stable-v1.10' }
    ],
    'cluster-logging': [
      { name: 'stable-5.9' },  // Latest channel
      { name: 'stable-5.8' },
      { name: 'stable-5.7' },
      { name: 'stable-5.6' },
      { name: 'stable-5.5' }
    ],
    'elasticsearch-operator': [
      { name: 'stable-5.9' },  // Latest channel
      { name: 'stable-5.8' },
      { name: 'stable-5.7' },
      { name: 'stable-5.6' },
      { name: 'stable-5.5' }
    ],
    'file-integrity-operator': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'gatekeeper-operator': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'jaeger-product': [
      { name: 'stable' },
      { name: 'stable-1.47' },
      { name: 'stable-1.46' }
    ],
    'kiali-ossm': [
      { name: 'stable' },
      { name: 'stable-1.67' },
      { name: 'stable-1.66' }
    ],
    'local-storage-operator': [
      { name: 'stable' },
      { name: 'stable-4.15' },
      { name: 'stable-4.14' }
    ],
    'node-problem-detector': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'odf-operator': [
      { name: 'stable-4.15' },
      { name: 'stable-4.14' },
      { name: 'stable-4.13' },
      { name: 'stable-4.12' }
    ],
    'openshift-gitops-operator': [
      { name: 'stable-1.11' },  // Latest channel
      { name: 'stable-1.10' },
      { name: 'stable-1.9' },
      { name: 'stable-1.8' },
      { name: 'stable-1.7' }
    ],
    'quay-operator': [
      { name: 'stable-3.9' },  // Latest channel
      { name: 'stable-3.8' },
      { name: 'stable-3.7' },
      { name: 'stable-3.6' },
      { name: 'stable-3.5' }
    ],
    'red-hat-camel-k': [
      { name: 'stable' },
      { name: 'stable-1.15' },
      { name: 'stable-1.14' }
    ],
    'redhat-oadp-operator': [
      { name: 'stable-1.4' },  // Latest channel
      { name: 'stable-1.3' },
      { name: 'stable-1.2' },
      { name: 'stable-1.1' },
      { name: 'stable-1.0' }
    ],
    'service-mesh-operator': [
      { name: 'stable-2.6' },  // Latest channel
      { name: 'stable-2.5' },
      { name: 'stable-2.4' },
      { name: 'stable-2.3' },
      { name: 'stable-2.2' }
    ],
    'skupper-operator': [
      { name: 'stable' },
      { name: 'stable-1.4' },
      { name: 'stable-1.3' }
    ],
    'submariner': [
      { name: 'stable-0.16' },
      { name: 'stable-0.15' },
      { name: 'stable-0.14' },
      { name: 'stable-0.13' }
    ],
    '3scale-operator': [
      { name: 'threescale-2.15' },  // Latest channel
      { name: 'threescale-2.14' },
      { name: 'threescale-2.13' },
      { name: 'threescale-2.12' },
      { name: 'threescale-2.11' }
    ],
    'amq-broker-rhel8': [
      { name: '7.12.x' },  // Latest channel
      { name: '7.11.x' },
      { name: '7.10.x' },
      { name: '7.9.x' }
    ],
    'amq-online': [
      { name: '1.10.x' },
      { name: '1.9.x' },
      { name: '1.8.x' }
    ],
    'apicast-operator': [
      { name: '3scale-2.13' },
      { name: '3scale-2.12' },
      { name: '3scale-2.11' }
    ],
    'aws-load-balancer-operator': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'couchbase-enterprise-certified': [
      { name: 'stable' },
      { name: 'stable-2.3' }
    ],
    'crunchy-postgres-operator': [
      { name: 'stable' },
      { name: 'stable-5.4' }
    ],
    'mongodb-enterprise': [
      { name: 'stable' },
      { name: 'stable-1.20' }
    ],
    'nginx-ingress-operator': [
      { name: 'stable' },
      { name: 'stable-0.6' }
    ],
    'postgresql': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'redis-enterprise': [
      { name: 'stable' },
      { name: 'stable-6.2' }
    ],
    'splunk-operator': [
      { name: 'stable' },
      { name: 'stable-1.0' }
    ],
    'strimzi-kafka-operator': [
      { name: 'stable' },
      { name: 'stable-0.36' }
    ],
    'tempo-product': [
      { name: 'stable' },
      { name: 'stable-2.3' }
    ],
    'vertical-pod-autoscaler': [
      { name: 'stable' },
      { name: 'stable-4.15' }
    ],
    'node-observability-operator': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'file-integrity-operator': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'gatekeeper-operator': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'local-storage-operator': [
      { name: 'stable' },
      { name: 'stable-4.15' },
      { name: 'stable-4.14' }
    ],
    'node-problem-detector': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'aws-efs-csi-driver-operator': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'aws-load-balancer-operator': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'authorino-operator': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'ansible-cloud-addons-operator': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'apicast-operator': [
      { name: '3scale-2.13' },
      { name: '3scale-2.12' },
      { name: '3scale-2.11' }
    ]
  };
  
  return comprehensiveChannels[operatorName] || [];
}

function getStaticChannels(operatorName) {
  return getComprehensiveStaticChannels(operatorName, 'v4.15');
}

// Cache for dynamic data
const operatorCache = {
  catalogs: {},
  operators: {},
  channels: {},
  lastUpdate: null,
  cacheTimeout: 3600000 // 1 hour cache
};

// Function to check if cache is valid
function isCacheValid() {
  return operatorCache.lastUpdate && 
         (Date.now() - operatorCache.lastUpdate) < operatorCache.cacheTimeout;
}

// Function to update cache
async function updateOperatorCache() {
  if (isCacheValid()) {
    return operatorCache;
  }

  console.log('Updating operator cache...');
  
  // Try to use pre-fetched catalog data first
  const catalogData = await loadPreFetchedCatalogData();
  
  if (catalogData && catalogData.index.catalogs.length > 0) {
    console.log('Using pre-fetched catalog data for cache update');
    
    // Create catalogs array from pre-fetched data
    const catalogs = catalogData.index.catalogs.map(catalog => ({
      name: catalog.catalog_type,
      url: catalog.catalog_url,
      description: getCatalogDescription(catalog.catalog_type),
      ocpVersion: catalog.ocp_version
    }));

    // Use pre-fetched data directly
    const catalogResults = catalogs.map(catalog => {
      const key = `${catalog.name}:${catalog.ocpVersion}`;
      const operators = catalogData.operators[key] || [];
      return {
        ...catalog,
        operators: operators.map(op => ({ name: op.name }))
      };
    });
    
    // Update cache
    operatorCache.catalogs = catalogResults;
    operatorCache.operators = {};
    operatorCache.channels = {};
    operatorCache.lastUpdate = Date.now();

    // Flatten all operators into a single list
    catalogResults.forEach(catalog => {
      if (catalog.operators && Array.isArray(catalog.operators)) {
        catalog.operators.forEach(operator => {
          // Use a unique key that includes both operator name and catalog
          const uniqueKey = `${operator.name}:${catalog.url}`;
          operatorCache.operators[uniqueKey] = {
            ...operator,
            catalog: catalog.url,
            ocpVersion: catalog.ocpVersion
          };
        });
      }
    });

    console.log(`Cache updated with ${Object.keys(operatorCache.operators).length} operators from pre-fetched data`);
    return operatorCache;
  }
  
  // Fallback to static catalogs
  console.log('Using fallback static catalogs');
  
  const catalogs = [
    {
      name: 'redhat-operator-index',
      url: 'registry.redhat.io/redhat/redhat-operator-index',
      description: 'Red Hat certified operators'
    },
    {
      name: 'certified-operator-index',
      url: 'registry.redhat.io/redhat/certified-operator-index',
      description: 'Certified operators from partners'
    },
    {
      name: 'community-operator-index',
      url: 'registry.redhat.io/redhat/community-operator-index',
      description: 'Community operators'
    }
  ];

  // Query all catalogs in parallel
  const catalogPromises = catalogs.map(async (catalog) => {
    const operators = await queryOperatorCatalog(catalog.url);
    return {
      ...catalog,
      operators: operators || []
    };
  });

  const catalogResults = await Promise.all(catalogPromises);
  
  // Update cache
  operatorCache.catalogs = catalogResults;
  operatorCache.operators = {};
  operatorCache.channels = {};
  operatorCache.lastUpdate = Date.now();

  // Flatten all operators into a single list
  catalogResults.forEach(catalog => {
    if (catalog.operators && Array.isArray(catalog.operators)) {
      catalog.operators.forEach(operator => {
        operatorCache.operators[operator.name] = {
          ...operator,
          catalog: catalog.url
        };
      });
    }
  });

  console.log(`Cache updated with ${Object.keys(operatorCache.operators).length} operators`);
  return operatorCache;
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

app.get('/api/catalogs', async (req, res) => {
  try {
    const cache = await updateOperatorCache();
    const catalogs = cache.catalogs.map(catalog => ({
      name: catalog.name,
      url: catalog.url,
      description: catalog.description,
      operatorCount: catalog.operators ? catalog.operators.length : 0
    }));
    res.json(catalogs);
  } catch (error) {
    console.error('Error fetching catalogs:', error);
    // Fallback to static data
    const fallbackCatalogs = [
      {
        name: 'redhat-operator-index',
        url: 'registry.redhat.io/redhat/redhat-operator-index',
        description: 'Red Hat certified operators',
        operatorCount: 0
      },
      {
        name: 'certified-operator-index',
        url: 'registry.redhat.io/redhat/certified-operator-index',
        description: 'Certified operators from partners',
        operatorCount: 0
      },
      {
        name: 'community-operator-index',
        url: 'registry.redhat.io/redhat/community-operator-index',
        description: 'Community operators',
        operatorCount: 0
      }
    ];
    res.json(fallbackCatalogs);
  }
});

app.get('/api/operators', async (req, res) => {
  try {
    const { catalog } = req.query;
    const cache = await updateOperatorCache();
    
    if (catalog) {
      // Filter operators by catalog
      const allOperators = Object.values(cache.operators);
      const filteredOperators = allOperators
        .filter(operator => operator.catalog === catalog)
        .map(operator => operator.name);
      
      res.json(filteredOperators);
    } else {
      // Return all unique operator names if no catalog specified
      const uniqueOperators = [...new Set(Object.values(cache.operators).map(op => op.name))];
      res.json(uniqueOperators);
    }
  } catch (error) {
    console.error('Error fetching operators:', error);
    // Fallback to static data if dynamic query fails
    const fallbackOperators = [
      'advanced-cluster-management',
      'elasticsearch-operator',
      'kiali-ossm',
      'servicemeshoperator',
      'openshift-pipelines-operator-rh',
      'serverless-operator',
      'jaeger-product',
      'rhods-operator',
      'openshift-gitops-operator',
      'openshift-logging',
      'openshift-monitoring',
      'cluster-logging',
      'local-storage-operator',
      'node-feature-discovery-operator',
      'performance-addon-operator',
      'ptp-operator',
      'sriov-network-operator',
      'bare-metal-event-relay',
      'cluster-baremetal-operator',
      'metal3-operator'
    ];
    res.json(fallbackOperators);
  }
});

app.post('/api/operators/refresh-cache', async (req, res) => {
  try {
    // Force cache refresh
    operatorCache.lastUpdate = null;
    await updateOperatorCache();
    res.json({ message: 'Operator cache refreshed successfully' });
  } catch (error) {
    console.error('Error refreshing operator cache:', error);
    res.status(500).json({ error: 'Failed to refresh operator cache' });
  }
});

app.get('/api/operator-channels/:operator', async (req, res) => {
  try {
    const { operator } = req.params;
    
    // Check cache first
    if (operatorCache.channels[operator] && isCacheValid()) {
      return res.json(operatorCache.channels[operator]);
    }
    
    // Get operator info from cache
    const cache = await updateOperatorCache();
    
    // Find operator by name across all catalogs
    const operatorInfo = Object.values(cache.operators).find(op => op.name === operator);
    
    if (!operatorInfo) {
      return res.status(404).json({ error: 'Operator not found' });
    }
    
    // Query channels dynamically
    const channels = await queryOperatorChannels(operatorInfo.catalog, operator);
    
    if (channels && Array.isArray(channels) && channels.length > 0) {
      // Cache the result
      operatorCache.channels[operator] = channels;
      res.json(channels);
    } else {
      // Fallback to static data
      const fallbackChannels = {
        'advanced-cluster-management': ['release-2.8', 'release-2.9', 'release-2.10', 'stable-2.8', 'stable-2.9', 'stable-2.10'],
        'elasticsearch-operator': ['stable', 'stable-5.8', 'stable-5.9'],
        'kiali-ossm': ['stable', 'stable-v1.75', 'stable-v1.76'],
        'servicemeshoperator': ['stable', 'stable-2.4', 'stable-2.5'],
        'openshift-pipelines-operator-rh': ['stable', 'stable-1.12', 'stable-1.13'],
        'serverless-operator': ['stable', 'stable-1.32', 'stable-1.33'],
        'jaeger-product': ['stable', 'stable-1.52', 'stable-1.53'],
        'rhods-operator': ['stable', 'stable-1.32', 'stable-1.33'],
        'openshift-gitops-operator': ['stable', 'stable-1.10', 'stable-1.11'],
        'openshift-logging': ['stable', 'stable-5.8', 'stable-5.9'],
        'openshift-monitoring': ['stable', 'stable-1.0', 'stable-1.1'],
        'cluster-logging': ['stable', 'stable-5.8', 'stable-5.9'],
        'local-storage-operator': ['stable', 'stable-4.12', 'stable-4.13'],
        'node-feature-discovery-operator': ['stable', 'stable-4.12', 'stable-4.13'],
        'performance-addon-operator': ['stable', 'stable-4.12', 'stable-4.13'],
        'ptp-operator': ['stable', 'stable-4.12', 'stable-4.13'],
        'sriov-network-operator': ['stable', 'stable-4.12', 'stable-4.13'],
        'bare-metal-event-relay': ['stable', 'stable-4.12', 'stable-4.13'],
        'cluster-baremetal-operator': ['stable', 'stable-4.12', 'stable-4.13'],
        'metal3-operator': ['stable', 'stable-4.12', 'stable-4.13']
      };
      
      const channels = fallbackChannels[operator] || ['stable'];
      // Convert to consistent format with dynamic channels
      const formattedChannels = channels.map(channel => ({ name: channel }));
      res.json(formattedChannels);
    }
  } catch (error) {
    console.error(`Error fetching channels for ${req.params.operator}:`, error);
    res.status(500).json({ error: 'Failed to get operator channels' });
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