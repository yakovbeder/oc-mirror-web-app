#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = {
    catalogDataDir: path.join(repoRoot, 'catalog-data'),
    outputDir: path.join(repoRoot, 'audit-reports'),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--catalog-data' || arg === '--catalog-data-dir') && argv[i + 1]) {
      options.catalogDataDir = path.resolve(argv[++i]);
    } else if (arg === '--output-dir' && argv[i + 1]) {
      options.outputDir = path.resolve(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/audit-fetch-catalogs.mjs [options]

Options:
  --catalog-data-dir <path>   Catalog data root (default: ./catalog-data)
  --output-dir <path>         Report output directory (default: ./audit-reports)
`);
      process.exit(0);
    }
  }

  return options;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function compareVersions(a, b) {
  const base = (value) => {
    const match = value.match(/^(\d+\.\d+\.\d+)/);
    return match ? match[1] : value;
  };

  const baseA = base(a);
  const baseB = base(b);
  const partsA = baseA.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const partsB = baseB.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(partsA.length, partsB.length);

  for (let index = 0; index < maxLength; index += 1) {
    const partA = partsA[index] || 0;
    const partB = partsB[index] || 0;
    if (partA !== partB) {
      return partA - partB;
    }
  }

  return a.localeCompare(b);
}

function sortVersions(values) {
  return uniqueStrings(values).sort(compareVersions);
}

function sortStrings(values) {
  return uniqueStrings(values).sort((left, right) => left.localeCompare(right));
}

function normalizeGeneratedChannels(channels) {
  if (!Array.isArray(channels)) {
    return [];
  }

  if (channels.length === 1 && typeof channels[0] === 'string') {
    if (channels[0].includes('\n')) {
      return sortStrings(
        channels[0]
          .split('\n')
          .map((channel) => channel.trim())
          .filter(Boolean),
      );
    }

    if (channels[0].includes(' ')) {
      return sortStrings(
        channels[0]
          .split(' ')
          .map((channel) => channel.trim())
          .filter(Boolean),
      );
    }
  }

  return sortStrings(
    channels
      .map((channel) => {
        if (typeof channel === 'string') {
          return channel.trim();
        }
        if (isObject(channel) && typeof channel.name === 'string') {
          return channel.name.trim();
        }
        return '';
      })
      .filter(Boolean),
  );
}

function extractGeneratedVersions(channelNames, operatorName) {
  const versions = new Set();

  for (const channel of channelNames) {
    if (!channel || !channel.trim()) {
      continue;
    }

    if (operatorName && channel.includes(`${operatorName}.`)) {
      const escapedOperatorName = operatorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const versionWithV = channel.match(new RegExp(`${escapedOperatorName}\\.v(.+)`));
      if (versionWithV) {
        versions.add(versionWithV[1]);
        continue;
      }

      const versionWithoutV = channel.match(new RegExp(`${escapedOperatorName}\\.(.+)`));
      if (versionWithoutV) {
        versions.add(versionWithoutV[1]);
        continue;
      }
    }

    if (operatorName) {
      const operatorBase = operatorName.replace(/-certified$/, '').replace(/-community$/, '');
      if (operatorBase !== operatorName && channel.includes(`${operatorBase}.`)) {
        const escapedOperatorBase = operatorBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const versionWithV = channel.match(new RegExp(`${escapedOperatorBase}\\.v(.+)`));
        if (versionWithV) {
          versions.add(versionWithV[1]);
          continue;
        }

        const versionWithoutV = channel.match(new RegExp(`${escapedOperatorBase}\\.(.+)`));
        if (versionWithoutV) {
          versions.add(versionWithoutV[1]);
          continue;
        }
      }
    }

    const genericVersionWithV = channel.match(/^[^.]+\.v(.+)/);
    if (genericVersionWithV) {
      versions.add(genericVersionWithV[1]);
      continue;
    }

    const genericVersionWithoutV = channel.match(/^[^.]+\.(\d+\.\d+\.\d+.*)/);
    if (genericVersionWithoutV) {
      versions.add(genericVersionWithoutV[1]);
      continue;
    }

    const versionMatch = channel.match(/^v?(\d+\.\d+\.\d+)/);
    if (versionMatch) {
      versions.add(versionMatch[1]);
    }
  }

  return Array.from(versions).sort(compareVersions);
}

function getUiFallbackVersions(channelName) {
  if (!channelName) {
    return [];
  }

  const versions = [];
  const match = channelName.match(/(\d+)\.(\d+)/);
  if (match) {
    const major = match[1];
    const minor = Number.parseInt(match[2], 10);
    for (let patch = 0; patch <= 10; patch += 1) {
      versions.push(`${major}.${minor}.${patch}`);
    }
    for (let patch = 0; patch <= 5; patch += 1) {
      versions.push(`${major}.${minor + 1}.${patch}`);
    }
    if (minor > 0) {
      for (let patch = 0; patch <= 5; patch += 1) {
        versions.push(`${major}.${minor - 1}.${patch}`);
      }
    }
    return sortVersions(versions);
  }

  return sortVersions([
    '1.0.0',
    '1.0.1',
    '1.0.2',
    '1.1.0',
    '1.1.1',
    '1.2.0',
    '1.2.1',
    '2.0.0',
    '2.0.1',
  ]);
}

function extractVersionFromName(value) {
  if (!value) {
    return null;
  }

  const patterns = [
    /\.v(\d+\.\d+\.\d+(?:[-+._a-zA-Z0-9]*)?)/,
    /\.(\d+\.\d+\.\d+(?:[-+._a-zA-Z0-9]*)?)/,
    /^v?(\d+\.\d+\.\d+(?:[-+._a-zA-Z0-9]*)?)$/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function extractBundleVersion(bundleDoc) {
  const properties = Array.isArray(bundleDoc.properties) ? bundleDoc.properties : [];
  for (const property of properties) {
    if (property?.type === 'olm.package' && isObject(property.value) && typeof property.value.version === 'string') {
      return property.value.version;
    }
  }

  return extractVersionFromName(bundleDoc.name ?? '');
}

function normalizeDependencies(dependencies) {
  const unique = new Map();

  for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
    if (!isObject(dependency) || typeof dependency.packageName !== 'string' || !dependency.packageName.trim()) {
      continue;
    }

    const normalizedDependency = {
      packageName: dependency.packageName.trim(),
      versionRange:
        dependency.versionRange === undefined || dependency.versionRange === null
          ? null
          : String(dependency.versionRange),
    };

    unique.set(
      `${normalizedDependency.packageName}\u0000${normalizedDependency.versionRange ?? ''}`,
      normalizedDependency,
    );
  }

  return Array.from(unique.values()).sort((left, right) => {
    const packageCompare = left.packageName.localeCompare(right.packageName);
    if (packageCompare !== 0) {
      return packageCompare;
    }
    return (left.versionRange ?? '').localeCompare(right.versionRange ?? '');
  });
}

function normalizeDependencyMap(value) {
  if (!isObject(value)) {
    return null;
  }

  const normalized = {};
  for (const operatorName of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    normalized[operatorName] = normalizeDependencies(value[operatorName]);
  }
  return normalized;
}

function getRange(versions) {
  if (!versions.length) {
    return { min: null, max: null };
  }
  return {
    min: versions[0],
    max: versions[versions.length - 1],
  };
}

function flattenDocuments(documents) {
  const flattened = [];

  for (const document of documents) {
    if (Array.isArray(document)) {
      for (const entry of document) {
        if (isObject(entry)) {
          flattened.push(entry);
        }
      }
    } else if (isObject(document)) {
      flattened.push(document);
    }
  }

  return flattened;
}

function parseJsonDocuments(text) {
  const documents = [];
  let index = 0;

  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) {
      index += 1;
    }

    if (index >= text.length) {
      break;
    }

    const startChar = text[index];
    if (startChar !== '{' && startChar !== '[') {
      throw new Error(`Unsupported JSON token "${startChar}" at offset ${index}`);
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let endIndex = index;

    for (; endIndex < text.length; endIndex += 1) {
      const character = text[endIndex];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === '\\') {
          escaped = true;
          continue;
        }
        if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
        continue;
      }

      if (character === '{' || character === '[') {
        depth += 1;
        continue;
      }

      if (character === '}' || character === ']') {
        depth -= 1;
        if (depth === 0) {
          const slice = text.slice(index, endIndex + 1);
          documents.push(JSON.parse(slice));
          index = endIndex + 1;
          break;
        }
      }
    }

    if (depth !== 0) {
      throw new Error('Unterminated JSON document');
    }
  }

  return documents;
}

function parseYamlDocuments(text) {
  return YAML.parseAllDocuments(text)
    .map((document) => document.toJS())
    .filter((document) => document !== null && document !== undefined);
}

async function parseStructuredFile(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.json') {
    return flattenDocuments(parseJsonDocuments(text));
  }

  if (extension === '.yaml' || extension === '.yml') {
    return flattenDocuments(parseYamlDocuments(text));
  }

  return [];
}

async function listStructuredFiles(operatorDir) {
  const files = [];
  const entries = await fs.readdir(operatorDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = path.join(operatorDir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'channels' || entry.name === 'bundles') {
        const nestedEntries = await fs.readdir(fullPath, { withFileTypes: true });
        nestedEntries.sort((left, right) => left.name.localeCompare(right.name));
        for (const nestedEntry of nestedEntries) {
          if (!nestedEntry.isFile()) {
            continue;
          }
          const extension = path.extname(nestedEntry.name).toLowerCase();
          if (extension === '.json' || extension === '.yaml' || extension === '.yml') {
            files.push(path.join(fullPath, nestedEntry.name));
          }
        }
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (extension === '.json' || extension === '.yaml' || extension === '.yml') {
      files.push(fullPath);
    }
  }

  return files;
}

function isPackageDoc(doc, filePath) {
  if (doc.schema === 'olm.package') {
    return true;
  }

  const baseName = path.basename(filePath);
  return baseName.startsWith('package.') && typeof doc.name === 'string';
}

function isChannelDoc(doc, filePath) {
  if (doc.schema === 'olm.channel') {
    return true;
  }

  const relativePath = filePath.replace(/\\/g, '/');
  const baseName = path.basename(filePath);
  return (
    (relativePath.includes('/channels/') || baseName === 'channel.json' || baseName === 'channels.json') &&
    typeof doc.name === 'string' &&
    Array.isArray(doc.entries)
  );
}

function isBundleDoc(doc, filePath) {
  if (doc.schema === 'olm.bundle') {
    return true;
  }

  const relativePath = filePath.replace(/\\/g, '/');
  const baseName = path.basename(filePath);
  return (
    (relativePath.includes('/bundles/') || baseName.startsWith('bundle-')) &&
    typeof doc.name === 'string' &&
    Array.isArray(doc.properties)
  );
}

async function loadRawOperatorTruth(operatorDir) {
  const structuredFiles = await listStructuredFiles(operatorDir);
  const parseWarnings = [];
  const packageDocs = [];
  const channelDocs = [];
  const bundleDocs = [];

  for (const filePath of structuredFiles) {
    if (path.basename(filePath) === 'released-bundles.json') {
      continue;
    }

    try {
      const documents = await parseStructuredFile(filePath);
      for (const doc of documents) {
        if (!isObject(doc)) {
          continue;
        }

        if (isPackageDoc(doc, filePath)) {
          packageDocs.push({ doc, filePath });
        }
        if (isChannelDoc(doc, filePath)) {
          channelDocs.push({ doc, filePath });
        }
        if (isBundleDoc(doc, filePath)) {
          bundleDocs.push({ doc, filePath });
        }
      }
    } catch (error) {
      parseWarnings.push({
        file: path.relative(repoRoot, filePath),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const dirName = path.basename(operatorDir);
  const packageDoc = packageDocs.find((entry) => typeof entry.doc.name === 'string')?.doc ?? {};
  const operatorName = normalizeString(packageDoc.name) || dirName;
  const defaultChannel = normalizeString(packageDoc.defaultChannel) || null;
  const rawChannels = sortStrings(
    channelDocs.map((entry) => normalizeString(entry.doc.name)).filter(Boolean),
  );

  const bundleVersionByName = new Map();
  const bundleVersions = [];
  const bundleMetadata = bundleDocs.map((entry) => {
    const version = extractBundleVersion(entry.doc);
    if (entry.doc.name && version) {
      bundleVersionByName.set(entry.doc.name, version);
    }
    if (version) {
      bundleVersions.push(version);
    }
    return {
      filePath: entry.filePath,
      doc: entry.doc,
      version,
    };
  });

  const realVersionsByChannel = {};
  for (const channelEntry of channelDocs) {
    const channelName = normalizeString(channelEntry.doc.name);
    const entries = Array.isArray(channelEntry.doc.entries) ? channelEntry.doc.entries : [];
    const versions = sortVersions(
      entries
        .map((entry) => {
          if (!isObject(entry) || typeof entry.name !== 'string') {
            return null;
          }
          return bundleVersionByName.get(entry.name) ?? extractVersionFromName(entry.name);
        })
        .filter(Boolean),
    );

    if (versions.length > 0) {
      realVersionsByChannel[channelName] = versions;
    }
  }

  const realVersions =
    Object.keys(realVersionsByChannel).length > 0
      ? sortVersions(Object.values(realVersionsByChannel).flat())
      : sortVersions(bundleVersions);

  const perChannelRanges = {};
  for (const [channelName, versions] of Object.entries(realVersionsByChannel)) {
    perChannelRanges[channelName] = getRange(versions);
  }

  let latestBundle = null;
  const sortedBundleMetadata = [...bundleMetadata].sort((left, right) => {
    if (left.version && right.version) {
      return compareVersions(left.version, right.version);
    }
    if (left.version) {
      return 1;
    }
    if (right.version) {
      return -1;
    }
    return left.filePath.localeCompare(right.filePath);
  });
  if (sortedBundleMetadata.length > 0) {
    latestBundle = sortedBundleMetadata[sortedBundleMetadata.length - 1];
  }

  let expectedDependencies = [];
  if (latestBundle && Array.isArray(latestBundle.doc.properties)) {
    expectedDependencies = normalizeDependencies(
      latestBundle.doc.properties
        .filter((property) => property?.type === 'olm.package.required' && isObject(property.value))
        .map((property) => ({
          packageName: property.value.packageName,
          versionRange: property.value.versionRange ?? null,
        })),
    );
  }

  return {
    dirName,
    operatorName,
    defaultChannel,
    channels: rawChannels,
    realVersionsByChannel,
    realVersions,
    perChannelRanges,
    bundleCount: bundleDocs.length,
    structuredFiles: structuredFiles.map((filePath) => path.relative(repoRoot, filePath)),
    parseWarnings,
    expectedDependencies,
  };
}

function addIssue(issues, category, details) {
  issues.push({ category, details });
}

function formatList(values, maxItems = 6) {
  if (!values || values.length === 0) {
    return '(none)';
  }
  if (values.length <= maxItems) {
    return values.join(', ');
  }
  return `${values.slice(0, maxItems).join(', ')} ... (+${values.length - maxItems} more)`;
}

function formatRange(min, max) {
  if (!min && !max) {
    return '(none)';
  }
  if (min && max) {
    return `${min} -> ${max}`;
  }
  return min || max || '(none)';
}

function countCategories(issueLists) {
  const counts = {};
  for (const issue of issueLists) {
    counts[issue.category] = (counts[issue.category] || 0) + 1;
  }
  return counts;
}

async function readJsonFile(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function discoverCatalogSnapshots(catalogDataDir) {
  const snapshots = [];
  const entries = await fs.readdir(catalogDataDir, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }

    const catalogType = entry.name;
    const catalogTypeDir = path.join(catalogDataDir, catalogType);
    const versionEntries = await fs.readdir(catalogTypeDir, { withFileTypes: true });

    for (const versionEntry of versionEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!versionEntry.isDirectory()) {
        continue;
      }

      const version = versionEntry.name;
      const snapshotDir = path.join(catalogTypeDir, version);
      try {
        await fs.access(path.join(snapshotDir, 'operators.json'));
        snapshots.push({
          catalogType,
          version,
          key: `${catalogType}:${version}`,
          snapshotDir,
        });
      } catch {
        // Ignore directories without generated operator data.
      }
    }
  }

  return snapshots;
}

async function auditSnapshot(snapshot, masterDependencies) {
  const operatorsPath = path.join(snapshot.snapshotDir, 'operators.json');
  const dependenciesPath = path.join(snapshot.snapshotDir, 'dependencies.json');
  const configsDir = path.join(snapshot.snapshotDir, 'configs');

  const generatedOperators = await readJsonFile(operatorsPath, []);
  const perCatalogDependencies = await readJsonFile(dependenciesPath, null);
  const masterCatalogDependencies = isObject(masterDependencies) ? masterDependencies[snapshot.key] ?? null : null;

  const rawOperatorEntries = [];
  try {
    const operatorDirEntries = await fs.readdir(configsDir, { withFileTypes: true });
    for (const operatorDirEntry of operatorDirEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (operatorDirEntry.isDirectory()) {
        rawOperatorEntries.push(
          await loadRawOperatorTruth(path.join(configsDir, operatorDirEntry.name)),
        );
      }
    }
  } catch {
    // Leave rawOperatorEntries empty; missing configs will be reported through generated-vs-raw mismatches.
  }

  const rawByName = new Map();
  const rawByDir = new Map();
  for (const rawEntry of rawOperatorEntries) {
    rawByName.set(rawEntry.operatorName, rawEntry);
    rawByDir.set(rawEntry.dirName, rawEntry);
  }

  const generatedByName = new Map();
  for (const generatedOperator of generatedOperators) {
    generatedByName.set(generatedOperator.name, generatedOperator);
  }

  const operatorFindings = [];
  const seenGenerated = new Set();

  for (const rawEntry of rawOperatorEntries) {
    const generatedOperator =
      generatedByName.get(rawEntry.operatorName) ??
      (rawEntry.dirName !== rawEntry.operatorName ? generatedByName.get(rawEntry.dirName) : null) ??
      null;

    const issues = [];
    const generatedChannels = normalizeGeneratedChannels(generatedOperator?.channels);
    const rawChannels = rawEntry.channels;

    if (!generatedOperator) {
      addIssue(issues, 'raw_operator_missing_from_generated', {
        operatorDir: rawEntry.dirName,
      });
    } else {
      seenGenerated.add(generatedOperator.name);
    }

    if (rawEntry.parseWarnings.length > 0) {
      addIssue(issues, 'raw_parse_warning', {
        files: rawEntry.parseWarnings,
      });
    }

    if (generatedOperator && generatedOperator.name !== rawEntry.operatorName) {
      addIssue(issues, 'generated_name_mismatch', {
        generatedName: generatedOperator.name,
        rawName: rawEntry.operatorName,
      });
    }

    if ((generatedOperator?.defaultChannel ?? null) !== rawEntry.defaultChannel) {
      addIssue(issues, 'default_channel_mismatch', {
        generatedDefaultChannel: generatedOperator?.defaultChannel ?? null,
        rawDefaultChannel: rawEntry.defaultChannel,
      });
    }

    if (rawChannels.length > 0 && generatedChannels.length === 0) {
      addIssue(issues, 'empty_channel_list', {
        rawChannels,
      });
    }

    const missingChannels = rawChannels.filter((channel) => !generatedChannels.includes(channel));
    const unexpectedChannels = generatedChannels.filter((channel) => !rawChannels.includes(channel));

    if (missingChannels.length > 0) {
      addIssue(issues, 'missing_channels', {
        missingChannels,
      });
    }

    if (unexpectedChannels.length > 0) {
      addIssue(issues, 'unexpected_channels', {
        unexpectedChannels,
      });
    }

    const realVersions = rawEntry.realVersions;
    const generatedVersionSource = generatedOperator?.name ?? rawEntry.operatorName;
    const serverDerivedVersions = extractGeneratedVersions(generatedChannels, generatedVersionSource);
    const fallbackChannelName =
      generatedOperator?.defaultChannel ||
      generatedChannels[0] ||
      rawEntry.defaultChannel ||
      rawChannels[0] ||
      '';
    const uiFallbackVersions = getUiFallbackVersions(fallbackChannelName);
    const realRange = getRange(realVersions);
    const serverRange = getRange(serverDerivedVersions);
    const fallbackRange = getRange(uiFallbackVersions);

    if (realVersions.length === 0 && (rawChannels.length > 0 || rawEntry.bundleCount > 0)) {
      addIssue(issues, 'no_real_versions_found', {
        rawChannels,
        bundleCount: rawEntry.bundleCount,
      });
    }

    if (realVersions.length > 0 && serverDerivedVersions.length === 0) {
      addIssue(issues, 'ui_version_fallback_risk', {
        rawRange: realRange,
        fallbackRange,
        fallbackChannelName,
      });
    }

    if (
      realVersions.length > 0 &&
      (serverRange.min !== realRange.min || serverRange.max !== realRange.max)
    ) {
      addIssue(issues, 'version_range_mismatch', {
        rawRange: realRange,
        serverRange,
        rawVersions: realVersions,
        serverDerivedVersions,
      });
    }

    const expectedDependencies = rawEntry.expectedDependencies;
    const generatedDependencies = normalizeDependencies(
      generatedOperator ? perCatalogDependencies?.[generatedOperator.name] : [],
    );
    const masterDependenciesForOperator = normalizeDependencies(
      generatedOperator ? masterCatalogDependencies?.[generatedOperator.name] : [],
    );

    if (expectedDependencies.length > 0 && generatedDependencies.length === 0) {
      addIssue(issues, 'dependencies_missing', {
        expectedDependencies,
      });
    } else if (JSON.stringify(expectedDependencies) !== JSON.stringify(generatedDependencies)) {
      addIssue(issues, 'dependencies_mismatch', {
        expectedDependencies,
        generatedDependencies,
      });
    }

    if (
      generatedOperator &&
      JSON.stringify(generatedDependencies) !== JSON.stringify(masterDependenciesForOperator)
    ) {
      addIssue(issues, 'master_dependencies_operator_mismatch', {
        generatedDependencies,
        masterDependencies: masterDependenciesForOperator,
      });
    }

    if (issues.length > 0) {
      operatorFindings.push({
        operator: generatedOperator?.name ?? rawEntry.operatorName,
        catalogKey: snapshot.key,
        operatorDir: path.relative(repoRoot, path.join(configsDir, rawEntry.dirName)),
        generated: generatedOperator
          ? {
              name: generatedOperator.name,
              defaultChannel: generatedOperator.defaultChannel ?? null,
              channels: generatedChannels,
            }
          : null,
        raw: {
          operatorName: rawEntry.operatorName,
          operatorDirName: rawEntry.dirName,
          defaultChannel: rawEntry.defaultChannel,
          channels: rawChannels,
          structuredFiles: rawEntry.structuredFiles,
        },
        versions: {
          rawVersions: realVersions,
          rawRange: realRange,
          perChannelRanges: rawEntry.perChannelRanges,
          serverDerivedVersions,
          serverRange,
          uiFallbackVersions,
          uiFallbackRange: fallbackRange,
          fallbackChannelName,
        },
        dependencies: {
          expected: expectedDependencies,
          generated: generatedDependencies,
          master: masterDependenciesForOperator,
        },
        issues,
      });
    }
  }

  for (const generatedOperator of generatedOperators) {
    if (seenGenerated.has(generatedOperator.name)) {
      continue;
    }

    const rawMatch =
      rawByName.get(generatedOperator.name) ??
      rawByDir.get(generatedOperator.name) ??
      null;

    if (rawMatch) {
      continue;
    }

    operatorFindings.push({
      operator: generatedOperator.name,
      catalogKey: snapshot.key,
      operatorDir: null,
      generated: {
        name: generatedOperator.name,
        defaultChannel: generatedOperator.defaultChannel ?? null,
        channels: normalizeGeneratedChannels(generatedOperator.channels),
      },
      raw: null,
      versions: null,
      dependencies: {
        expected: [],
        generated: normalizeDependencies(perCatalogDependencies?.[generatedOperator.name]),
        master: normalizeDependencies(masterCatalogDependencies?.[generatedOperator.name]),
      },
      issues: [
        {
          category: 'generated_operator_missing_from_raw',
          details: {},
        },
      ],
    });
  }

  const catalogIssues = [];

  if (perCatalogDependencies === null) {
    catalogIssues.push({
      category: 'dependencies_file_missing',
      details: {
        path: path.relative(repoRoot, dependenciesPath),
      },
    });
  }

  if (masterCatalogDependencies === null && perCatalogDependencies !== null) {
    catalogIssues.push({
      category: 'master_dependencies_missing',
      details: {
        catalogKey: snapshot.key,
      },
    });
  } else if (
    perCatalogDependencies !== null &&
    JSON.stringify(normalizeDependencyMap(perCatalogDependencies)) !==
      JSON.stringify(normalizeDependencyMap(masterCatalogDependencies))
  ) {
    catalogIssues.push({
      category: 'master_dependencies_mismatch',
      details: {
        catalogKey: snapshot.key,
      },
    });
  }

  return {
    catalogKey: snapshot.key,
    catalogType: snapshot.catalogType,
    version: snapshot.version,
    generatedOperatorCount: generatedOperators.length,
    rawOperatorCount: rawOperatorEntries.length,
    operators: operatorFindings,
    catalogIssues,
    categoryCounts: countCategories([
      ...operatorFindings.flatMap((finding) => finding.issues),
      ...catalogIssues,
    ]),
  };
}

function buildMarkdownReport(report) {
  const lines = [];

  lines.push('# Fetch Catalogs Audit Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Catalog data: \`${path.relative(repoRoot, report.catalogDataDir)}\``);
  lines.push(`JSON report: \`${path.relative(repoRoot, report.jsonReportPath)}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Catalog snapshots audited: ${report.summary.catalogSnapshots}`);
  lines.push(`- Operators audited: ${report.summary.operatorsAudited}`);
  lines.push(`- Operators with issues: ${report.summary.operatorsWithIssues}`);
  lines.push(`- Catalog snapshots with issues: ${report.summary.catalogSnapshotsWithIssues}`);
  lines.push(`- Total issues: ${report.summary.totalIssues}`);
  lines.push('');
  lines.push('## Issue Counts');
  lines.push('');

  for (const [category, count] of Object.entries(report.summary.issueCounts).sort((left, right) => right[1] - left[1])) {
    lines.push(`- \`${category}\`: ${count}`);
  }

  if (report.notableFindings.dellCsm) {
    const dellFinding = report.notableFindings.dellCsm;
    lines.push('');
    lines.push('## Dell CSM Example');
    lines.push('');
    lines.push(`- Catalog: \`${dellFinding.catalogKey}\``);
    lines.push(`- Generated channels: ${formatList(dellFinding.generated?.channels ?? [])}`);
    lines.push(`- Raw channels: ${formatList(dellFinding.raw?.channels ?? [])}`);
    lines.push(`- Raw stable range: ${formatRange(dellFinding.versions?.perChannelRanges?.stable?.min ?? null, dellFinding.versions?.perChannelRanges?.stable?.max ?? null)}`);
    lines.push(`- Server-derived range: ${formatRange(dellFinding.versions?.serverRange?.min ?? null, dellFinding.versions?.serverRange?.max ?? null)}`);
    lines.push(`- UI fallback range: ${formatRange(dellFinding.versions?.uiFallbackRange?.min ?? null, dellFinding.versions?.uiFallbackRange?.max ?? null)}`);
    lines.push(`- Issues: ${dellFinding.issues.map((issue) => `\`${issue.category}\``).join(', ')}`);
  }

  for (const catalog of report.catalogs) {
    if (catalog.operators.length === 0 && catalog.catalogIssues.length === 0) {
      continue;
    }

    lines.push('');
    lines.push(`## ${catalog.catalogKey}`);
    lines.push('');
    lines.push(`- Generated operators: ${catalog.generatedOperatorCount}`);
    lines.push(`- Raw operator directories: ${catalog.rawOperatorCount}`);
    lines.push(`- Operators with issues: ${catalog.operators.length}`);

    if (catalog.catalogIssues.length > 0) {
      lines.push(`- Catalog-level issues: ${catalog.catalogIssues.map((issue) => `\`${issue.category}\``).join(', ')}`);
    }

    for (const finding of catalog.operators) {
      const categories = finding.issues.map((issue) => `\`${issue.category}\``).join(', ');
      const generatedChannels = formatList(finding.generated?.channels ?? []);
      const rawChannels = formatList(finding.raw?.channels ?? []);
      const rawRange = finding.versions ? formatRange(finding.versions.rawRange.min, finding.versions.rawRange.max) : '(none)';
      const serverRange = finding.versions ? formatRange(finding.versions.serverRange.min, finding.versions.serverRange.max) : '(none)';
      const fallbackRange = finding.versions
        ? formatRange(finding.versions.uiFallbackRange.min, finding.versions.uiFallbackRange.max)
        : '(none)';
      const expectedDependencyCount = finding.dependencies?.expected?.length ?? 0;
      const generatedDependencyCount = finding.dependencies?.generated?.length ?? 0;

      lines.push(
        `- \`${finding.operator}\`: ${categories}; generated channels=${generatedChannels}; raw channels=${rawChannels}; raw range=${rawRange}; server range=${serverRange}; UI fallback=${fallbackRange}; dependencies expected/generated=${expectedDependencyCount}/${generatedDependencyCount}`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const catalogDataDir = options.catalogDataDir;
  const outputDir = options.outputDir;

  await fs.mkdir(outputDir, { recursive: true });

  const snapshots = await discoverCatalogSnapshots(catalogDataDir);
  const masterDependencies = await readJsonFile(path.join(catalogDataDir, 'dependencies.json'), {});
  const catalogs = [];

  for (const snapshot of snapshots) {
    catalogs.push(await auditSnapshot(snapshot, masterDependencies));
  }

  const operatorFindings = catalogs.flatMap((catalog) => catalog.operators);
  const catalogIssues = catalogs.flatMap((catalog) => catalog.catalogIssues);
  const allIssues = [
    ...operatorFindings.flatMap((finding) => finding.issues),
    ...catalogIssues,
  ];

  const jsonReportPath = path.join(outputDir, 'fetch-catalogs-audit.json');
  const markdownReportPath = path.join(outputDir, 'fetch-catalogs-audit.md');

  const report = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    catalogDataDir,
    jsonReportPath,
    markdownReportPath,
    summary: {
      catalogSnapshots: catalogs.length,
      catalogSnapshotsWithIssues: catalogs.filter((catalog) => catalog.operators.length > 0 || catalog.catalogIssues.length > 0).length,
      operatorsAudited: catalogs.reduce((total, catalog) => total + catalog.rawOperatorCount, 0),
      operatorsWithIssues: operatorFindings.length,
      totalIssues: allIssues.length,
      issueCounts: countCategories(allIssues),
    },
    notableFindings: {
      dellCsm:
        operatorFindings.find(
          (finding) =>
            finding.catalogKey === 'certified-operator-index:v4.20' &&
            finding.operator === 'dell-csm-operator-certified',
        ) ?? null,
    },
    catalogs,
  };

  const markdownReport = buildMarkdownReport(report);

  await fs.writeFile(jsonReportPath, JSON.stringify(report, null, 2));
  await fs.writeFile(markdownReportPath, markdownReport);

  console.log(`Catalog snapshots audited: ${report.summary.catalogSnapshots}`);
  console.log(`Operators audited: ${report.summary.operatorsAudited}`);
  console.log(`Operators with issues: ${report.summary.operatorsWithIssues}`);
  console.log(`Total issues: ${report.summary.totalIssues}`);
  console.log(`JSON report: ${path.relative(repoRoot, jsonReportPath)}`);
  console.log(`Markdown report: ${path.relative(repoRoot, markdownReportPath)}`);
}

main().catch((error) => {
  console.error('Failed to audit catalog data:', error);
  process.exitCode = 1;
});
