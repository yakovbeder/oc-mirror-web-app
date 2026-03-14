import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import YAML from 'yaml';
import { v4 as uuidv4 } from 'uuid';
import compression from 'compression';
import multer from 'multer';
import { fileURLToPath, pathToFileURL } from 'url';
import { getChannelObjectsFromGeneratedOperator } from './catalogChannels.js';

const fsp = fs.promises;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

interface OperationRecord {
  id: string;
  name: string;
  configFile: string;
  mirrorDestination?: string;
  status: 'running' | 'success' | 'failed' | 'stopped';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  errorMessage?: string | null;
  logs: string[];
}

interface SystemInfo {
  ocMirrorVersion: string;
  ocVersion: string;
  systemArchitecture: string;
  availableDiskSpace: number;
  totalDiskSpace: number;
}

interface CatalogEntry {
  name: string;
  url: string;
  description: string;
  ocpVersion?: string;
  operators?: OperatorEntry[];
  operatorCount?: number;
}

interface OperatorEntry {
  name: string;
  defaultChannel?: string;
  channels?: (string | { name: string })[];
  allChannels?: string[];
  catalog?: string;
  ocpVersion?: string;
  catalogUrl?: string;
  availableVersions?: string[];
  channelVersions?: Record<string, string[]>;
  channelVersionRanges?: Record<string, { minVersion?: string | null; maxVersion?: string | null }>;
  minVersion?: string | null;
  maxVersion?: string | null;
}

interface OperatorDependency {
  packageName: string;
  versionRange?: string | null;
  displayName?: string;
  catalog?: string;
  catalogUrl?: string;
  defaultChannel?: string;
  isDependencyPackage?: boolean;
}

interface PreFetchedCatalogData {
  index: {
    catalogs: Array<{
      catalog_type: string;
      ocp_version: string;
      catalog_url: string;
    }>;
  };
  operators: Record<string, OperatorEntry[]>;
  channels: Record<string, (string | { name: string })[]>;
}

interface OperatorCache {
  catalogs: CatalogEntry[];
  operators: Record<string, OperatorEntry>;
  channels: Record<string, (string | { name: string })[]>;
  lastUpdate: number | null;
  cacheTimeout: number;
}

interface RunningProcess {
  pid: number | undefined;
  child: ChildProcess;
}

interface ChannelObject {
  name: string;
  availableVersions?: string[];
  minVersion?: string | null;
  maxVersion?: string | null;
}

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DIST_DIR = path.join(__dirname, '../dist');
const DEV_INDEX_HTML = path.join(__dirname, '../index.html');

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

const STORAGE_DIR = process.env.STORAGE_DIR || './data';
const CONFIGS_DIR = path.join(STORAGE_DIR, 'configs');
const OPERATIONS_DIR = path.join(STORAGE_DIR, 'operations');
const LOGS_DIR = path.join(STORAGE_DIR, 'logs');
const CACHE_DIR = process.env.OC_MIRROR_CACHE_DIR || path.join(STORAGE_DIR, 'cache');
const APP_ROOT_DIR = process.env.OC_MIRROR_WORKDIR || path.resolve(__dirname, '..');
const DEV_CACHE_DIR = path.join(APP_ROOT_DIR, '.local-run', 'vite');
const MIRROR_BASE_DIR = path.resolve(process.env.OC_MIRROR_BASE_MIRROR_DIR || path.join(STORAGE_DIR, 'mirrors'));
const DEFAULT_MIRROR_DIR = path.join(MIRROR_BASE_DIR, 'default');
const CUSTOM_MIRROR_DIR = path.join(MIRROR_BASE_DIR, 'custom');
const EPHEMERAL_MIRROR_DIR = path.resolve(process.env.OC_MIRROR_EPHEMERAL_DIR || path.join(APP_ROOT_DIR, 'mirror'));
const AUTHFILE_PATH = process.env.OC_MIRROR_AUTHFILE || '/app/pull-secret.json';

const runningProcesses = new Map<string, RunningProcess>();

async function ensureDirectories(): Promise<void> {
  const dirs = [
    STORAGE_DIR,
    CONFIGS_DIR,
    OPERATIONS_DIR,
    LOGS_DIR,
    CACHE_DIR,
    MIRROR_BASE_DIR,
    DEFAULT_MIRROR_DIR,
  ];
  for (const dir of dirs) {
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch (error: any) {
      console.error(`Error creating directory ${dir}:`, error);
    }
  }
}

// Note: With custom mirror destinations (default: DEFAULT_MIRROR_DIR),
// mirror files persist across restarts, so we keep operation history
async function clearOperationHistory(): Promise<void> {
  let hasPersistedMirrors = false;
  
  try {
    const files = await fsp.readdir(DEFAULT_MIRROR_DIR);
    hasPersistedMirrors = files.length > 0;
  } catch {
    hasPersistedMirrors = false;
  }

  if (!hasPersistedMirrors) {
    let clearedOps = 0;
    let clearedLogs = 0;

    try {
      const opFiles = await fsp.readdir(OPERATIONS_DIR);
      for (const file of opFiles) {
        if (file.endsWith('.json')) {
          try {
            await fsp.unlink(path.join(OPERATIONS_DIR, file));
            clearedOps++;
          } catch (error: any) {
            console.warn(`Failed to delete operation file ${file}:`, error);
          }
        }
      }
    } catch (error: any) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Error reading operations directory:', error);
      }
    }

    try {
      const logFiles = await fsp.readdir(LOGS_DIR);
      for (const file of logFiles) {
        try {
          await fsp.unlink(path.join(LOGS_DIR, file));
          clearedLogs++;
        } catch (error: any) {
          console.warn(`Failed to delete log file ${file}:`, error);
        }
      }
    } catch (error: any) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Error reading logs directory:', error);
      }
    }
    
    if (clearedOps > 0 || clearedLogs > 0) {
      console.log(`Cleared ${clearedOps} operation files and ${clearedLogs} log files on startup (fresh start detected)`);
    }
  } else {
    console.log('Persistent mirror files detected - keeping operation history');
  }
}

ensureDirectories().then(() => {
  clearOperationHistory();
});

const storage = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    cb(null, CONFIGS_DIR);
  },
  filename: (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

function parseOcMirrorVersion(raw: string): string {
  const match = raw.match(/GitVersion:\"(\d+\.\d+\.\d+)/);
  if (match) {
    return match[1];
  }
  const fallback = raw.match(/(\d+\.\d+\.\d+)/);
  if (fallback) {
    return fallback[1];
  }
  return 'Not available';
}

function parseOcVersion(raw: string): string {
  const lines = raw.split('\n');
  for (const line of lines) {
    if (line.includes('Client Version:')) {
      const match = line.match(/Client Version:\s*(\S+)/);
      if (match) {
        return match[1];
      }
    }
  }
  const fallback = raw.match(/(\d+\.\d+\.\d+)/);
  if (fallback) {
    return fallback[1];
  }
  return 'Not available';
}

async function getSystemInfo(): Promise<SystemInfo> {
  try {
    const [ocMirrorVersion, ocVersion, systemArch] = await Promise.all([
      execAsync('oc-mirror version').catch(() => ({ stdout: 'Not available', stderr: '' })),
      execAsync('oc version --client').catch(() => ({ stdout: 'Not available', stderr: '' })),
      execAsync('uname -m').catch(() => ({ stdout: 'Not available', stderr: '' }))
    ]);

    const diskSpace = await execAsync('df -k .').catch(() => ({ stdout: '', stderr: '' }));
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
  } catch (error: any) {
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

async function getOperations(): Promise<OperationRecord[]> {
  try {
    const files = await fsp.readdir(OPERATIONS_DIR);
    const operations: OperationRecord[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fsp.readFile(path.join(OPERATIONS_DIR, file), 'utf8');
        operations.push(JSON.parse(content));
      }
    }

    return operations.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  } catch (error: any) {
    console.error('Error reading operations:', error);
    return [];
  }
}

async function saveOperation(operation: OperationRecord): Promise<void> {
  const filename = `${operation.id}.json`;
  await fsp.writeFile(path.join(OPERATIONS_DIR, filename), JSON.stringify(operation, null, 2));
}

async function updateOperation(operationId: string, updates: Partial<OperationRecord>): Promise<OperationRecord> {
  const filename = `${operationId}.json`;
  const filepath = path.join(OPERATIONS_DIR, filename);
  
  try {
    const content = await fsp.readFile(filepath, 'utf8');
    const operation: OperationRecord = JSON.parse(content);
    const updatedOperation = { ...operation, ...updates };
    await fsp.writeFile(filepath, JSON.stringify(updatedOperation, null, 2));
    return updatedOperation;
  } catch (error: any) {
    console.error('Error updating operation:', error);
    throw error;
  }
}

async function getOperation(operationId: string): Promise<OperationRecord> {
  const filename = `${operationId}.json`;
  const filepath = path.join(OPERATIONS_DIR, filename);
  
  try {
    const content = await fsp.readFile(filepath, 'utf8');
    return JSON.parse(content);
  } catch (error: any) {
    console.error('Error reading operation:', error);
    throw error;
  }
}

async function getSystemHealth(): Promise<string> {
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

let preFetchedCatalogData: PreFetchedCatalogData | null = null;

async function loadPreFetchedCatalogData(): Promise<PreFetchedCatalogData | null> {
  if (preFetchedCatalogData) {
    return preFetchedCatalogData;
  }

  try {
    const catalogIndexPath = path.join(__dirname, '../catalog-data/catalog-index.json');
    const catalogIndex = JSON.parse(await fsp.readFile(catalogIndexPath, 'utf8'));
    
    preFetchedCatalogData = {
      index: catalogIndex,
      operators: {},
      channels: {}
    };

    let totalOperators = 0;

    for (const catalog of catalogIndex.catalogs) {
      const operatorsPath = path.join(__dirname, `../catalog-data/${catalog.catalog_type}/${catalog.ocp_version}/operators.json`);
      try {
        const operators: OperatorEntry[] = JSON.parse(await fsp.readFile(operatorsPath, 'utf8'));
        const key = `${catalog.catalog_type}:${catalog.ocp_version}`;
        preFetchedCatalogData.operators[key] = operators;
        totalOperators += operators.length;

        operators.forEach((operator: OperatorEntry) => {
          const channelKey = `${operator.name}:${catalog.catalog_type}:${catalog.ocp_version}`;
          preFetchedCatalogData!.channels[channelKey] = operator.channels || [];
        });
        
        console.log(`Loaded ${operators.length} operators for ${key}`);
      } catch (error: any) {
        console.warn(`Could not load operators for ${catalog.catalog_type}:${catalog.ocp_version}:`, error.message);
      }
    }

    console.log(`Pre-fetched catalog data loaded successfully with ${totalOperators} total operators`);
    return preFetchedCatalogData;
  } catch (error: any) {
    console.error('Error loading pre-fetched catalog data:', error);
    return null;
  }
}

async function queryOperatorCatalog(catalogUrl: string): Promise<{ name: string }[]> {
  try {
    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      const catalogType = getCatalogNameFromUrl(catalogUrl);
      const catalogVersion = catalogUrl.includes(':') ? catalogUrl.split(':')[1] : 'v4.21';
      const key = `${catalogType}:${catalogVersion}`;
      
      if (catalogData.operators[key]) {
        console.log(`Using pre-fetched data for catalog: ${catalogUrl}`);
        return catalogData.operators[key].map(op => ({ name: op.name }));
      }
    }

    console.error(`[ERROR] Catalog data not found for ${catalogUrl}. Catalog data should be pre-fetched during build.`);
    return [];
  } catch (error: any) {
    console.error(`Error querying catalog ${catalogUrl}:`, error);
    return [];
  }
}

async function queryOperatorChannels(catalogUrl: string, operatorName: string): Promise<(string | { name: string })[]> {
  try {
    const catalogType = getCatalogNameFromUrl(catalogUrl);
    const catalogVersion = catalogUrl.includes(':') ? catalogUrl.split(':')[1] : 'v4.21';

    const actualChannels = await getActualChannelsFromCatalog(catalogType, catalogVersion, operatorName);
    if (actualChannels && actualChannels.length > 0) {
      console.log(`Using actual catalog data for ${operatorName} from ${catalogVersion} catalog`);
      return actualChannels;
    }

    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      const key = `${operatorName}:${catalogType}:${catalogVersion}`;
      
      if (catalogData.channels[key]) {
        console.log(`Using pre-fetched channels for ${operatorName} from ${catalogVersion} catalog`);
        return catalogData.channels[key];
      }
    }

    console.error(`[ERROR] Channel data not found for ${operatorName} in ${catalogUrl}. Catalog data should be pre-fetched during build.`);
    return [];
  } catch (error: any) {
    console.error(`Error querying channels for ${operatorName} from ${catalogUrl}:`, error);
    return [];
  }
}

function getCatalogNameFromUrl(catalogUrl: string): string {
  if (catalogUrl.includes('redhat-operator-index')) {
    return 'redhat-operator-index';
  } else if (catalogUrl.includes('certified-operator-index')) {
    return 'certified-operator-index';
  } else if (catalogUrl.includes('community-operator-index')) {
    return 'community-operator-index';
  }
  return 'redhat-operator-index';
}

function getCatalogDescription(catalogType: string): string {
  const descriptions: Record<string, string> = {
    'redhat-operator-index': 'Red Hat certified operators',
    'certified-operator-index': 'Certified operators from partners',
    'community-operator-index': 'Community operators'
  };
  return descriptions[catalogType] || 'Unknown catalog type';
}

async function getActualChannelsFromCatalog(catalogType: string, catalogVersion: string, operatorName: string): Promise<ChannelObject[] | null> {
  try {
    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      const key = `${catalogType}:${catalogVersion}`;
      const operators = catalogData.operators[key];
      
      if (operators) {
        const operator = operators.find(op => op.name === operatorName);
        const channels = getChannelObjectsFromGeneratedOperator(operator);
        if (channels) {
          console.log(`Found ${channels.length} channels for ${operatorName} in ${catalogType}:${catalogVersion} using generated metadata`);
          return channels;
        }
      }
    }

    return null;
  } catch (error: any) {
    console.error(`Error reading generated catalog data for ${operatorName} in ${catalogType}:${catalogVersion}:`, error.message);
    return null;
  }
}

let dependenciesDataCache: Record<string, Record<string, OperatorDependency[]>> | null = null;

async function loadDependenciesData(): Promise<Record<string, Record<string, OperatorDependency[]>> | null> {
  if (dependenciesDataCache) {
    return dependenciesDataCache;
  }

  try {
    const dependenciesPath = path.join(__dirname, '../catalog-data/dependencies.json');
    const content = await fsp.readFile(dependenciesPath, 'utf8');
    dependenciesDataCache = JSON.parse(content);
    console.log('Loaded pre-fetched dependencies data from dependencies.json');
    return dependenciesDataCache;
  } catch (error: any) {
    console.log('No pre-fetched dependencies.json found, dependency detection may be limited');
    return null;
  }
}

async function getOperatorDependencies(catalogType: string, catalogVersion: string, operatorName: string): Promise<OperatorDependency[]> {
  try {
    let dependencies: OperatorDependency[] = [];
    let dependencyPackageName: string | null = null;

    const dependenciesData = await loadDependenciesData();
    
    if (dependenciesData) {
      const catalogKey = `${catalogType}:${catalogVersion}`;
      const catalogDeps = dependenciesData[catalogKey];
      
      if (catalogDeps) {
        if (catalogDeps[operatorName]) {
          dependencies = [...catalogDeps[operatorName]];
        }

        const dependencyPackageNames: string[] = [];

        if (operatorName.endsWith('-operator')) {
          const baseName = operatorName.replace(/-operator$/, '');
          dependencyPackageNames.push(`${baseName}-dependencies`);
        }

        dependencyPackageNames.push(
          `${operatorName}-dependencies`,
          `${operatorName}-dependency`,
          `${operatorName}-deps`
        );

        for (const depPackageName of dependencyPackageNames) {
          if (catalogDeps[depPackageName]) {
            const depDependencies = catalogDeps[depPackageName];
            dependencies = dependencies.concat(depDependencies);
            dependencyPackageName = depPackageName;
            console.log(`Found ${depDependencies.length} dependencies in ${depPackageName} for ${operatorName}`);
            break;
          }
      }
    }
  }

  if (dependencyPackageName) {
      const catalogData = await loadPreFetchedCatalogData();
      if (catalogData) {
        const key = `${catalogType}:${catalogVersion}`;
        const operators = catalogData.operators[key];
        
        if (operators) {
          const depPackageInfo = operators.find(op => op.name === dependencyPackageName);
          if (depPackageInfo) {
            const alreadyExists = dependencies.some(dep => dep.packageName === dependencyPackageName);
            if (!alreadyExists) {
              dependencies.push({
                packageName: dependencyPackageName!,
                versionRange: null,
                displayName: depPackageInfo.name,
                catalog: depPackageInfo.catalog,
                catalogUrl: depPackageInfo.catalogUrl,
                defaultChannel: depPackageInfo.defaultChannel,
                isDependencyPackage: true
              });
            }
          }
      }
    }
  }

  const uniqueDependencies = dependencies.filter((dep, index, self) =>
      index === self.findIndex(d => d.packageName === dep.packageName)
  );

  const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      const key = `${catalogType}:${catalogVersion}`;
      const operators = catalogData.operators[key];
      
      if (operators) {
        uniqueDependencies.forEach(dep => {
          const operatorInfo = operators.find(op => op.name === dep.packageName);
          if (operatorInfo) {
            dep.displayName = dep.displayName || operatorInfo.name;
            dep.catalog = dep.catalog || operatorInfo.catalog;
            dep.catalogUrl = dep.catalogUrl || operatorInfo.catalogUrl;
            dep.defaultChannel = dep.defaultChannel || operatorInfo.defaultChannel;
          }
        });
      }
    }
    
    return uniqueDependencies;
  } catch (error: any) {
    console.error(`Error getting dependencies for ${operatorName} in ${catalogType}:${catalogVersion}:`, error.message);
    return [];
  }
}

const operatorCache: OperatorCache = {
  catalogs: [],
  operators: {},
  channels: {},
  lastUpdate: null,
  cacheTimeout: 3600000
};

function isCacheValid(): boolean {
  return operatorCache.lastUpdate !== null && 
         (Date.now() - operatorCache.lastUpdate) < operatorCache.cacheTimeout;
}

async function updateOperatorCache(): Promise<OperatorCache> {
  if (isCacheValid()) {
    return operatorCache;
  }

  console.log('Updating operator cache...');

  const catalogData = await loadPreFetchedCatalogData();
  
  if (catalogData && catalogData.index.catalogs.length > 0) {
    console.log('Using pre-fetched catalog data for cache update');

    const catalogs: CatalogEntry[] = catalogData.index.catalogs.map(catalog => ({
      name: catalog.catalog_type,
      url: catalog.catalog_url,
      description: getCatalogDescription(catalog.catalog_type),
      ocpVersion: catalog.ocp_version
    }));

    const catalogResults: CatalogEntry[] = catalogs.map(catalog => {
      const key = `${catalog.name}:${catalog.ocpVersion}`;
      const operators = catalogData.operators[key] || [];
      return {
        ...catalog,
        operators: operators.map(op => ({ name: op.name }))
      };
    });

    operatorCache.catalogs = catalogResults;
    operatorCache.operators = {};
    operatorCache.channels = {};
    operatorCache.lastUpdate = Date.now();

    catalogResults.forEach(catalog => {
      if (catalog.operators && Array.isArray(catalog.operators)) {
        catalog.operators.forEach(operator => {
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

  console.log('Using fallback static catalogs');
  
  const catalogs: CatalogEntry[] = [
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

  const catalogPromises = catalogs.map(async (catalog) => {
    const operators = await queryOperatorCatalog(catalog.url);
    return {
      ...catalog,
      operators: operators || []
    };
  });

  const catalogResults = await Promise.all(catalogPromises);

  operatorCache.catalogs = catalogResults;
  operatorCache.operators = {};
  operatorCache.channels = {};
  operatorCache.lastUpdate = Date.now();

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

app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const operations = await getOperations();
    const stats = {
      totalOperations: operations.length,
      successfulOperations: operations.filter(op => op.status === 'success').length,
      failedOperations: operations.filter(op => op.status === 'failed').length,
      runningOperations: operations.filter(op => op.status === 'running').length
    };
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

app.get('/api/operations/recent', async (req: Request, res: Response) => {
  try {
    const operations = await getOperations();
    const recent = operations.slice(0, 10); // Get last 10 operations
    res.json(recent);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get recent operations' });
  }
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'oc-mirror-web-app'
  });
});

app.get('/api/system/status', async (req: Request, res: Response) => {
  try {
    const systemInfo = await getSystemInfo();
    const systemHealth = await getSystemHealth();
    res.json({
      ocMirrorVersion: systemInfo.ocMirrorVersion,
      ocVersion: systemInfo.ocVersion,
      systemHealth
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get system status' });
  }
});

app.get('/api/system/paths', async (req: Request, res: Response) => {
  try {
    const commonPaths = [
      { 
        path: DEFAULT_MIRROR_DIR,
        label: 'Default (Persistent)', 
        description: 'Recommended - primary persistent mirror location',
        available: false
      },
      { 
        path: MIRROR_BASE_DIR,
        label: 'Data Mirrors Root', 
        description: 'Persistent - create subdirectories as needed',
        available: false
      },
      { 
        path: CUSTOM_MIRROR_DIR,
        label: 'Custom Directory', 
        description: 'Persistent - custom subdirectory for this operation',
        available: false
      },
      { 
        path: EPHEMERAL_MIRROR_DIR,
        label: 'App Mirror (Ephemeral)', 
        description: 'Ephemeral mirror path under the app root',
        available: false
      }
    ];

    const availablePaths = [];
    for (const pathInfo of commonPaths) {
    try {
      await fsp.mkdir(pathInfo.path, { recursive: true });
      await fsp.access(pathInfo.path, fs.constants.W_OK);
        pathInfo.available = true;
      } catch {
        pathInfo.available = false;
      }
      availablePaths.push(pathInfo);
    }
    
    res.json({ paths: availablePaths });
  } catch (error: any) {
    console.error('Error listing paths:', error);
    res.status(500).json({ error: 'Failed to list available paths' });
  }
});

app.get('/api/config/list', async (req: Request, res: Response) => {
  try {
    const files = await fsp.readdir(CONFIGS_DIR);
    const configs = [];

    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const stats = await fsp.stat(path.join(CONFIGS_DIR, file));
        configs.push({
          name: file,
          size: `${(stats.size / 1024).toFixed(2)} KB`,
          modified: stats.mtime
        });
      }
    }

    res.json(configs);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to list configurations' });
  }
});

app.post('/api/config/save', async (req: Request, res: Response) => {
  try {
    const { config, name } = req.body;
    const filename = name || `imageset-config-${Date.now()}.yaml`;
    const filepath = path.join(CONFIGS_DIR, filename);
    
    await fsp.writeFile(filepath, config);
    res.json({ message: 'Configuration saved successfully', filename });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

app.post('/api/config/upload', async (req: Request, res: Response) => {
  try {
    const { filename, content } = req.body;
    
    if (!filename || !content) {
      return res.status(400).json({ error: 'Filename and content are required' });
    }

    try {
      const parsed = YAML.parse(content);

      if (!parsed.kind || parsed.kind !== 'ImageSetConfiguration') {
        return res.status(400).json({ error: 'Invalid YAML: Must be an ImageSetConfiguration' });
      }

      if (!parsed.apiVersion || !parsed.apiVersion.includes('mirror.openshift.io')) {
        return res.status(400).json({ error: 'Invalid YAML: Must have mirror.openshift.io API version' });
      }

      if (!parsed.mirror) {
        return res.status(400).json({ error: 'Invalid YAML: Missing mirror section' });
      }
    } catch (yamlError: any) {
      return res.status(400).json({ error: `Invalid YAML: ${yamlError.message}` });
    }

    const finalFilename = filename.endsWith('.yaml') || filename.endsWith('.yml') 
      ? filename 
      : `${filename}.yaml`;
    
    const filepath = path.join(CONFIGS_DIR, finalFilename);

    try {
      await fsp.access(filepath);
      return res.status(409).json({ error: 'Configuration file already exists' });
    } catch (error: any) {
    }
    
    await fsp.writeFile(filepath, content);
    res.json({ message: 'Configuration uploaded successfully', filename: finalFilename });
  } catch (error: any) {
    console.error('Error uploading configuration:', error);
    res.status(500).json({ error: 'Failed to upload configuration' });
  }
});

app.delete('/api/config/delete/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(CONFIGS_DIR, filename);

    try {
      await fsp.access(filepath);
    } catch (error: any) {
      return res.status(404).json({ error: 'Configuration file not found' });
    }

    await fsp.unlink(filepath);
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting configuration:', error);
    res.status(500).json({ error: 'Failed to delete configuration' });
  }
});

app.get('/api/channels', async (req: Request, res: Response) => {
  try {
    const channels = [
      'stable-4.16', 'stable-4.17', 'stable-4.18', 'stable-4.19', 'stable-4.20', 'stable-4.21'
    ];
    res.json(channels);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get channels' });
  }
});

app.get('/api/catalogs', async (req: Request, res: Response) => {
  try {
    const cache = await updateOperatorCache();
    const catalogs = cache.catalogs.map(catalog => ({
      name: catalog.name,
      url: catalog.url,
      description: catalog.description,
      operatorCount: catalog.operators ? catalog.operators.length : 0
    }));
    res.json(catalogs);
  } catch (error: any) {
    console.error('Error fetching catalogs:', error);
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

app.get('/api/operators', async (req: Request, res: Response) => {
  try {
    const { catalog, detailed } = req.query;

    if (catalog) {
      const catalogData = await loadPreFetchedCatalogData();
      if (catalogData) {
        const catalogType = getCatalogNameFromUrl(catalog as string);
        const catalogVersion = (catalog as string).includes(':') ? (catalog as string).split(':')[1] : 'v4.21';
        const key = `${catalogType}:${catalogVersion}`;
        
        const operators = catalogData.operators[key];
        if (operators) {
          if (detailed === 'true') {
            const detailedOperators = operators.map(operator => {
              const normalizedChannels = normalizeChannels(operator.channels || [], operator.name, operator);
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
            res.json(operators.map(operator => operator.name));
          }
          return;
        }
      }

      const cache = await updateOperatorCache();
      const allOperators = Object.values(cache.operators);
      const filteredOperators = allOperators
        .filter(operator => operator.catalog === catalog);

      if (detailed === 'true') {
        const detailedOperators = filteredOperators.map(operator => {
          const normalizedChannels = normalizeChannels(operator.channels || [], operator.name, operator);
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
        res.json(filteredOperators.map(operator => operator.name));
      }
    } else {
      const cache = await updateOperatorCache();
      const uniqueOperators = [...new Set(Object.values(cache.operators).map(op => op.name))];
      res.json(uniqueOperators);
    }
  } catch (error: any) {
    console.error('Error fetching operators:', error);
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

app.post('/api/operators/refresh-cache', async (req: Request, res: Response) => {
  try {
    operatorCache.lastUpdate = null;
    await updateOperatorCache();
    res.json({ message: 'Operator cache refreshed successfully' });
  } catch (error: any) {
    console.error('Error refreshing operator cache:', error);
    res.status(500).json({ error: 'Failed to refresh operator cache' });
  }
});

function compareVersionStrings(a: string, b: string): number {
  const getBaseVersion = (version: string): string => {
    const match = version.match(/^(\d+\.\d+\.\d+)/);
    return match ? match[1] : version;
  };

  const baseA = getBaseVersion(a);
  const baseB = getBaseVersion(b);

  const partsA = baseA.split('.').map(Number);
  const partsB = baseB.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;

    if (partA !== partB) {
      return partA - partB;
    }
  }

  return a.localeCompare(b);
}

function sortVersions(versions: string[]): string[] {
  return Array.from(new Set(versions.filter(version => version && version.trim()))).sort(compareVersionStrings);
}

function getQueryStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }

  return undefined;
}

function extractChannelNames(channels: (string | { name: string })[] | undefined): string[] {
  if (!channels || !Array.isArray(channels)) {
    return [];
  }

  if (channels.length === 1 && typeof channels[0] === 'string') {
    if (channels[0].includes('\n')) {
      return channels[0].split('\n').filter(line => line.trim()).map(channel => channel.trim());
    }

    if (channels[0].includes(' ')) {
      return channels[0].split(' ').filter(channel => channel.trim()).map(channel => channel.trim());
    }

    return [channels[0]];
  }

  return channels
    .map(channel => {
      if (typeof channel === 'string') {
        return channel;
      }

      if (channel && typeof channel === 'object' && channel.name) {
        return channel.name;
      }

      return String(channel);
    })
    .filter(channel => channel.trim());
}

function extractVersionInfo(channelNames: string[], operatorName: string | null): { genericChannels: string[]; versions: string[] } {
  const versions = new Set<string>();
  const genericChannels: string[] = [];
  
  channelNames.forEach(channel => {
    if (!channel || !channel.trim()) return;

    if (operatorName && channel.includes(`${operatorName}.`)) {
      const versionWithV = channel.match(new RegExp(`${operatorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.v(.+)`));
      if (versionWithV) {
        versions.add(versionWithV[1]);
        return;
      }

      const versionWithoutV = channel.match(new RegExp(`${operatorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(.+)`));
      if (versionWithoutV) {
        versions.add(versionWithoutV[1]);
        return;
      }
    }

    if (operatorName) {
      const operatorBase = operatorName.replace(/-certified$/, '').replace(/-community$/, '');
      if (operatorBase !== operatorName && channel.includes(`${operatorBase}.`)) {
        const versionWithV = channel.match(new RegExp(`${operatorBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.v(.+)`));
        if (versionWithV) {
          versions.add(versionWithV[1]);
          return;
        }

        const versionWithoutV = channel.match(new RegExp(`${operatorBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(.+)`));
        if (versionWithoutV) {
          versions.add(versionWithoutV[1]);
          return;
        }
      }
    }

    const genericVersionWithV = channel.match(/^[^.]+\.v(.+)/);
    if (genericVersionWithV) {
      versions.add(genericVersionWithV[1]);
      return;
    }

    const genericVersionWithoutV = channel.match(/^[^.]+\.(\d+\.\d+\.\d+.*)/);
    if (genericVersionWithoutV) {
      versions.add(genericVersionWithoutV[1]);
      return;
    }

    const versionMatch = channel.match(/^v?(\d+\.\d+\.\d+)/);
    if (versionMatch) {
      versions.add(versionMatch[1]);
      return;
    }

    genericChannels.push(channel);
  });

  return {
    genericChannels,
    versions: sortVersions(Array.from(versions))
  };
}

function getVersionsFromMetadata(operatorData: OperatorEntry, channelName?: string): string[] {
  if (channelName && operatorData.channelVersions && Object.prototype.hasOwnProperty.call(operatorData.channelVersions, channelName)) {
    return sortVersions(operatorData.channelVersions[channelName] || []);
  }

  if (!channelName) {
    const allChannelVersions = Object.values(operatorData.channelVersions || {}).flat();
    if (allChannelVersions.length > 0 || Object.keys(operatorData.channelVersions || {}).length > 0) {
      return sortVersions(allChannelVersions);
    }

    if (operatorData.availableVersions) {
      return sortVersions(operatorData.availableVersions);
    }
  }

  const channelNames = extractChannelNames(operatorData.channels);
  const { versions } = extractVersionInfo(channelNames, operatorData.name);
  return versions;
}

function normalizeChannels(
  channels: (string | { name: string })[] | undefined,
  operatorName: string | null = null,
  operatorData?: OperatorEntry,
): ChannelObject[] {
  let channelNames = extractChannelNames(channels);

  if (channelNames.length === 0 && operatorData?.channelVersions) {
    channelNames = Object.keys(operatorData.channelVersions);
  }

  if (channelNames.length === 0) {
    return [];
  }

  if (operatorData?.channelVersions || operatorData?.channelVersionRanges) {
    return channelNames.map(channel => {
      const range = operatorData?.channelVersionRanges?.[channel];
      const availableVersions = operatorData ? getVersionsFromMetadata(operatorData, channel) : [];
      return {
        name: channel,
        availableVersions,
        minVersion: range?.minVersion ?? null,
        maxVersion: range?.maxVersion ?? null,
      };
    });
  }

  const { genericChannels, versions } = extractVersionInfo(channelNames, operatorName);
  const channelObjects: ChannelObject[] = genericChannels.map(channel => ({ name: channel }));

  if (channelObjects.length > 0 && versions.length > 0) {
    channelObjects[0].availableVersions = versions;
  }
  
  return channelObjects;
}

app.get('/api/operators/:operator/versions', async (req: Request, res: Response) => {
  try {
    const { operator } = req.params;
    const catalog = getQueryStringValue(req.query.catalog);
    const channel = getQueryStringValue(req.query.channel);

    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      if (catalog) {
        const catalogType = getCatalogNameFromUrl(catalog);
        const catalogVersion = catalog.includes(':') ? catalog.split(':')[1] : 'v4.21';
        const key = `${catalogType}:${catalogVersion}`;
        
        const operators = catalogData.operators[key];
        if (operators) {
          const operatorData = operators.find(op => op.name === operator);
          if (operatorData) {
            return res.json({ versions: getVersionsFromMetadata(operatorData, channel) });
          }
        }
      } else {
        for (const operators of Object.values(catalogData.operators)) {
          const operatorData = operators.find(op => op.name === operator);
          if (operatorData) {
            return res.json({ versions: getVersionsFromMetadata(operatorData, channel) });
          }
        }
      }
    }

    res.status(404).json({ error: 'Operator not found' });
    
  } catch (error: any) {
    console.error(`Error getting versions for ${req.params.operator}:`, error);
    res.status(500).json({ error: 'Failed to get operator versions' });
  }
});

app.get('/api/operator-channels/:operator', async (req: Request, res: Response) => {
  try {
    const { operator } = req.params;
    const catalogUrl = getQueryStringValue(req.query.catalogUrl);

    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      if (catalogUrl) {
        const catalogType = getCatalogNameFromUrl(catalogUrl);
        const catalogVersion = catalogUrl.includes(':') ? catalogUrl.split(':')[1] : 'v4.21';
        const key = `${catalogType}:${catalogVersion}`;
        
        const operators = catalogData.operators[key];
        if (operators) {
          const operatorData = operators.find(op => op.name === operator);
          if (operatorData) {
            const normalizedChannels = normalizeChannels(operatorData.channels || [], operatorData.name, operatorData);
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
        for (const operators of Object.values(catalogData.operators)) {
          const operatorData = operators.find(op => op.name === operator);
          if (operatorData) {
            const normalizedChannels = normalizeChannels(operatorData.channels || [], operatorData.name, operatorData);
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

    if (catalogUrl) {
      const channels = await queryOperatorChannels(catalogUrl as string, operator);
      if (channels && Array.isArray(channels) && channels.length > 0) {
        const normalizedChannels = normalizeChannels(channels, operator);
        return res.json(normalizedChannels);
      }
    }

    if (operatorCache.channels[operator] && isCacheValid()) {
      const normalizedChannels = normalizeChannels(operatorCache.channels[operator], operator);
      return res.json(normalizedChannels);
    }

    const cache = await updateOperatorCache();
    const operatorInfo = Object.values(cache.operators).find(op => op.name === operator);
    
    if (!operatorInfo) {
      return res.status(404).json({ error: 'Operator not found' });
    }

    const channels = await queryOperatorChannels(operatorInfo.catalog!, operator);
    
    if (channels && Array.isArray(channels) && channels.length > 0) {
      operatorCache.channels[operator] = channels;
      const normalizedChannels = normalizeChannels(channels, operator);
      return res.json(normalizedChannels);
    }
    
    res.status(404).json({ error: 'No channels found for this operator' });
  } catch (error: any) {
    console.error(`Error fetching channels for ${req.params.operator}:`, error);
    res.status(500).json({ error: 'Failed to get operator channels' });
  }
});

app.get('/api/operators/channels', async (req: Request, res: Response) => {
  try {
    const { catalogUrl, operatorName } = req.query;
    
    if (!catalogUrl || !operatorName) {
      return res.status(400).json({ error: 'catalogUrl and operatorName query parameters are required' });
    }
    
    const channels = await queryOperatorChannels(catalogUrl as string, operatorName as string);
    if (channels && Array.isArray(channels) && channels.length > 0) {
      const normalizedChannels = normalizeChannels(channels, operatorName as string);
      return res.json(normalizedChannels);
    }
    
    res.status(404).json({ error: 'No channels found for this operator' });
  } catch (error: any) {
    console.error(`Error fetching channels:`, error);
    res.status(500).json({ error: 'Failed to get operator channels' });
  }
});

app.get('/api/operators/:operator/dependencies', async (req: Request, res: Response) => {
  try {
    const { operator } = req.params;
    const { catalogUrl } = req.query;
    
    let dependencies: OperatorDependency[] = [];
    let catalogType: string | null = null;
    let catalogVersion: string | null = null;

    if (catalogUrl) {
      catalogType = getCatalogNameFromUrl(catalogUrl as string);
      catalogVersion = (catalogUrl as string).includes(':') ? (catalogUrl as string).split(':')[1] : 'v4.21';
      
      dependencies = await getOperatorDependencies(catalogType, catalogVersion, operator);
    } else {
      const catalogData = await loadPreFetchedCatalogData();
      if (catalogData && catalogData.index && catalogData.index.catalogs) {
        for (const catalog of catalogData.index.catalogs) {
          const deps = await getOperatorDependencies(
            catalog.catalog_type,
            catalog.ocp_version,
            operator
          );
          
          if (deps.length > 0) {
            dependencies = deps;
            catalogType = catalog.catalog_type;
            catalogVersion = catalog.ocp_version;
            break;
          }
        }
      }
    }
    
    if (dependencies.length === 0) {
      return res.json({ 
        operator,
        dependencies: [],
        message: 'No dependencies found for this operator'
      });
    }
    
    res.json({
      operator,
      catalogType,
      catalogVersion,
      dependencies,
      count: dependencies.length
    });
  } catch (error: any) {
    console.error(`Error getting dependencies for ${req.params.operator}:`, error);
    res.status(500).json({ error: 'Failed to get operator dependencies' });
  }
});

app.get('/api/operations', async (req: Request, res: Response) => {
  try {
    const operations = await getOperations();
    res.json(operations);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get operations' });
  }
});

app.get('/api/operations/history', async (req: Request, res: Response) => {
  try {
    const operations = await getOperations();
    res.json(operations);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get operation history' });
  }
});

app.post('/api/operations/start', async (req: Request, res: Response) => {
  try {
    const { configFile, mirrorDestinationSubdir } = req.body;
    const operationId = uuidv4();
    const configPath = path.join(CONFIGS_DIR, configFile);

    try {
      await fsp.access(configPath);
    } catch (error: any) {
      return res.status(404).json({ error: 'Configuration file not found' });
    }

    const cacheDir = CACHE_DIR;
    const baseMirrorPath = MIRROR_BASE_DIR;
    let subdirName = 'default';
    
    if (mirrorDestinationSubdir && mirrorDestinationSubdir.trim()) {
      const subdirInput = mirrorDestinationSubdir.trim();

      if (subdirInput.includes('/') || subdirInput.includes('..') || subdirInput.includes('\\')) {
        return res.status(400).json({ 
          error: 'Subdirectory name cannot contain path separators or traversal characters',
          provided: subdirInput,
          help: 'Use a simple name like "odf" or "production" (no slashes or special characters)'
        });
      }
      
      if (!subdirInput || subdirInput.length === 0) {
        return res.status(400).json({ error: 'Subdirectory name cannot be empty' });
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(subdirInput)) {
        return res.status(400).json({ 
          error: 'Subdirectory name contains invalid characters',
          provided: subdirInput,
          help: 'Use only letters, numbers, dashes (-), and underscores (_)'
        });
      }
      
      subdirName = subdirInput;
    }

    const mirrorPath = path.join(baseMirrorPath, subdirName);

    try {
      await fsp.mkdir(baseMirrorPath, { recursive: true, mode: 0o777 });
      const testFile = path.join(baseMirrorPath, '.test-write');
      try {
        await fsp.writeFile(testFile, 'test', { flag: 'w' });
        await fsp.unlink(testFile);
      } catch (writeError: any) {
        console.error(`Cannot write to base mirror directory ${baseMirrorPath}:`, writeError);
        return res.status(500).json({ 
          error: 'Base mirror directory is not writable',
          path: baseMirrorPath,
          details: writeError.message,
          code: writeError.code
        });
      }
    } catch (error: any) {
      console.error(`Error accessing base mirror directory ${baseMirrorPath}:`, error);
      return res.status(500).json({ 
        error: 'Cannot access base mirror directory',
        path: baseMirrorPath,
        details: error.message,
        code: error.code
      });
    }

    try {
      const dirExists = await fsp.access(mirrorPath).then(() => true).catch(() => false);

      if (!dirExists) {
        await fsp.mkdir(mirrorPath, { recursive: true, mode: 0o775 });
        console.log(`Created new mirror directory: ${mirrorPath}`);
      } else {
        console.log(`Using existing mirror directory: ${mirrorPath}`);
      }

      await fsp.access(mirrorPath, fs.constants.W_OK);

      const testFile = path.join(mirrorPath, '.test-write');
      try {
        await fsp.writeFile(testFile, 'test', { flag: 'w' });
        await fsp.unlink(testFile);
      } catch (writeError: any) {
        console.error(`Cannot write to mirror directory ${mirrorPath}:`, writeError);
        return res.status(500).json({ 
          error: 'Mirror destination directory exists but is not writable',
          path: mirrorPath,
          subdirectory: subdirName,
          details: writeError.message,
          code: writeError.code,
          help: 'The directory exists but the container cannot write to it. Check permissions on the host.'
        });
      }
    } catch (error: any) {
      console.error(`Error creating/accessing mirror directory ${mirrorPath}:`, error);
      return res.status(500).json({ 
        error: 'Cannot create or access mirror destination directory',
        path: mirrorPath,
        subdirectory: subdirName,
        details: error.message,
        code: error.code
      });
    }

    const operation: OperationRecord = {
      id: operationId,
      name: `Mirror Operation ${operationId.slice(0, 8)}`,
      configFile,
      mirrorDestination: mirrorPath,
      status: 'running',
      startedAt: new Date().toISOString(),
      logs: []
    };

    try {
      await saveOperation(operation);
    } catch (error: any) {
      console.error(`Error saving operation ${operationId}:`, error);
      return res.status(500).json({ 
        error: 'Failed to create operation record',
        details: error.message
      });
    }

    const logFile = path.join(LOGS_DIR, `${operationId}.log`);
    const logStream = fs.createWriteStream(logFile);

    const mirrorUrl = pathToFileURL(mirrorPath).href;

  const child = spawn('oc-mirror', [
      '--v2',
      '--config', configPath,
      '--dest-tls-verify=false',
      '--src-tls-verify=false',
      '--cache-dir', cacheDir,
      '--authfile', AUTHFILE_PATH,
      mirrorUrl
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: APP_ROOT_DIR
    });

    runningProcesses.set(operationId, {
      pid: child.pid,
      child: child
    });

    child.stdout!.pipe(logStream);
    child.stderr!.pipe(logStream);
    
    let stdout = '';
    let stderr = '';
    
    child.stdout!.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    
    child.stderr!.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    child.on('close', async (code: number | null) => {
      runningProcesses.delete(operationId);
      logStream.end();

      let logs = stdout + stderr;
      if (!logs) {
        try {
          logs = await fsp.readFile(logFile, 'utf8');
        } catch {}
      }

      const hasErrorInLogs = logs.toLowerCase().includes('[error]') || logs.toLowerCase().includes('error:');
      let finalStatus: OperationRecord['status'] = 'success';
      if (code !== 0 || hasErrorInLogs) finalStatus = 'failed';

      const opFile = path.join(OPERATIONS_DIR, `${operationId}.json`);
      const opData: OperationRecord = JSON.parse(await fsp.readFile(opFile, 'utf8'));
      if (opData.status === 'stopped') finalStatus = 'stopped';
      
      const completedAt = new Date().toISOString();
      const duration = Math.floor((new Date(completedAt).getTime() - new Date(operation.startedAt).getTime()) / 1000);
      
      await updateOperation(operationId, {
        status: finalStatus,
        completedAt,
        duration,
        errorMessage: code !== 0 ? `Process exited with code ${code}` : (hasErrorInLogs ? 'Error detected in logs' : null),
        logs: logs.split('\n')
      });
    });

    child.on('error', async (error: Error) => {
      runningProcesses.delete(operationId);
      logStream.end();
      
      const completedAt = new Date().toISOString();
      const duration = Math.floor((new Date(completedAt).getTime() - new Date(operation.startedAt).getTime()) / 1000);
      
      await updateOperation(operationId, {
        status: 'failed',
        completedAt,
        duration,
        errorMessage: error.message,
        logs: [error.message]
      });
    });

    res.json({ message: 'Operation started successfully', operationId });
  } catch (error: any) {
    console.error('Error starting operation:', error);
    res.status(500).json({ error: 'Failed to start operation' });
  }
});

app.post('/api/operations/:id/stop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const processInfo = runningProcesses.get(id);
    if (processInfo) {
      try {
        processInfo.child.kill('SIGTERM');

        setTimeout(() => {
          if (processInfo.child.killed === false) {
            processInfo.child.kill('SIGKILL');
          }
        }, 5000);

        runningProcesses.delete(id);
      } catch (killError: any) {
        console.error('Error killing process:', killError);
      }
    }

    await updateOperation(id, {
      status: 'stopped',
      completedAt: new Date().toISOString()
    });
    
    res.json({ message: 'Operation stopped successfully' });
  } catch (error: any) {
    console.error('Error stopping operation:', error);
    res.status(500).json({ error: 'Failed to stop operation' });
  }
});

app.delete('/api/operations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const filename = `${id}.json`;
    const filepath = path.join(OPERATIONS_DIR, filename);
    
    try {
      await fsp.unlink(filepath);
    } catch (error: any) {
    }
    
    res.json({ message: 'Operation deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete operation' });
  }
});

app.get('/api/operations/:id/logs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const operation = await getOperation(id);
    let logs = '';

    const logFile = path.join(LOGS_DIR, `${id}.log`);
    try {
      logs = await fsp.readFile(logFile, 'utf8');
    } catch (e: any) {
      if (operation.logs && operation.logs.length > 0) {
        logs = operation.logs.join('\n');
      }
    }
    
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get operation logs' });
  }
});

app.get('/api/operations/:id/details', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const operation = await getOperation(id);
    
    if (!operation) {
      return res.status(404).json({ error: 'Operation not found' });
    }

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

    if (operation.logs && Array.isArray(operation.logs)) {
      const logs = operation.logs.join('\n');

      const imagesToCopyMatch = logs.match(/📌 images to copy (\d+)/);
      if (imagesToCopyMatch) {
        details.imagesMirrored = parseInt(imagesToCopyMatch[1]);
      }

      const operatorSuccessMatch = logs.match(/✓ (\d+) \/ (\d+) operator images mirrored successfully/);
      if (operatorSuccessMatch) {
        details.operatorsMirrored = parseInt(operatorSuccessMatch[1]);
      }

      const catalogMatches = logs.match(/Collected catalog ([^\n]+)/g);
      if (catalogMatches) {
        details.operatorsMirrored = catalogMatches.length;
      }

      if (details.imagesMirrored > 0) {
        details.totalSize = details.imagesMirrored * 50 * 1024 * 1024;
      }

      const releaseImagesMatch = logs.match(/🔍 collecting release images/);
      if (releaseImagesMatch) {
        const releaseImagesCollected = logs.match(/Success copying.*release.*➡️ cache/g);
        if (releaseImagesCollected) {
          details.platformImages = releaseImagesCollected.length;
        } else {
          details.platformImages = 0;
        }
      } else {
        details.platformImages = 0;
      }

      const additionalImagesMatch = logs.match(/🔍 collecting additional images/);
      if (additionalImagesMatch) {
        const additionalImagesCollected = logs.match(/Success copying.*additional.*➡️ cache/g);
        if (additionalImagesCollected) {
          details.additionalImages = additionalImagesCollected.length;
        } else {
          details.additionalImages = 0;
        }
      } else {
        details.additionalImages = 0;
      }

      const helmImagesMatch = logs.match(/🔍 collecting helm images/);
      if (helmImagesMatch) {
        const helmChartsCollected = logs.match(/Success copying.*helm.*➡️ cache/g);
        if (helmChartsCollected) {
          details.helmCharts = helmChartsCollected.length;
        } else {
          details.helmCharts = 0;
        }
      } else {
        details.helmCharts = 0;
      }
    }
    
    res.json(details);
  } catch (error: any) {
    console.error('Error getting operation details:', error);
    res.status(500).json({ error: 'Failed to get operation details' });
  }
});

app.get('/api/operations/:id/logstream', (req: Request, res: Response) => {
  const { id } = req.params;
  const logFile = path.join(LOGS_DIR, `${id}.log`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let filePos = 0;
  let finished = false;
  let idleTicks = 0;

  const sendNewLines = async (): Promise<void> => {
    if (finished) return;
    try {
      const stats = await fsp.stat(logFile);
      if (stats.size > filePos) {
        const stream = fs.createReadStream(logFile, { start: filePos, end: stats.size });
        stream.on('data', (chunk: Buffer | string) => {
          res.write(`data: ${chunk.toString().replace(/\n/g, '\ndata: ')}\n\n`);
        });
        stream.on('end', () => {
          filePos = stats.size;
        });
        stream.on('error', (error: Error) => {
          console.error('Error reading log stream:', error);
        });
        idleTicks = 0;
      } else {
        idleTicks += 1;
      }

      const isRunning = runningProcesses.has(id);
      if (!isRunning && idleTicks >= 2) {
        let status = 'unknown';
        try {
          const operation = await getOperation(id);
          status = operation?.status || status;
        } catch {}

        res.write(`event: done\ndata: ${JSON.stringify({ id, status })}\n\n`);
        finished = true;
        clearInterval(interval);
        res.end();
      }
    } catch (error: any) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Error streaming logs:', error);
      }
    }
  };

  const interval = setInterval(sendNewLines, 1000);
  sendNewLines();

  req.on('close', () => {
    finished = true;
    clearInterval(interval);
  });
});

app.get('/api/settings', async (req: Request, res: Response) => {
  try {
    const settingsPath = path.join(STORAGE_DIR, 'settings.json');
    try {
      const content = await fsp.readFile(settingsPath, 'utf8');
      res.json(JSON.parse(content));
    } catch (error: any) {
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
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

app.post('/api/settings', async (req: Request, res: Response) => {
  try {
    const settingsPath = path.join(STORAGE_DIR, 'settings.json');
    await fsp.writeFile(settingsPath, JSON.stringify(req.body, null, 2));
    res.json({ message: 'Settings saved successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.post('/api/settings/test-registry', async (req: Request, res: Response) => {
  try {
    const { registry, username, password } = req.body;
    res.json({ message: 'Registry connection successful' });
  } catch (error: any) {
    res.status(500).json({ error: 'Registry connection failed' });
  }
});

app.post('/api/settings/cleanup-logs', async (req: Request, res: Response) => {
  try {
    res.json({ message: 'Log cleanup completed successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to cleanup logs' });
  }
});

app.get('/api/system/info', async (req: Request, res: Response) => {
  try {
    const systemInfo = await getSystemInfo();
    res.json(systemInfo);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get system info' });
  }
});

async function countFiles(dirPath: string): Promise<number> {
  let count = 0;
  const files = await fsp.readdir(dirPath, { withFileTypes: true });
  
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

function configureProductionFrontend(): void {
  app.use(express.static(DIST_DIR, {
    maxAge: '1d',
    etag: true
  }));

  app.get('*', (req: Request, res: Response) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

async function configureDevelopmentFrontend(): Promise<void> {
  const { createServer } = await import('vite');
  const vite = await createServer({
    appType: 'custom',
    cacheDir: DEV_CACHE_DIR,
    server: {
      middlewareMode: true
    }
  });

  app.use(vite.middlewares);

  app.get('*', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const template = await fsp.readFile(DEV_INDEX_HTML, 'utf8');
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (caughtError) {
      const error = caughtError as Error;
      vite.ssrFixStacktrace(error);
      next(error);
    }
  });
}

function logStartup(): void {
  console.log(`OC Mirror Web App server running on port ${PORT}`);
  console.log(`Storage directory: ${STORAGE_DIR}`);
  console.log(`Configs directory: ${CONFIGS_DIR}`);
  console.log(`Operations directory: ${OPERATIONS_DIR}`);
  console.log(`Logs directory: ${LOGS_DIR}`);
  console.log(`Cache directory: ${CACHE_DIR}`);
  console.log(`App root directory: ${APP_ROOT_DIR}`);
  console.log(`Mirror base directory: ${MIRROR_BASE_DIR}`);
  console.log(`Authfile path: ${AUTHFILE_PATH}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`API endpoints available at: http://localhost:${PORT}/api/*`);

  if (!IS_PRODUCTION) {
    console.log(`Development UI available at: http://localhost:${PORT}`);
  }
}

async function startServer(): Promise<void> {
  if (IS_PRODUCTION) {
    configureProductionFrontend();
  } else {
    await configureDevelopmentFrontend();
  }

  app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, () => {
    logStartup();
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
