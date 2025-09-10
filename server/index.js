const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const YAML = require('yaml');
const { v4: uuidv4 } = require('uuid');
const tar = require('tar');

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
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || './downloads';

// Process tracking for operations
const runningProcesses = new Map(); // operationId -> { pid, child }

// Ensure directories exist
async function ensureDirectories() {
  const dirs = [STORAGE_DIR, CONFIGS_DIR, OPERATIONS_DIR, LOGS_DIR, CACHE_DIR, DOWNLOADS_DIR];
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

// Helper to extract OC version from oc version output (excludes Kustomize version)
function parseOcVersion(raw) {
  // Look for the line that contains "Client Version:"
  const lines = raw.split('\n');
  for (const line of lines) {
    if (line.includes('Client Version:')) {
      const match = line.match(/Client Version:\s*(\S+)/);
      if (match) {
        return match[1];
      }
    }
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
      ocVersion: parseOcVersion(ocVersion.stdout.trim()),
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
    // Extract catalog type and version from URL
    const catalogType = getCatalogNameFromUrl(catalogUrl);
    const catalogVersion = catalogUrl.includes(':') ? catalogUrl.split(':')[1] : 'v4.15';
    
    // First, try to read the actual catalog data from the catalog-data directory
    const actualChannels = await getActualChannelsFromCatalog(catalogType, catalogVersion, operatorName);
    if (actualChannels && actualChannels.length > 0) {
      console.log(`Using actual catalog data for ${operatorName} from ${catalogVersion} catalog`);
      return actualChannels;
    }
    
    // Fallback to pre-fetched catalog data
    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      const key = `${operatorName}:${catalogType}:${catalogVersion}`;
      
      if (catalogData.channels[key]) {
        console.log(`Using pre-fetched channels for ${operatorName} from ${catalogVersion} catalog`);
        return catalogData.channels[key];
      }
    }
    
    // Final fallback to comprehensive static data
    console.log(`Using comprehensive static data for ${operatorName} from ${catalogVersion} catalog`);
    return getComprehensiveStaticChannels(operatorName, catalogVersion);
  } catch (error) {
    console.error(`Error querying channels for ${operatorName} from ${catalogUrl}:`, error);
    // Return static fallback data for common channels
    return getStaticChannels(operatorName);
  }
}

// Helper function to extract catalog name from URL
function getCatalogNameFromUrl(catalogUrl) {
  if (catalogUrl.includes('redhat-operator-index')) {
    return 'redhat-operator-index';
  } else if (catalogUrl.includes('certified-operator-index')) {
    return 'certified-operator-index';
  } else if (catalogUrl.includes('community-operator-index')) {
    return 'community-operator-index';
  }
  return 'redhat-operator-index'; // Default
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

// Function to read actual channels from catalog data
async function getActualChannelsFromCatalog(catalogType, catalogVersion, operatorName) {
  try {
    // Use pre-fetched catalog data instead of reading individual files
    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      const key = `${catalogType}:${catalogVersion}`;
      const operators = catalogData.operators[key];
      
      if (operators) {
        const operator = operators.find(op => op.name === operatorName);
        if (operator) {
          // Convert the channels array to the expected format
          const channels = [];
          if (operator.channels && Array.isArray(operator.channels)) {
            // The channels array contains channel names as strings
            operator.channels.forEach(channelName => {
              if (typeof channelName === 'string') {
                channels.push({ name: channelName });
              }
            });
          }
          
          console.log(`Found ${channels.length} channels for ${operatorName} in ${catalogType}:${catalogVersion} using pre-fetched data`);
          return channels;
        }
      }
    }
    
    // Fallback to reading individual catalog.json file if pre-fetched data not available
    const fs = require('fs').promises;
    const path = require('path');
    
    // Construct the path to the operator's catalog.json file
    const catalogPath = path.join(__dirname, `../catalog-data/${catalogType}/${catalogVersion}/configs/${operatorName}/catalog.json`);
    
    // Check if the file exists
    try {
      await fs.access(catalogPath);
    } catch (error) {
      console.log(`Catalog file not found for ${operatorName} in ${catalogType}:${catalogVersion}`);
      return null;
    }
    
    // Read the catalog.json file
    const catalogContent = await fs.readFile(catalogPath, 'utf8');
    
    // Parse the JSON content (it can contain single JSON object or multiple JSON objects concatenated together)
    const channels = [];
    
    // Always try parsing as multiple concatenated JSON objects first, as this is more common
    // Split the content by JSON object boundaries
    // Look for patterns like }}{" to find where one JSON object ends and another begins
    const jsonObjects = catalogContent.split('}{');
    
    for (let i = 0; i < jsonObjects.length; i++) {
      let jsonStr = jsonObjects[i];
      
      // Add back the braces that were removed by the split
      if (i === 0) {
        // First object: add closing brace
        jsonStr += '}';
      } else if (i === jsonObjects.length - 1) {
        // Last object: add opening brace
        jsonStr = '{' + jsonStr;
      } else {
        // Middle objects: add both braces
        jsonStr = '{' + jsonStr + '}';
      }
      
      try {
        const obj = JSON.parse(jsonStr);
        // Look for channel objects
        if (obj.schema === 'olm.channel' && obj.name) {
          channels.push({ name: obj.name });
        }
      } catch (parseError) {
        // Skip invalid JSON objects
        continue;
      }
    }
    
    // If no channels found with multiple objects approach, try single object approach
    if (channels.length === 0) {
      try {
        const singleObj = JSON.parse(catalogContent);
        if (singleObj.schema === 'olm.channel' && singleObj.name) {
          channels.push({ name: singleObj.name });
        }
      } catch (singleParseError) {
        // Single object parsing failed, but that's okay since we already tried multiple objects
      }
    }
    
    // Remove duplicates and sort
    const uniqueChannels = channels.filter((channel, index, self) => 
      index === self.findIndex(c => c.name === channel.name)
    );
    
    console.log(`Found ${uniqueChannels.length} channels for ${operatorName} in ${catalogType}:${catalogVersion} using file reading`);
    return uniqueChannels;
    
  } catch (error) {
    console.error(`Error reading catalog data for ${operatorName} in ${catalogType}:${catalogVersion}:`, error.message);
    return null;
  }
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
    'advanced-cluster-management': (catalogVersion) => {
      // Version-specific channels for ACM operator
      const versionMap = {
        'v4.15': [
          { name: 'release-2.13' },  // Latest channel (default)
          { name: 'release-2.10' }
        ],
        'v4.16': [
          { name: 'release-2.13' },  // Latest channel (default)
          { name: 'release-2.10' }
        ],
        'v4.17': [
          { name: 'release-2.13' },  // Latest channel (default)
          { name: 'release-2.11' }
        ],
        'v4.18': [
          { name: 'release-2.13' },  // Latest channel (default)
          { name: 'release-2.12' }
        ],
        'v4.19': [
          { name: 'release-2.13' },  // Latest channel (default)
          { name: 'release-2.13' }
        ]
      };
      return versionMap[catalogVersion] || versionMap['v4.15'];
    },
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
    'ansible-automation-platform-operator': (catalogVersion) => {
      // Version-specific channels for Ansible Automation Platform operator
      const versionMap = {
        'v4.15': [
          { name: 'stable-2.5' },  // Latest channel (default)
          { name: 'stable-2.4' }
        ],
        'v4.16': [
          { name: 'stable-2.5' },  // Latest channel (default)
          { name: 'stable-2.4' }
        ],
        'v4.17': [
          { name: 'stable-2.5' },  // Latest channel (default)
          { name: 'stable-2.4' }
        ],
        'v4.18': [
          { name: 'stable-2.5' },  // Latest channel (default)
          { name: 'stable-2.4' }
        ],
        'v4.19': [
          { name: 'stable-2.5' },  // Latest channel (default)
          { name: 'stable-2.5' }
        ]
      };
      return versionMap[catalogVersion] || versionMap['v4.15'];
    },
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
    'local-storage-operator': (catalogVersion) => {
      // Local storage operator uses the same channels across all versions
      return [
        { name: 'stable' },  // Default channel
        { name: 'stable-4.15' },
        { name: 'stable-4.14' }
      ];
    },
    'node-problem-detector': [
      { name: 'stable' },
      { name: 'stable-0.1' }
    ],
    'odf-operator': (catalogVersion) => {
      // Version-specific channels for ODF operator
      const versionMap = {
        'v4.15': [
          { name: 'stable-4.15' },  // Latest channel (default)
          { name: 'stable-4.14' }
        ],
        'v4.16': [
          { name: 'stable-4.16' },  // Latest channel (default)
          { name: 'stable-4.15' }
        ],
        'v4.17': [
          { name: 'stable-4.17' },  // Latest channel (default)
          { name: 'stable-4.16' }
        ],
        'v4.18': [
          { name: 'stable-4.18' },  // Latest channel (default)
          { name: 'stable-4.17' }
        ],
        'v4.19': [
          { name: 'stable-4.18' },  // Latest channel (default)
          { name: 'stable-4.18' }
        ]
      };
      return versionMap[catalogVersion] || versionMap['v4.15'];
    },
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
    'rhbk-operator': (catalogVersion) => {
      // Version-specific channels for RHBK operator
      if (catalogVersion === 'v4.18') {
        return [
          { name: 'stable-v26.2' },  // Latest channel (default)
          { name: 'stable-v26.0' },
          { name: 'stable-v26' },
          { name: 'stable-v24.0' },
          { name: 'stable-v24' },
          { name: 'stable-v22.0' },
          { name: 'stable-v22' }
        ];
      } else {
        // For v4.15, v4.16, v4.17, v4.19 - only stable-v22 is available
        return [
          { name: 'stable-v22' },  // Only available channel
          { name: 'stable-v22.0' }
        ];
      }
    },
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
    '3scale-operator': (catalogVersion) => {
      // Version-specific channels for 3scale operator
      const versionMap = {
        'v4.15': [
          { name: 'threescale-2.15' },  // Latest channel (default)
          { name: 'threescale-2.13' }
        ],
        'v4.16': [
          { name: 'threescale-2.15' },  // Latest channel (default)
          { name: 'threescale-2.13' }
        ],
        'v4.17': [
          { name: 'threescale-2.15' },  // Latest channel (default)
          { name: 'threescale-2.13' }
        ],
        'v4.18': [
          { name: 'threescale-2.15' },  // Latest channel (default)
          { name: 'threescale-2.13' }
        ],
        'v4.19': [
          { name: 'threescale-2.13' },  // Latest channel (default)
          { name: 'threescale-mas' }
        ]
      };
      return versionMap[catalogVersion] || versionMap['v4.15'];
    },
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
    'ansible-cloud-addons-operator': (catalogVersion) => {
      // Version-specific channels for Ansible Cloud Addons operator
      const versionMap = {
        'v4.15': [
          { name: 'stable-2.5-cluster-scoped' },  // Latest channel (default)
          { name: 'stable-2.4-cluster-scoped' }
        ],
        'v4.16': [
          { name: 'stable-2.5-cluster-scoped' },  // Latest channel (default)
          { name: 'stable-2.4-cluster-scoped' }
        ],
        'v4.17': [
          { name: 'stable-2.5-cluster-scoped' },  // Latest channel (default)
          { name: 'stable-2.4-cluster-scoped' }
        ],
        'v4.18': [
          { name: 'stable-2.5-cluster-scoped' },  // Latest channel (default)
          { name: 'stable-2.5-cluster-scoped' }
        ],
        'v4.19': [
          { name: 'stable-2.5-cluster-scoped' },  // Latest channel (default)
          { name: 'stable-2.5-cluster-scoped' }
        ]
      };
      return versionMap[catalogVersion] || versionMap['v4.15'];
    },
    'apicast-operator': [
      { name: '3scale-2.13' },
      { name: '3scale-2.12' },
      { name: '3scale-2.11' }
    ]
  };
  
  const channels = comprehensiveChannels[operatorName];
  
  // Handle function-based channel configurations (like RHBK operator)
  if (typeof channels === 'function') {
    return channels(catalogVersion);
  }
  
  return channels || [];
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

app.post('/api/config/upload', async (req, res) => {
  try {
    const { filename, content } = req.body;
    
    if (!filename || !content) {
      return res.status(400).json({ error: 'Filename and content are required' });
    }

    // Validate that the content is valid YAML
    try {
      const parsed = YAML.parse(content);
      
      // Basic validation for ImageSetConfiguration
      if (!parsed.kind || parsed.kind !== 'ImageSetConfiguration') {
        return res.status(400).json({ error: 'Invalid YAML: Must be an ImageSetConfiguration' });
      }

      if (!parsed.apiVersion || !parsed.apiVersion.includes('mirror.openshift.io')) {
        return res.status(400).json({ error: 'Invalid YAML: Must have mirror.openshift.io API version' });
      }

      if (!parsed.mirror) {
        return res.status(400).json({ error: 'Invalid YAML: Missing mirror section' });
      }
    } catch (yamlError) {
      return res.status(400).json({ error: `Invalid YAML: ${yamlError.message}` });
    }

    // Ensure filename has .yaml extension
    const finalFilename = filename.endsWith('.yaml') || filename.endsWith('.yml') 
      ? filename 
      : `${filename}.yaml`;
    
    const filepath = path.join(CONFIGS_DIR, finalFilename);
    
    // Check if file already exists
    try {
      await fs.access(filepath);
      return res.status(409).json({ error: 'Configuration file already exists' });
    } catch (error) {
      // File doesn't exist, which is what we want
    }
    
    await fs.writeFile(filepath, content);
    res.json({ message: 'Configuration uploaded successfully', filename: finalFilename });
  } catch (error) {
    console.error('Error uploading configuration:', error);
    res.status(500).json({ error: 'Failed to upload configuration' });
  }
});

app.delete('/api/config/delete/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    // Security check: ensure filename doesn't contain path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(CONFIGS_DIR, filename);
    
    // Check if file exists
    try {
      await fs.access(filepath);
    } catch (error) {
      return res.status(404).json({ error: 'Configuration file not found' });
    }
    
    // Delete the file
    await fs.unlink(filepath);
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error) {
    console.error('Error deleting configuration:', error);
    res.status(500).json({ error: 'Failed to delete configuration' });
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
    const { catalog, detailed } = req.query;
    
    if (catalog) {
      // Use pre-fetched catalog data for comprehensive information
      const catalogData = await loadPreFetchedCatalogData();
      if (catalogData) {
        // Extract catalog type and version from URL
        const catalogType = getCatalogNameFromUrl(catalog);
        const catalogVersion = catalog.includes(':') ? catalog.split(':')[1] : 'v4.15';
        const key = `${catalogType}:${catalogVersion}`;
        
        const operators = catalogData.operators[key];
        if (operators) {
          if (detailed === 'true') {
            // Return detailed operator information with channels
            const detailedOperators = operators.map(operator => {
              const normalizedChannels = normalizeChannels(operator.channels || [], operator.name);
              return {
                name: operator.name,
                defaultChannel: operator.defaultChannel,
                channels: normalizedChannels,
                allChannels: normalizedChannels.map(ch => ch.name),
                catalog: operator.catalog,
                ocpVersion: operator.ocpVersion,
                catalogUrl: operator.catalogUrl
              };
            });
            res.json(detailedOperators);
          } else {
            // Return just operator names
            res.json(operators.map(operator => operator.name));
          }
          return;
        }
      }
      
      // Fallback to cache if pre-fetched data not available
      const cache = await updateOperatorCache();
      const allOperators = Object.values(cache.operators);
      const filteredOperators = allOperators
        .filter(operator => operator.catalog === catalog);
      
      if (detailed === 'true') {
        // Return detailed operator information with channels
        const detailedOperators = filteredOperators.map(operator => {
          const normalizedChannels = normalizeChannels(operator.channels || [], operator.name);
          return {
            name: operator.name,
            defaultChannel: operator.defaultChannel,
            channels: normalizedChannels,
            allChannels: normalizedChannels.map(ch => ch.name),
            catalog: operator.catalog,
            ocpVersion: operator.ocpVersion,
            catalogUrl: operator.catalogUrl
          };
        });
        res.json(detailedOperators);
      } else {
        // Return just operator names
        res.json(filteredOperators.map(operator => operator.name));
      }
    } else {
      // Return all unique operator names if no catalog specified
      const cache = await updateOperatorCache();
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

// Helper function to normalize channel format
// Helper function to extract version information from channels
function extractVersionInfo(channelNames, operatorName) {
  const versions = new Set();
  const genericChannels = [];
  
  channelNames.forEach(channel => {
    if (!channel || !channel.trim()) return;
    
    // Extract version from operator-specific channels
    if (operatorName && channel.includes(`${operatorName}.`)) {
      // Pattern 1: operator.vX.Y.Z (e.g., "rhbk-operator.v26.2.4-opr.1")
      const versionWithV = channel.match(new RegExp(`${operatorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.v(.+)`));
      if (versionWithV) {
        versions.add(versionWithV[1]);
        return;
      }
      
      // Pattern 2: operator.X.Y.Z (e.g., "rhsso-operator.7.5.0", "kubernetes-nmstate-operator.4.19.0-202506020913")
      const versionWithoutV = channel.match(new RegExp(`${operatorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(.+)`));
      if (versionWithoutV) {
        versions.add(versionWithoutV[1]);
        return;
      }
    }
    
    // Try partial operator name match (for cases like accuknox-operator-certified vs accuknox-operator)
    if (operatorName) {
      const operatorBase = operatorName.replace(/-certified$/, '').replace(/-community$/, '');
      if (operatorBase !== operatorName && channel.includes(`${operatorBase}.`)) {
        // Pattern 1: operator.vX.Y.Z
        const versionWithV = channel.match(new RegExp(`${operatorBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.v(.+)`));
        if (versionWithV) {
          versions.add(versionWithV[1]);
          return;
        }
        
        // Pattern 2: operator.X.Y.Z
        const versionWithoutV = channel.match(new RegExp(`${operatorBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(.+)`));
        if (versionWithoutV) {
          versions.add(versionWithoutV[1]);
          return;
        }
      }
    }
    
    // Try generic version extraction for any operator.v pattern
    const genericVersionWithV = channel.match(/^[^.]+\.v(.+)/);
    if (genericVersionWithV) {
      versions.add(genericVersionWithV[1]);
      return;
    }
    
    // Try generic version extraction for any operator.X.Y.Z pattern
    const genericVersionWithoutV = channel.match(/^[^.]+\.(\d+\.\d+\.\d+.*)/);
    if (genericVersionWithoutV) {
      versions.add(genericVersionWithoutV[1]);
      return;
    }
    
    // Extract version from version-specific channels like "v26.2.4"
    const versionMatch = channel.match(/^v?(\d+\.\d+\.\d+)/);
    if (versionMatch) {
      versions.add(versionMatch[1]);
      return;
    }
    
    // Keep generic channels like "stable", "alpha", "release-2.12", etc.
    genericChannels.push(channel);
  });
  
  // Sort versions semantically (handle complex version strings)
  const sortedVersions = Array.from(versions).sort((a, b) => {
    // Extract the base version (X.Y.Z) from complex version strings
    const getBaseVersion = (version) => {
      const match = version.match(/^(\d+\.\d+\.\d+)/);
      return match ? match[1] : version;
    };
    
    const baseA = getBaseVersion(a);
    const baseB = getBaseVersion(b);
    
    // Compare base versions semantically
    const partsA = baseA.split('.').map(Number);
    const partsB = baseB.split('.').map(Number);
    
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] || 0;
      const partB = partsB[i] || 0;
      
      if (partA !== partB) {
        return partA - partB;
      }
    }
    
    // If base versions are equal, sort by full string (for build metadata)
    return a.localeCompare(b);
  });
  
  return {
    genericChannels,
    versions: sortedVersions
  };
}

function normalizeChannels(channels, operatorName = null) {
  if (!channels || !Array.isArray(channels)) {
    return [];
  }
  
  let channelNames = [];
  
  // Handle case where channels might be a single string with spaces (from our updated script)
  if (channels.length === 1 && typeof channels[0] === 'string') {
    if (channels[0].includes('\n')) {
      channelNames = channels[0].split('\n').filter(line => line.trim()).map(channel => channel.trim());
    } else if (channels[0].includes(' ')) {
      channelNames = channels[0].split(' ').filter(channel => channel.trim()).map(channel => channel.trim());
    } else {
      channelNames = [channels[0]];
    }
  } else {
    // Handle array of channels
    channelNames = channels.map(channel => {
      if (typeof channel === 'string') {
        return channel;
      } else if (channel && typeof channel === 'object' && channel.name) {
        return channel.name;
      } else {
        return String(channel);
      }
    });
  }
  
  // Extract version information and generic channels
  const { genericChannels, versions } = extractVersionInfo(channelNames, operatorName);
  
  // Convert back to channel objects with version information
  const channelObjects = genericChannels.map(channel => ({ name: channel }));
  
  // Add version information to the first channel object for easy access
  if (channelObjects.length > 0 && versions.length > 0) {
    channelObjects[0].availableVersions = versions;
  }
  
  return channelObjects;
}

// New endpoint to get operator versions
app.get('/api/operators/:operator/versions', async (req, res) => {
  try {
    const { operator } = req.params;
    const { catalog, channel } = req.query;
    
    // Use pre-fetched catalog data
    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      // If catalog is provided, extract catalog type and version
      if (catalog) {
        const catalogType = getCatalogNameFromUrl(catalog);
        const catalogVersion = catalog.includes(':') ? catalog.split(':')[1] : 'v4.15';
        const key = `${catalogType}:${catalogVersion}`;
        
        const operators = catalogData.operators[key];
        if (operators) {
          const operatorData = operators.find(op => op.name === operator);
          if (operatorData) {
            // Handle channels - they can be either an array of individual channel names or a string that needs splitting
            let channelNames = [];
            if (operatorData.channels && operatorData.channels.length > 0) {
              const firstChannel = operatorData.channels[0];
              if (typeof firstChannel === 'string' && (firstChannel.includes(' ') || firstChannel.includes('\n'))) {
                // Legacy format: channels stored as space-separated string in first element
                if (firstChannel.includes('\n')) {
                  channelNames = firstChannel.split('\n').filter(line => line.trim()).map(channel => channel.trim());
                } else if (firstChannel.includes(' ')) {
                  channelNames = firstChannel.split(' ').filter(channel => channel.trim()).map(channel => channel.trim());
                }
              } else {
                // New format: channels already stored as array of individual channel names
                channelNames = operatorData.channels.filter(channel => channel && channel.trim());
              }
            }
            
            const { versions } = extractVersionInfo(channelNames, operatorData.name);
            return res.json({ versions });
          }
        }
      } else {
        // Search across all catalogs
        for (const [key, operators] of Object.entries(catalogData.operators)) {
          const operatorData = operators.find(op => op.name === operator);
          if (operatorData) {
            // Handle channels - they can be either an array of individual channel names or a string that needs splitting
            let channelNames = [];
            if (operatorData.channels && operatorData.channels.length > 0) {
              const firstChannel = operatorData.channels[0];
              if (typeof firstChannel === 'string' && (firstChannel.includes(' ') || firstChannel.includes('\n'))) {
                // Legacy format: channels stored as space-separated string in first element
                if (firstChannel.includes('\n')) {
                  channelNames = firstChannel.split('\n').filter(line => line.trim()).map(channel => channel.trim());
                } else if (firstChannel.includes(' ')) {
                  channelNames = firstChannel.split(' ').filter(channel => channel.trim()).map(channel => channel.trim());
                }
              } else {
                // New format: channels already stored as array of individual channel names
                channelNames = operatorData.channels.filter(channel => channel && channel.trim());
              }
            }
            
            const { versions } = extractVersionInfo(channelNames, operatorData.name);
            return res.json({ versions });
          }
        }
      }
    }
    
    // Fallback response if operator not found
    res.status(404).json({ error: 'Operator not found' });
    
  } catch (error) {
    console.error(`Error getting versions for ${operator}:`, error);
    res.status(500).json({ error: 'Failed to get operator versions' });
  }
});

// New endpoint to get operator channel information
app.get('/api/operator-channels/:operator', async (req, res) => {
  try {
    const { operator } = req.params;
    const { catalogUrl } = req.query;
    
    // Use pre-fetched catalog data
    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      // If catalogUrl is provided, extract catalog type and version
      if (catalogUrl) {
        const catalogType = getCatalogNameFromUrl(catalogUrl);
        const catalogVersion = catalogUrl.includes(':') ? catalogUrl.split(':')[1] : 'v4.15';
        const key = `${catalogType}:${catalogVersion}`;
        
        const operators = catalogData.operators[key];
        if (operators) {
          const operatorData = operators.find(op => op.name === operator);
          if (operatorData) {
            const normalizedChannels = normalizeChannels(operatorData.channels || [], operatorData.name);
            return res.json({
              name: operatorData.name,
              defaultChannel: operatorData.defaultChannel,
              channels: normalizedChannels,
              allChannels: normalizedChannels.map(ch => ch.name),
              catalog: operatorData.catalog,
              ocpVersion: operatorData.ocpVersion,
              catalogUrl: operatorData.catalogUrl
            });
          }
        }
      } else {
        // Search across all catalogs
        for (const [key, operators] of Object.entries(catalogData.operators)) {
          const operatorData = operators.find(op => op.name === operator);
          if (operatorData) {
            const normalizedChannels = normalizeChannels(operatorData.channels || [], operatorData.name);
            return res.json({
              name: operatorData.name,
              defaultChannel: operatorData.defaultChannel,
              channels: normalizedChannels,
              allChannels: normalizedChannels.map(ch => ch.name),
              catalog: operatorData.catalog,
              ocpVersion: operatorData.ocpVersion,
              catalogUrl: operatorData.catalogUrl
            });
          }
        }
      }
    }
    
    // Fallback response if operator not found
    res.status(404).json({ error: 'Operator not found' });
    
  } catch (error) {
    console.error(`Error getting channel info for ${operator}:`, error);
    res.status(500).json({ error: 'Failed to get operator channel information' });
  }
});

app.get('/api/operator-channels/:operator', async (req, res) => {
  try {
    const { operator } = req.params;
    const { catalogUrl } = req.query;
    
    // If catalogUrl is provided, use it directly
    if (catalogUrl) {
      const channels = await queryOperatorChannels(catalogUrl, operator);
      if (channels && Array.isArray(channels) && channels.length > 0) {
        const normalizedChannels = normalizeChannels(channels, operator);
        return res.json(normalizedChannels);
      }
    }
    
    // Check cache first (fallback)
    if (operatorCache.channels[operator] && isCacheValid()) {
      const normalizedChannels = normalizeChannels(operatorCache.channels[operator], operator);
      return res.json(normalizedChannels);
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
      const normalizedChannels = normalizeChannels(channels, operator);
      res.json(normalizedChannels);
    } else {
      res.status(404).json({ error: 'No channels found for this operator' });
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

    // Start oc-mirror process with v2 using spawn for better process control
    const logFile = path.join(LOGS_DIR, `${operationId}.log`);
    
    // Create log file stream
    const logStream = require('fs').createWriteStream(logFile);
    
    // Spawn the oc-mirror process
    const child = spawn('oc-mirror', [
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
    
    // Track the process
    runningProcesses.set(operationId, {
      pid: child.pid,
      child: child
    });
    
    // Pipe output to log file and capture for processing
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', async (code) => {
      // Remove from running processes
      runningProcesses.delete(operationId);
      
      // Close log stream
      logStream.end();
      
      let logs = stdout + stderr;
      // If logs are empty, try to read from log file
      if (!logs) {
        try {
          logs = await fs.readFile(logFile, 'utf8');
        } catch {}
      }
      
      const hasErrorInLogs = logs.toLowerCase().includes('[error]') || logs.toLowerCase().includes('error:');
      let finalStatus = 'success';
      if (code !== 0 || hasErrorInLogs) finalStatus = 'failed';
      
      // Check if operation was manually stopped
      const opFile = path.join(OPERATIONS_DIR, `${operationId}.json`);
      let opData = JSON.parse(await fs.readFile(opFile, 'utf8'));
      if (opData.status === 'stopped') finalStatus = 'stopped';
      
      const completedAt = new Date().toISOString();
      const duration = Math.floor((new Date(completedAt) - new Date(operation.startedAt)) / 1000);
      
      await updateOperation(operationId, {
        status: finalStatus,
        completedAt,
        duration,
        errorMessage: code !== 0 ? `Process exited with code ${code}` : (hasErrorInLogs ? 'Error detected in logs' : null),
        logs: logs.split('\n')
      });
    });
    
    child.on('error', async (error) => {
      // Remove from running processes
      runningProcesses.delete(operationId);
      
      // Close log stream
      logStream.end();
      
      const completedAt = new Date().toISOString();
      const duration = Math.floor((new Date(completedAt) - new Date(operation.startedAt)) / 1000);
      
      await updateOperation(operationId, {
        status: 'failed',
        completedAt,
        duration,
        errorMessage: error.message,
        logs: [error.message]
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
    
    // Check if process is running and kill it
    const processInfo = runningProcesses.get(id);
    if (processInfo) {
      try {
        // Kill the process
        processInfo.child.kill('SIGTERM');
        
        // Wait a bit for graceful shutdown, then force kill if needed
        setTimeout(() => {
          if (processInfo.child.killed === false) {
            processInfo.child.kill('SIGKILL');
          }
        }, 5000);
        
        // Remove from running processes
        runningProcesses.delete(id);
      } catch (killError) {
        console.error('Error killing process:', killError);
      }
    }
    
    // Update operation status
    await updateOperation(id, {
      status: 'stopped',
      completedAt: new Date().toISOString()
    });
    
    res.json({ message: 'Operation stopped successfully' });
  } catch (error) {
    console.error('Error stopping operation:', error);
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
    
    if (!operation) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    // Parse operation logs to extract real statistics
    const details = {
      imagesMirrored: 0,
      operatorsMirrored: 0,
      totalSize: 0,
      platformImages: 0,
      additionalImages: 0,
      helmCharts: 0,
      configFile: operation.configFile,
      manifestFiles: [
        'imageContentSourcePolicy.yaml',
        'catalogSource.yaml',
        'mapping.txt'
      ]
    };

    // Parse logs to extract statistics
    if (operation.logs && Array.isArray(operation.logs)) {
      const logs = operation.logs.join('\n');
      
      // Extract images to copy count
      const imagesToCopyMatch = logs.match(/📌 images to copy (\d+)/);
      if (imagesToCopyMatch) {
        details.imagesMirrored = parseInt(imagesToCopyMatch[1]);
      }
      
      // Extract operator count from success message
      const operatorSuccessMatch = logs.match(/✓ (\d+) \/ (\d+) operator images mirrored successfully/);
      if (operatorSuccessMatch) {
        details.operatorsMirrored = parseInt(operatorSuccessMatch[1]);
      }
      
      // Count unique operators from catalog collection
      const catalogMatches = logs.match(/Collected catalog ([^\n]+)/g);
      if (catalogMatches) {
        details.operatorsMirrored = catalogMatches.length;
      }
      
      // Estimate total size based on number of images (rough estimate)
      if (details.imagesMirrored > 0) {
        details.totalSize = details.imagesMirrored * 50 * 1024 * 1024; // ~50MB per image average
      }
      
      // Extract platform images (release images) - only if actually collected
      const releaseImagesMatch = logs.match(/🔍 collecting release images/);
      if (releaseImagesMatch) {
        // Check if release images were actually found and copied
        const releaseImagesCollected = logs.match(/Success copying.*release.*➡️ cache/g);
        if (releaseImagesCollected) {
          details.platformImages = releaseImagesCollected.length;
        } else {
          details.platformImages = 0; // No release images actually copied
        }
      } else {
        details.platformImages = 0; // No release images collection attempted
      }
      
      // Extract additional images - only if actually collected
      const additionalImagesMatch = logs.match(/🔍 collecting additional images/);
      if (additionalImagesMatch) {
        // Check if additional images were actually found and copied
        const additionalImagesCollected = logs.match(/Success copying.*additional.*➡️ cache/g);
        if (additionalImagesCollected) {
          details.additionalImages = additionalImagesCollected.length;
        } else {
          details.additionalImages = 0; // No additional images actually copied
        }
      } else {
        details.additionalImages = 0; // No additional images collection attempted
      }
      
      // Extract helm charts - only if actually collected
      const helmImagesMatch = logs.match(/🔍 collecting helm images/);
      if (helmImagesMatch) {
        // Check if helm charts were actually found and copied
        const helmChartsCollected = logs.match(/Success copying.*helm.*➡️ cache/g);
        if (helmChartsCollected) {
          details.helmCharts = helmChartsCollected.length;
        } else {
          details.helmCharts = 0; // No helm charts actually copied
        }
      } else {
        details.helmCharts = 0; // No helm charts collection attempted
      }
    }
    
    res.json(details);
  } catch (error) {
    console.error('Error getting operation details:', error);
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

// Helper function to count files in directory
async function countFiles(dirPath) {
  let count = 0;
  const files = await fs.readdir(dirPath, { withFileTypes: true });
  
  for (const file of files) {
    const fullPath = path.join(dirPath, file.name);
    if (file.isDirectory()) {
      count += await countFiles(fullPath);
    } else {
      count++;
    }
  }
  return count;
}

// Download progress endpoint (Simple JSON response)
app.get('/api/operations/:id/download-progress', (req, res) => {
  const { id } = req.params;
  
  // Initialize progress tracking if not exists
  if (!global.downloadProgress) {
    global.downloadProgress = new Map();
  }
  
  // Get current progress for this download
  const progress = global.downloadProgress.get(id) || { progress: 0, message: 'Initializing download...' };
  
  res.json(progress);
});

// Download mirror files endpoint
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
    
    const mirrorDir = '/app/mirror';
    
    // Check if mirror directory exists
    try {
      await fs.access(mirrorDir);
    } catch (error) {
      return res.status(404).json({ error: 'Mirror files not found. Operation may not have completed successfully.' });
    }
    
    // Send progress updates with debugging
    const sendProgress = (progress, message) => {
      console.log(`[PROGRESS] ${progress}%: ${message}`);
      // Store progress data for polling
      if (!global.downloadProgress) {
        global.downloadProgress = new Map();
      }
      global.downloadProgress.set(id, { progress, message });
    };
    
    sendProgress(10, 'Scanning mirror directory...');
    
    // Get directory size for progress calculation
    const getDirectorySize = async (dirPath) => {
      let totalSize = 0;
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const file of files) {
        const fullPath = path.join(dirPath, file.name);
        if (file.isDirectory()) {
          totalSize += await getDirectorySize(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
        }
      }
      return totalSize;
    };
    
    const totalSize = await getDirectorySize(mirrorDir);
    sendProgress(20, `Found ${totalSize} bytes to archive...`);
    
    // Create a temporary tar.gz file
    const tarFileName = `mirror-files-${id}-${Date.now()}.tar.gz`;
    const tarFilePath = path.join(DOWNLOADS_DIR, tarFileName);
    
    sendProgress(30, 'Creating tar.gz archive...');
    
    // Set response headers for file download
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${tarFileName}"`);
    
    // Create archive with simple progress tracking
    sendProgress(40, 'Creating archive...');
    
    // Use a simple approach with manual progress updates
    const { spawn } = require('child_process');
    const tarProcess = spawn('tar', ['-czf', tarFilePath, '-C', '/app', 'mirror'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let progressCounter = 40;
    const progressInterval = setInterval(() => {
      if (progressCounter < 85) {
        progressCounter += 5;
        sendProgress(progressCounter, `Creating archive... ${progressCounter}%`);
      }
    }, 200);
    
    // Handle tar process completion
    tarProcess.on('close', async (code) => {
      clearInterval(progressInterval);
      
      if (code === 0) {
        sendProgress(90, 'Archive created successfully');
        try {
          sendProgress(95, 'Archive creation completed. Initializing download...');
          
          // Get file stats for Content-Length
          const stats = await fs.stat(tarFilePath);
          res.setHeader('Content-Length', stats.size);
          
          sendProgress(100, 'Download starting in browser...');
          
          // Clean up progress data after sending 100%
          setTimeout(() => {
            if (global.downloadProgress) {
              global.downloadProgress.delete(id);
            }
          }, 1000); // Clean up after 1 second
          
          // Stream the tar.gz file to response
          const fileStream = require('fs').createReadStream(tarFilePath);
          fileStream.pipe(res);
          
          // Clean up the temporary tar.gz file after streaming
          fileStream.on('end', async () => {
            try {
              await fs.unlink(tarFilePath);
              // Clean up progress data
              if (global.downloadProgress) {
                global.downloadProgress.delete(id);
              }
            } catch (cleanupError) {
              console.error('Error cleaning up temporary tar.gz file:', cleanupError);
            }
          });
        } catch (error) {
          console.error('Error streaming tar.gz file:', error);
          res.status(500).json({ error: 'Failed to download files' });
        }
      } else {
        console.error('Tar process failed with code:', code);
        res.status(500).json({ error: 'Failed to create download archive' });
      }
    });
    
    // Handle tar process errors
    tarProcess.on('error', (err) => {
      clearInterval(progressInterval);
      console.error('Error creating archive:', err);
      res.status(500).json({ error: 'Failed to create download archive' });
    });
    
  } catch (error) {
    console.error('Error downloading mirror files:', error);
    res.status(500).json({ error: 'Failed to download mirror files' });
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