import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import YAML from 'yaml';
import { useAlerts } from '../AlertContext';
import {
  Alert,
  AlertVariant,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  CodeBlock,
  CodeBlockCode,
  FileUpload,
  Flex,
  FlexItem,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  Label,
  Modal,
  ModalVariant,
  Popover,
  Spinner,
  Split,
  SplitItem,
  Tab,
  Tabs,
  TabTitleIcon,
  TabTitleText,
  TextArea,
  TextInput,
  Title,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
} from '@patternfly/react-core';
import {
  ServerIcon,
  CogIcon,
  CubesIcon,
  EyeIcon,
  UploadIcon,
  PlusCircleIcon,
  TrashIcon,
  CopyIcon,
  DownloadIcon,
  SaveIcon,
  OutlinedQuestionCircleIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TimesCircleIcon,
  ArrowRightIcon,
  BundleIcon,
} from '@patternfly/react-icons';

interface PlatformChannel {
  name: string;
  minVersion: string;
  maxVersion: string;
  type: string;
  shortestPath: boolean;
}

interface OperatorChannel {
  name: string;
  minVersion: string;
  maxVersion: string;
}

interface OperatorPackage {
  name: string;
  channels: OperatorChannel[];
  isDependency?: boolean;
  autoAddedBy?: string;
}

interface OperatorCatalog {
  catalog: string;
  catalogVersion?: string;
  availableOperators?: string[];
  packages: OperatorPackage[];
}

interface ImageSetConfig {
  kind: string;
  apiVersion: string;
  archiveSize: string;
  mirror: {
    platform: {
      channels: PlatformChannel[];
      graph: boolean;
    };
    operators: OperatorCatalog[];
    additionalImages: { name: string }[];
    helm: { repositories: never[] };
  };
}

interface CatalogInfo {
  name: string;
  url: string;
  description: string;
}

interface DetailedOperator {
  name: string;
  defaultChannel: string;
  allChannels: string[];
}

interface CleanChannel {
  name: string;
  type?: string;
  minVersion?: string;
  maxVersion?: string;
  shortestPath?: boolean;
}

interface CleanOperatorChannel {
  name: string;
  minVersion?: string;
  maxVersion?: string;
}

interface CleanConfig {
  kind: string;
  apiVersion: string;
  archiveSize?: number;
  mirror: {
    platform?: {
      graph: boolean;
      channels: CleanChannel[];
    };
    operators: {
      catalog: string;
      packages: {
        name: string;
        channels: CleanOperatorChannel[];
      }[];
    }[];
    additionalImages?: { name: string }[];
  };
}

const OCP_VERSIONS = ['4.16', '4.17', '4.18', '4.19', '4.20'];

const FALLBACK_CATALOGS: CatalogInfo[] = [
  {
    name: 'redhat-operator-index',
    url: 'registry.redhat.io/redhat/redhat-operator-index',
    description: 'Red Hat certified operators',
  },
  {
    name: 'certified-operator-index',
    url: 'registry.redhat.io/redhat/certified-operator-index',
    description: 'Certified operators from partners',
  },
  {
    name: 'community-operator-index',
    url: 'registry.redhat.io/redhat/community-operator-index',
    description: 'Community operators',
  },
];

const versionToNumber = (version: string): number => {
  const parts = version.split('.').map(Number);
  return parts[0] * 1_000_000 + parts[1] * 1_000 + (parts[2] || 0);
};

const isValidVersion = (version: string): boolean => {
  if (!version) return false;
  const parts = version.split('.');
  return parts.length >= 2 && parts.every(part => !isNaN(parseInt(part)));
};

const validateVersionRange = (
  minVersion: string,
  maxVersion: string,
  versions: string[],
): { isValid: boolean; message: string } => {
  if (!minVersion && !maxVersion) return { isValid: true, message: '' };

  const minNum = minVersion ? versionToNumber(minVersion) : 0;
  const maxNum = maxVersion ? versionToNumber(maxVersion) : Number.MAX_SAFE_INTEGER;

  if (minNum > maxNum) {
    return { isValid: false, message: 'Min version cannot be greater than max version' };
  }

  if (versions.length > 0) {
    const hasValid = versions.some(v => {
      const n = versionToNumber(v);
      return n >= minNum && n <= maxNum;
    });
    if (!hasValid) {
      return {
        isValid: false,
        message: `No versions available in range ${minVersion || '0.0.0'} to ${maxVersion || 'latest'}`,
      };
    }
  }

  return { isValid: true, message: '' };
};

const generateDefaultConfigName = (): string => {
  const now = new Date();
  const dateStr = now
    .toISOString()
    .replace(/T/, '-')
    .replace(/\..+/, '')
    .replace(/:/g, '-');
  return `imageset-config-${dateStr}-UTC.yaml`;
};

const MirrorConfig: React.FC = () => {
  const { addSuccessAlert, addDangerAlert, addWarningAlert, addInfoAlert } = useAlerts();

  const [config, setConfig] = useState<ImageSetConfig>({
    kind: 'ImageSetConfiguration',
    apiVersion: 'mirror.openshift.io/v2alpha1',
    archiveSize: '',
    mirror: {
      platform: { channels: [], graph: true },
      operators: [],
      additionalImages: [],
      helm: { repositories: [] },
    },
  });

  const [availableCatalogs, setAvailableCatalogs] = useState<CatalogInfo[]>([]);
  const [detailedOperators, setDetailedOperators] = useState<Record<string, DetailedOperator[]>>({});
  const [operatorChannels, setOperatorChannels] = useState<Record<string, string[]>>({});
  const [availableVersions, setAvailableVersions] = useState<Record<string, string[]>>({});

  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string | number>('platform');
  const [customConfigName, setCustomConfigName] = useState('');
  const [showCustomNameInput, setShowCustomNameInput] = useState(false);

  const [uploadFilename, setUploadFilename] = useState('');
  const [uploadedContent, setUploadedContent] = useState('');
  const [parsedUpload, setParsedUpload] = useState<Record<string, any> | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [isUploadLoading, setIsUploadLoading] = useState(false);

  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictFilename, setConflictFilename] = useState('');

  const operatorCatalogs: CatalogInfo[] =
    availableCatalogs.length > 0 ? availableCatalogs : FALLBACK_CATALOGS;

  const fetchAvailableData = useCallback(async () => {
    try {
      setLoading(true);
      const catalogsRes = await axios.get('/api/catalogs');
      setAvailableCatalogs(catalogsRes.data);
    } catch (error) {
      console.error('Error fetching available data:', error);
      addDangerAlert('Failed to load available channels and operators');
    } finally {
      setLoading(false);
    }
  }, [addDangerAlert]);

  useEffect(() => {
    fetchAvailableData();
  }, [fetchAvailableData]);

  const fetchOperatorsForCatalog = async (catalogUrl: string): Promise<string[]> => {
    try {
      const response = await axios.get(
        `/api/operators?catalog=${encodeURIComponent(catalogUrl)}&detailed=true`,
      );
      const detailedOps: DetailedOperator[] = response.data;
      setDetailedOperators(prev => ({ ...prev, [catalogUrl]: detailedOps }));
      return detailedOps.map(op => op.name);
    } catch (error) {
      console.error('Error fetching operators for catalog:', error);
      return [];
    }
  };

  const fetchOperatorChannels = async (
    operatorName: string,
    catalogUrl: string,
  ): Promise<string[]> => {
    const key = `${operatorName}:${catalogUrl}`;
    if (operatorChannels[key]) return operatorChannels[key];

    try {
      const response = await axios.get(
        `/api/operator-channels/${operatorName}?catalogUrl=${encodeURIComponent(catalogUrl)}`,
      );
      setOperatorChannels(prev => ({ ...prev, [key]: response.data }));
      return response.data;
    } catch (error) {
      console.error(`Error fetching channels for ${operatorName}:`, error);
      addDangerAlert(`Failed to load channels for ${operatorName}`);
      return ['stable'];
    }
  };

  const fetchChannelVersions = async (
    operatorName: string,
    channelName: string,
    catalogUrl: string,
  ): Promise<string[]> => {
    try {
      const response = await axios.get(`/api/operators/${operatorName}/versions`, {
        params: { catalog: catalogUrl },
      });
      if (response.data?.versions?.length > 0) return response.data.versions;
    } catch (error) {
      console.error(`Error fetching versions for ${operatorName}/${channelName}:`, error);
    }

    const versions: string[] = [];
    const match = channelName.match(/(\d+)\.(\d+)/);
    if (match) {
      const major = match[1];
      const minor = parseInt(match[2]);
      for (let p = 0; p <= 10; p++) versions.push(`${major}.${minor}.${p}`);
      for (let p = 0; p <= 5; p++) versions.push(`${major}.${minor + 1}.${p}`);
      if (minor > 0) {
        for (let p = 0; p <= 5; p++) versions.push(`${major}.${minor - 1}.${p}`);
      }
    } else {
      versions.push('1.0.0', '1.0.1', '1.0.2', '1.1.0', '1.1.1', '1.2.0', '1.2.1', '2.0.0', '2.0.1');
    }
    return versions;
  };

  const getChannelVersions = (
    operatorIndex: number,
    packageIndex: number,
    channelName: string,
  ): string[] => {
    const operator = config.mirror.operators[operatorIndex];
    const packageName = operator?.packages[packageIndex]?.name;
    if (!operator || !packageName || !channelName) return [];

    const key = `${packageName}:${channelName}:${operator.catalog}`;
    const versions = availableVersions[key] || [];

    if (versions.length === 0) {
      fetchChannelVersions(packageName, channelName, operator.catalog)
        .then(fetched => {
          if (fetched.length > 0) {
            setAvailableVersions(prev => ({ ...prev, [key]: fetched }));
          }
        })
        .catch(err => console.error(`Error fetching versions for ${packageName}/${channelName}:`, err));
    }

    return versions;
  };

  const addPlatformChannel = () => {
    const newChannel: PlatformChannel = {
      name: `stable-${OCP_VERSIONS[0]}`,
      minVersion: '',
      maxVersion: '',
      type: 'ocp',
      shortestPath: false,
    };
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        platform: {
          ...prev.mirror.platform,
          channels: [...prev.mirror.platform.channels, newChannel],
        },
      },
    }));
  };

  const removePlatformChannel = (index: number) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        platform: {
          ...prev.mirror.platform,
          channels: prev.mirror.platform.channels.filter((_, i) => i !== index),
        },
      },
    }));
  };

  const updatePlatformChannel = (index: number, field: string, value: string | boolean) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        platform: {
          ...prev.mirror.platform,
          channels: prev.mirror.platform.channels.map((ch, i) =>
            i === index ? { ...ch, [field]: value } : ch,
          ),
        },
      },
    }));
  };

  const validatePlatformChannel = (index: number) => {
    const channel = config.mirror.platform.channels[index];
    if (!channel.minVersion || !channel.maxVersion) return;

    if (isValidVersion(channel.minVersion) && isValidVersion(channel.maxVersion)) {
      const channelMatch = channel.name.match(/(\d+\.\d+)/);
      if (channelMatch) {
        const channelVer = channelMatch[1];
        const getMajorMinor = (v: string) => {
          const p = v.split('.');
          return `${p[0]}.${p[1]}`;
        };
        if (
          getMajorMinor(channel.minVersion) !== channelVer ||
          getMajorMinor(channel.maxVersion) !== channelVer
        ) {
          addWarningAlert(
            `Platform Channel Warning: Versions must match channel ${channelVer}.x (e.g., ${channelVer}.0)`,
          );
          return;
        }
      }

      const minNum = versionToNumber(channel.minVersion);
      const maxNum = versionToNumber(channel.maxVersion);

      if (minNum > maxNum) {
        setConfig(prev => {
          const updated = { ...prev };
          const ch = { ...channel, maxVersion: channel.minVersion, minVersion: channel.maxVersion };
          updated.mirror.platform.channels = prev.mirror.platform.channels.map((c, i) =>
            i === index ? ch : c,
          );
          addInfoAlert('Platform Channel: Auto-corrected invalid version range');
          return updated;
        });
      }
    }
  };

  const addOperator = async () => {
    const defaultCatalog =
      operatorCatalogs[0]?.url || 'registry.redhat.io/redhat/redhat-operator-index:v4.16';
    const operators = await fetchOperatorsForCatalog(defaultCatalog);

    const newOp: OperatorCatalog = {
      catalog: defaultCatalog,
      catalogVersion: defaultCatalog.split(':').pop(),
      availableOperators: operators,
      packages: [],
    };
    setConfig(prev => ({
      ...prev,
      mirror: { ...prev.mirror, operators: [...prev.mirror.operators, newOp] },
    }));
  };

  const removeOperator = (index: number) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.filter((_, i) => i !== index),
      },
    }));
  };

  const addPackageToOperator = (operatorIndex: number) => {
    const newPkg: OperatorPackage = { name: '', channels: [] };
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) =>
          i === operatorIndex ? { ...op, packages: [...op.packages, newPkg] } : op,
        ),
      },
    }));
  };

  const removePackageFromOperator = (operatorIndex: number, packageIndex: number) => {
    const operator = config.mirror.operators[operatorIndex];
    const packageToRemove = operator.packages[packageIndex];

    setConfig(prev => {
      const updatedOperators = prev.mirror.operators.map((op, i) => {
        if (i !== operatorIndex) return op;

        let updatedPackages = op.packages.filter((_, pIdx) => pIdx !== packageIndex);

        if (packageToRemove && !packageToRemove.isDependency) {
          const baseOpName = packageToRemove.name;
          updatedPackages = updatedPackages.filter(
            pkg => !pkg.isDependency || pkg.autoAddedBy !== baseOpName,
          );
        }

        return { ...op, packages: updatedPackages };
      });

      return { ...prev, mirror: { ...prev.mirror, operators: updatedOperators } };
    });
  };

  const updateOperatorPackage = async (
    operatorIndex: number,
    packageIndex: number,
    field: string,
    value: string,
  ) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) =>
          i === operatorIndex
            ? {
                ...op,
                packages: op.packages.map((pkg, pIdx) =>
                  pIdx === packageIndex ? { ...pkg, [field]: value } : pkg,
                ),
              }
            : op,
        ),
      },
    }));

    if (field === 'name' && value) {
      const operator = config.mirror.operators[operatorIndex];
      await fetchOperatorChannels(value, operator.catalog);

      try {
        const catalogVersion = operator.catalog.split(':').pop() || 'v4.19';
        const depRes = await axios.get(`/api/operators/${value}/dependencies`, {
          params: { catalogUrl: operator.catalog },
        });

        if (depRes.data?.dependencies?.length > 0) {
          const deps = depRes.data.dependencies as {
            packageName: string;
            defaultChannel?: string;
          }[];
          const vMatch = catalogVersion.match(/v?(\d+\.\d+)/);
          const defaultCh = vMatch ? `stable-${vMatch[1]}` : 'stable';

          setConfig(prev => {
            const existing = new Set(
              prev.mirror.operators[operatorIndex].packages.map(p => p.name).filter(Boolean),
            );

            const newDeps: OperatorPackage[] = deps
              .filter(d => !existing.has(d.packageName))
              .map(d => ({
                name: d.packageName,
                channels: [{ name: d.defaultChannel || defaultCh, minVersion: '', maxVersion: '' }],
                autoAddedBy: value,
                isDependency: true,
              }));

            if (newDeps.length > 0) {
              setTimeout(async () => {
                for (const dep of newDeps) {
                  await fetchOperatorChannels(dep.name, operator.catalog);
                }
              }, 0);

              addSuccessAlert(`Auto-added ${newDeps.length} dependency package(s) for ${value}`);

              return {
                ...prev,
                mirror: {
                  ...prev.mirror,
                  operators: prev.mirror.operators.map((op, i) =>
                    i === operatorIndex
                      ? { ...op, packages: [...op.packages, ...newDeps] }
                      : op,
                  ),
                },
              };
            }
            return prev;
          });
        }
      } catch {
      }
    }
  };

  const removeOperatorPackageChannel = (
    operatorIndex: number,
    packageIndex: number,
    channelIndex: number,
  ) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) =>
          i === operatorIndex
            ? {
                ...op,
                packages: op.packages.map((pkg, pIdx) =>
                  pIdx === packageIndex
                    ? { ...pkg, channels: pkg.channels.filter((_, cIdx) => cIdx !== channelIndex) }
                    : pkg,
                ),
              }
            : op,
        ),
      },
    }));
  };

  const updateOperatorPackageChannel = async (
    operatorIndex: number,
    packageIndex: number,
    channelIndex: number,
    value: string,
  ) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) =>
          i === operatorIndex
            ? {
                ...op,
                packages: op.packages.map((pkg, pIdx) =>
                  pIdx === packageIndex
                    ? {
                        ...pkg,
                        channels: pkg.channels.map((ch, cIdx) =>
                          cIdx === channelIndex ? { ...ch, name: value } : ch,
                        ),
                      }
                    : pkg,
                ),
              }
            : op,
        ),
      },
    }));

    if (value) {
      const operator = config.mirror.operators[operatorIndex];
      const packageName = operator.packages[packageIndex]?.name;
      if (operator && packageName) {
        const versions = await fetchChannelVersions(packageName, value, operator.catalog);
        const key = `${packageName}:${value}:${operator.catalog}`;
        setAvailableVersions(prev => ({ ...prev, [key]: versions }));
      }
    }
  };

  const updateOperatorPackageChannelVersion = (
    operatorIndex: number,
    packageIndex: number,
    channelIndex: number,
    field: string,
    value: string,
  ) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) =>
          i === operatorIndex
            ? {
                ...op,
                packages: op.packages.map((pkg, pIdx) =>
                  pIdx === packageIndex
                    ? {
                        ...pkg,
                        channels: pkg.channels.map((ch, cIdx) =>
                          cIdx === channelIndex ? { ...ch, [field]: value } : ch,
                        ),
                      }
                    : pkg,
                ),
              }
            : op,
        ),
      },
    }));

    setTimeout(() => {
      validateOperatorChannel(operatorIndex, packageIndex, channelIndex);
    }, 0);
  };

  const validateOperatorChannel = (
    operatorIndex: number,
    packageIndex: number,
    channelIndex: number,
  ) => {
    const operator = config.mirror.operators[operatorIndex];
    const pkg = operator?.packages[packageIndex];
    const channel = pkg?.channels[channelIndex];
    if (!channel?.minVersion || !channel?.maxVersion) return;

    if (isValidVersion(channel.minVersion) && isValidVersion(channel.maxVersion)) {
      const versions = getChannelVersions(operatorIndex, packageIndex, channel.name);
      const validation = validateVersionRange(channel.minVersion, channel.maxVersion, versions);

      if (!validation.isValid) {
        if (validation.message.includes('Min version cannot be greater than max version')) {
          setConfig(prev => {
            const newConfig = { ...prev };
            const corrected = {
              ...channel,
              maxVersion: channel.minVersion,
              minVersion: channel.maxVersion,
            };
            newConfig.mirror.operators[operatorIndex].packages[packageIndex].channels[channelIndex] =
              corrected;
            addInfoAlert('Operator Channel: Auto-corrected invalid version range');
            return { ...newConfig };
          });
        } else {
          addWarningAlert(`Version Range Warning: ${validation.message}`);
        }
      }
    }
  };

  const addChannelToPackage = (operatorIndex: number, packageIndex: number, channelName: string) => {
    const pkg = config.mirror.operators[operatorIndex]?.packages[packageIndex];
    if (pkg?.channels?.some(ch => ch.name === channelName)) return;

    const newCh: OperatorChannel = { name: channelName, minVersion: '', maxVersion: '' };
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) =>
          i === operatorIndex
            ? {
                ...op,
                packages: op.packages.map((p, pIdx) =>
                  pIdx === packageIndex
                    ? { ...p, channels: [...(p.channels || []), newCh] }
                    : p,
                ),
              }
            : op,
        ),
      },
    }));
  };

  const addAdditionalImage = () => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        additionalImages: [...prev.mirror.additionalImages, { name: '' }],
      },
    }));
  };

  const removeAdditionalImage = (index: number) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        additionalImages: prev.mirror.additionalImages.filter((_, i) => i !== index),
      },
    }));
  };

  const updateAdditionalImage = (index: number, value: string) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        additionalImages: prev.mirror.additionalImages.map((img, i) =>
          i === index ? { ...img, name: value } : img,
        ),
      },
    }));
  };

  const generateCleanConfig = useCallback((): CleanConfig => {
    const clean: CleanConfig = {
      kind: 'ImageSetConfiguration',
      apiVersion: 'mirror.openshift.io/v2alpha1',
      mirror: { operators: [] },
    };

    if (config.archiveSize && parseInt(config.archiveSize) > 0) {
      clean.archiveSize = parseInt(config.archiveSize);
    }

    if (config.mirror.additionalImages?.length > 0) {
      clean.mirror.additionalImages = config.mirror.additionalImages;
    }

    if (config.mirror.platform.channels?.length > 0) {
      clean.mirror.platform = {
        graph: config.mirror.platform.graph,
        channels: config.mirror.platform.channels.map(ch => {
          const c: CleanChannel = { name: ch.name, type: ch.type };
          if (ch.minVersion?.trim()) c.minVersion = ch.minVersion;
          if (ch.maxVersion?.trim()) c.maxVersion = ch.maxVersion;
          if (ch.shortestPath === true) c.shortestPath = true;
          return c;
        }),
      };
    }

    config.mirror.operators.forEach(operator => {
      clean.mirror.operators.push({
        catalog: operator.catalog,
        packages: operator.packages.map(pkg => ({
          name: pkg.name,
          channels: pkg.channels.map(ch => {
            const c: CleanOperatorChannel = { name: ch.name };
            if (ch.minVersion?.trim()) c.minVersion = ch.minVersion;
            if (ch.maxVersion?.trim()) c.maxVersion = ch.maxVersion;
            return c;
          }),
        })),
      });
    });

    return clean;
  }, [config]);

  const validateConfiguration = (): string[] => {
    const errors: string[] = [];
    const hasPlatform = config.mirror.platform.channels.length > 0;
    const hasOps = config.mirror.operators.length > 0;
    const hasImages = config.mirror.additionalImages.length > 0;

    if (!hasPlatform && !hasOps && !hasImages) {
      errors.push('At least one platform channel, operator, or additional image is required');
    }

    config.mirror.platform.channels.forEach((ch, i) => {
      if (!ch.name) errors.push(`Platform channel ${i + 1} must have a name`);
    });

    config.mirror.operators.forEach((op, oIdx) => {
      if (!op.catalog) errors.push(`Operator ${oIdx + 1} must have a catalog`);
      if (!op.packages.length) errors.push(`Operator ${oIdx + 1} must have at least one package`);
      op.packages.forEach((pkg, pIdx) => {
        if (!pkg.name)
          errors.push(`Package ${pIdx + 1} in operator ${oIdx + 1} must have a name`);
      });
    });

    return errors;
  };

  const saveConfiguration = async () => {
    try {
      setLoading(true);
      const yamlString = YAML.stringify(generateCleanConfig());
      const configName = customConfigName.trim()
        ? `${customConfigName.trim()}.yaml`
        : generateDefaultConfigName();

      await axios.post('/api/config/save', { config: yamlString, name: configName });
      addSuccessAlert('Configuration saved successfully!');
      setCustomConfigName('');
      setShowCustomNameInput(false);
    } catch (error) {
      console.error('Error saving configuration:', error);
      addDangerAlert('Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  const downloadConfiguration = () => {
    const yamlString = YAML.stringify(generateCleanConfig());
    const blob = new Blob([yamlString], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generateDefaultConfigName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    const errors = validateConfiguration();
    if (errors.length > 0) {
      errors.forEach(e => addDangerAlert(e));
      return;
    }
    await saveConfiguration();
  };

  const resetUploadState = () => {
    setUploadFilename('');
    setUploadedContent('');
    setParsedUpload(null);
    setUploadError('');
  };

  const parseYAMLContent = (content: string) => {
    try {
      const parsed = YAML.parse(content);
      if (!parsed?.kind || parsed.kind !== 'ImageSetConfiguration') {
        setUploadError('Invalid YAML: Must be an ImageSetConfiguration');
        setParsedUpload(null);
        return;
      }
      if (!parsed?.apiVersion?.includes('mirror.openshift.io')) {
        setUploadError('Invalid YAML: Must have mirror.openshift.io API version');
        setParsedUpload(null);
        return;
      }
      if (!parsed?.mirror) {
        setUploadError('Invalid YAML: Missing mirror section');
        setParsedUpload(null);
        return;
      }
      setParsedUpload(parsed);
      setUploadError('');
    } catch (err: any) {
      setUploadError(`Invalid YAML: ${err.message}`);
      setParsedUpload(null);
    }
  };

  const handleFileChange = (_: any, file: File) => {
    if (!file) return;
    if (!file.name.endsWith('.yaml') && !file.name.endsWith('.yml')) {
      setUploadError('Please upload a YAML file (.yaml or .yml)');
      return;
    }
    setUploadFilename(file.name);
    setIsUploadLoading(true);
    const reader = new FileReader();
    reader.onload = e => {
      const content = e.target?.result as string;
      setUploadedContent(content);
      parseYAMLContent(content);
      setIsUploadLoading(false);
    };
    reader.readAsText(file);
  };

  const handleTextAreaChange = (value: string) => {
    setUploadedContent(value);
    if (value.trim()) {
      parseYAMLContent(value);
    } else {
      setParsedUpload(null);
      setUploadError('');
    }
  };

  const loadIntoEditor = () => {
    if (!parsedUpload) {
      addDangerAlert('No valid configuration to load');
      return;
    }

    const mirror = parsedUpload.mirror || {};

    const platformChannels: PlatformChannel[] = (mirror.platform?.channels || []).map(
      (ch: any) => ({
        name: ch.name || '',
        minVersion: ch.minVersion || '',
        maxVersion: ch.maxVersion || '',
        type: ch.type || 'ocp',
        shortestPath: ch.shortestPath || false,
      }),
    );

    const operators: OperatorCatalog[] = (mirror.operators || []).map((op: any) => ({
      catalog: op.catalog || '',
      catalogVersion: op.catalog?.split(':').pop() || '',
      availableOperators: [],
      packages: (op.packages || []).map((pkg: any) => ({
        name: pkg.name || '',
        channels: (pkg.channels || []).map((ch: any) => ({
          name: ch.name || '',
          minVersion: ch.minVersion || '',
          maxVersion: ch.maxVersion || '',
        })),
      })),
    }));

    const additionalImages: { name: string }[] = (mirror.additionalImages || []).map(
      (img: any) => ({ name: img.name || '' }),
    );

    const archiveSize =
      parsedUpload.archiveSize != null ? String(parsedUpload.archiveSize) : '';

    setConfig({
      kind: parsedUpload.kind || 'ImageSetConfiguration',
      apiVersion: parsedUpload.apiVersion || 'mirror.openshift.io/v2alpha1',
      archiveSize,
      mirror: {
        platform: {
          channels: platformChannels,
          graph: mirror.platform?.graph ?? true,
        },
        operators,
        additionalImages,
        helm: { repositories: [] },
      },
    });

    setTimeout(async () => {
      for (const op of operators) {
        if (op.catalog) {
          const ops = await fetchOperatorsForCatalog(op.catalog);
          setConfig(prev => ({
            ...prev,
            mirror: {
              ...prev.mirror,
              operators: prev.mirror.operators.map(o =>
                o.catalog === op.catalog ? { ...o, availableOperators: ops } : o,
              ),
            },
          }));
          for (const pkg of op.packages) {
            if (pkg.name) {
              await fetchOperatorChannels(pkg.name, op.catalog);
            }
          }
        }
      }
    }, 0);

    setActiveTab('platform');
    addSuccessAlert('Configuration loaded into editor. Switch between tabs to modify.');
  };

  const saveUploadedConfig = async () => {
    if (!parsedUpload || !uploadFilename) {
      addDangerAlert('No valid configuration to save');
      return;
    }

    let filename = uploadFilename || `config-${Date.now()}.yaml`;
    if (!filename.endsWith('.yaml') && !filename.endsWith('.yml')) {
      filename = `${filename}.yaml`;
    }

    try {
      setUploading(true);
      await axios.post('/api/config/upload', { filename, content: uploadedContent });
      addSuccessAlert('Configuration uploaded successfully!');
      resetUploadState();
    } catch (err: any) {
      if (err.response?.status === 409) {
        setConflictFilename(filename);
        setConflictModalOpen(true);
      } else {
        console.error('Error saving configuration:', err);
        addDangerAlert(
          'Failed to save configuration: ' + (err.response?.data?.message || err.message),
        );
      }
    } finally {
      setUploading(false);
    }
  };

  const handleOverwriteConfirm = async () => {
    try {
      setUploading(true);
      setConflictModalOpen(false);
      await axios.post('/api/config/save', { config: uploadedContent, name: conflictFilename });
      addSuccessAlert('Configuration uploaded and overwritten successfully!');
      resetUploadState();
    } catch (err: any) {
      console.error('Error saving configuration:', err);
      addDangerAlert(
        'Failed to save configuration: ' + (err.response?.data?.message || err.message),
      );
    } finally {
      setUploading(false);
    }
  };

  const handleAutoRename = async () => {
    try {
      setUploading(true);
      setConflictModalOpen(false);
      const nameNoExt = conflictFilename.replace(/\.(yaml|yml)$/, '');
      const newName = `${nameNoExt}-${Date.now()}.yaml`;
      await axios.post('/api/config/upload', { filename: newName, content: uploadedContent });
      addSuccessAlert(`Configuration uploaded as "${newName}"!`);
      resetUploadState();
    } catch (err: any) {
      console.error('Error saving configuration:', err);
      addDangerAlert(
        'Failed to save configuration: ' + (err.response?.data?.message || err.message),
      );
    } finally {
      setUploading(false);
    }
  };

  const yamlPreview = YAML.stringify(generateCleanConfig(), { indent: 2 });

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>
            <Title headingLevel="h2">
              <CogIcon /> Mirror Configuration
            </Title>
          </CardTitle>
        </CardHeader>
        <CardBody>
          Configure and manage ImageSetConfiguration files for oc-mirror v2 operations.
        </CardBody>
      </Card>

      <br />

      <Card>
        <CardBody>
          <Tabs
            activeKey={activeTab}
            onSelect={(_e, key) => setActiveTab(key)}
            isFilled
          >
            <Tab
              eventKey="platform"
              title={
                <>
                  <TabTitleIcon><ServerIcon /></TabTitleIcon>
                  <TabTitleText>Platform Channels</TabTitleText>
                </>
              }
            >
              <br />
              <Title headingLevel="h3"><ServerIcon /> Platform Channels</Title>
              <p>Configure OpenShift Container Platform channels to mirror.</p>

              {config.mirror.platform.channels.map((channel, index) => (
                <Card key={index} isCompact style={{ marginBottom: '1rem' }}>
                  <CardHeader
                    actions={{
                      actions: (
                        <Button
                          variant="danger"
                          icon={<TrashIcon />}
                          onClick={() => removePlatformChannel(index)}
                        >
                          Remove
                        </Button>
                      ),
                    }}
                  >
                    <CardTitle>Channel {index + 1}</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <Grid hasGutter>
                      <GridItem span={3}>
                        <FormGroup label="Channel Name" fieldId={`platform-ch-name-${index}`}>
                          <FormSelect
                            id={`platform-ch-name-${index}`}
                            value={channel.name}
                            onChange={(_e, val) => updatePlatformChannel(index, 'name', val)}
                          >
                            {OCP_VERSIONS.map(v => (
                              <FormSelectOption
                                key={v}
                                value={`stable-${v}`}
                                label={`stable-${v}`}
                              />
                            ))}
                          </FormSelect>
                        </FormGroup>
                      </GridItem>
                      <GridItem span={3}>
                        <FormGroup
                          label="Min Version (optional)"
                          fieldId={`platform-ch-min-${index}`}
                        >
                          <TextInput
                            id={`platform-ch-min-${index}`}
                            value={channel.minVersion}
                            onChange={(_e, val) => updatePlatformChannel(index, 'minVersion', val)}
                            onBlur={() => validatePlatformChannel(index)}
                            placeholder="e.g., 4.16.0"
                          />
                        </FormGroup>
                      </GridItem>
                      <GridItem span={3}>
                        <FormGroup
                          label="Max Version (optional)"
                          fieldId={`platform-ch-max-${index}`}
                        >
                          <TextInput
                            id={`platform-ch-max-${index}`}
                            value={channel.maxVersion}
                            onChange={(_e, val) => updatePlatformChannel(index, 'maxVersion', val)}
                            onBlur={() => validatePlatformChannel(index)}
                            placeholder="e.g., 4.16.10"
                          />
                        </FormGroup>
                      </GridItem>
                      <GridItem span={3}>
                        <FormGroup
                          label="Options"
                          fieldId={`platform-ch-opts-${index}`}
                        >
                          <Checkbox
                            id={`platform-ch-sp-${index}`}
                            label="Shortest Path"
                            isChecked={channel.shortestPath || false}
                            onChange={(_e, checked) =>
                              updatePlatformChannel(index, 'shortestPath', checked)
                            }
                          />
                          <HelperText>
                            <HelperTextItem>
                              Find the most direct upgrade path between versions.
                            </HelperTextItem>
                          </HelperText>
                        </FormGroup>
                      </GridItem>
                    </Grid>
                  </CardBody>
                </Card>
              ))}

              <Button
                variant="primary"
                icon={<PlusCircleIcon />}
                onClick={addPlatformChannel}
              >
                Add Platform Channel
              </Button>
            </Tab>

            <Tab
              eventKey="operators"
              title={
                <>
                  <TabTitleIcon><CogIcon /></TabTitleIcon>
                  <TabTitleText>Operators</TabTitleText>
                </>
              }
            >
              <br />
              <Title headingLevel="h3"><CogIcon /> Operators</Title>
              <p>Configure operator catalogs and packages to mirror.</p>

              {loading && <Spinner size="lg" />}

              {config.mirror.operators.map((operator, opIndex) => (
                <Card key={opIndex} isCompact style={{ marginBottom: '1rem' }}>
                  <CardHeader
                    actions={{
                      actions: (
                        <Button
                          variant="danger"
                          icon={<TrashIcon />}
                          onClick={() => removeOperator(opIndex)}
                        >
                          Remove
                        </Button>
                      ),
                    }}
                  >
                    <CardTitle>Operator Catalog {opIndex + 1}</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <FormGroup label="Catalog" fieldId={`op-catalog-${opIndex}`}>
                      <FormSelect
                        id={`op-catalog-${opIndex}`}
                        value={operator.catalog}
                        onChange={async (_e, val) => {
                          const newCatalog = val;
                          const version = newCatalog.split(':').pop();
                          const ops = await fetchOperatorsForCatalog(newCatalog);
                          setConfig(prev => ({
                            ...prev,
                            mirror: {
                              ...prev.mirror,
                              operators: prev.mirror.operators.map((op, i) =>
                                i === opIndex
                                  ? {
                                      ...op,
                                      catalog: newCatalog,
                                      catalogVersion: version,
                                      availableOperators: ops,
                                    }
                                  : op,
                              ),
                            },
                          }));
                        }}
                      >
                        {operatorCatalogs.map(cat => (
                          <FormSelectOption
                            key={cat.url}
                            value={cat.url}
                            label={`${cat.name} (OCP ${cat.url.split(':').pop()}) - ${cat.description}`}
                          />
                        ))}
                      </FormSelect>
                    </FormGroup>

                    <br />
                    <Title headingLevel="h5"><BundleIcon /> Operators</Title>

                    {operator.packages.map((pkg, pkgIndex) => (
                      <Card key={pkgIndex} isCompact isFlat style={{ marginBottom: '1rem' }}>
                        <CardHeader
                          actions={{
                            actions: (
                              <Button
                                variant="danger"
                                icon={<TrashIcon />}
                                onClick={() => removePackageFromOperator(opIndex, pkgIndex)}
                                isSmall
                              >
                                Remove
                              </Button>
                            ),
                          }}
                        >
                          <CardTitle>
                            <Split hasGutter>
                              <SplitItem>Operator {pkgIndex + 1}</SplitItem>
                              {pkg.isDependency && pkg.autoAddedBy && (
                                <SplitItem>
                                  <Badge isRead>
                                    Auto-added for {pkg.autoAddedBy}
                                  </Badge>
                                </SplitItem>
                              )}
                            </Split>
                          </CardTitle>
                        </CardHeader>
                        <CardBody>
                          <FormGroup label="Operator Name" fieldId={`op-pkg-name-${opIndex}-${pkgIndex}`}>
                            <FormSelect
                              id={`op-pkg-name-${opIndex}-${pkgIndex}`}
                              value={pkg.name}
                              onChange={(_e, val) =>
                                updateOperatorPackage(opIndex, pkgIndex, 'name', val)
                              }
                            >
                              <FormSelectOption value="" label="Select an operator..." />
                              {(operator.availableOperators || [])
                                .slice()
                                .sort((a, b) => a.localeCompare(b))
                                .map(name => (
                                  <FormSelectOption key={name} value={name} label={name} />
                                ))}
                            </FormSelect>
                          </FormGroup>

                          {pkg.name && (() => {
                            const dOps = detailedOperators[operator.catalog];
                            const info = dOps?.find(o => o.name === pkg.name);
                            if (!info) return null;
                            return (
                              <Card isFlat isCompact style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                                <CardBody>
                                  <Split hasGutter>
                                    <SplitItem>
                                      <span style={{ fontWeight: 600 }}>Default Channel:</span>
                                    </SplitItem>
                                    <SplitItem>
                                      <Label color="green">{info.defaultChannel}</Label>
                                    </SplitItem>
                                  </Split>
                                  <br />
                                  <span style={{ fontWeight: 600 }}>
                                    All Available Channels ({info.allChannels?.length || 0}):
                                  </span>
                                  <HelperText>
                                    <HelperTextItem>
                                      Click on channels to add them to your selection
                                    </HelperTextItem>
                                  </HelperText>
                                  <Flex style={{ marginTop: '0.5rem' }}>
                                    {info.allChannels?.map((ch, idx) => {
                                      const isDefault = ch === info.defaultChannel;
                                      const isSelected = pkg.channels?.some(c => c.name === ch);
                                      return (
                                        <FlexItem key={idx}>
                                          <Label
                                            color={isDefault ? 'green' : 'grey'}
                                            onClick={() => {
                                              if (!isSelected) {
                                                addChannelToPackage(opIndex, pkgIndex, ch);
                                              }
                                            }}
                                            style={{
                                              cursor: isSelected ? 'default' : 'pointer',
                                              opacity: isSelected ? 0.5 : 1,
                                            }}
                                          >
                                            {ch}
                                          </Label>
                                        </FlexItem>
                                      );
                                    })}
                                  </Flex>
                                </CardBody>
                              </Card>
                            );
                          })()}

                          <FormGroup
                            label={`Channels for ${pkg.name || 'this operator'}`}
                            fieldId={`op-pkg-channels-${opIndex}-${pkgIndex}`}
                          >
                            {pkg.channels?.map((channel, chIdx) => {
                              const dOps = detailedOperators[operator.catalog];
                              const info = dOps?.find(o => o.name === pkg.name);
                              const versions = getChannelVersions(opIndex, pkgIndex, channel.name);

                              return (
                                <Flex
                                  key={chIdx}
                                  alignItems={{ default: 'alignItemsFlexEnd' }}
                                  style={{ marginBottom: '0.5rem' }}
                                >
                                  <FlexItem>
                                    <FormGroup label="Channel" fieldId={`ch-sel-${opIndex}-${pkgIndex}-${chIdx}`}>
                                      <FormSelect
                                        id={`ch-sel-${opIndex}-${pkgIndex}-${chIdx}`}
                                        value={channel.name}
                                        onChange={(_e, val) =>
                                          updateOperatorPackageChannel(opIndex, pkgIndex, chIdx, val)
                                        }
                                        style={{ minWidth: '180px' }}
                                      >
                                        <FormSelectOption value="" label="Select a channel..." />
                                        {info?.allChannels?.map(ch => (
                                          <FormSelectOption
                                            key={ch}
                                            value={ch}
                                            label={
                                              ch === info.defaultChannel
                                                ? `${ch} (default)`
                                                : ch
                                            }
                                          />
                                        ))}
                                      </FormSelect>
                                    </FormGroup>
                                  </FlexItem>
                                  <FlexItem>
                                    <FormGroup label="Min Version" fieldId={`ch-min-${opIndex}-${pkgIndex}-${chIdx}`}>
                                      <FormSelect
                                        id={`ch-min-${opIndex}-${pkgIndex}-${chIdx}`}
                                        value={channel.minVersion || ''}
                                        onChange={(_e, val) =>
                                          updateOperatorPackageChannelVersion(
                                            opIndex, pkgIndex, chIdx, 'minVersion', val,
                                          )
                                        }
                                        style={{ width: '160px' }}
                                      >
                                        <FormSelectOption value="" label="Select version..." />
                                        {versions.map(v => (
                                          <FormSelectOption key={v} value={v} label={v} />
                                        ))}
                                      </FormSelect>
                                    </FormGroup>
                                  </FlexItem>
                                  <FlexItem>
                                    <FormGroup label="Max Version" fieldId={`ch-max-${opIndex}-${pkgIndex}-${chIdx}`}>
                                      <FormSelect
                                        id={`ch-max-${opIndex}-${pkgIndex}-${chIdx}`}
                                        value={channel.maxVersion || ''}
                                        onChange={(_e, val) =>
                                          updateOperatorPackageChannelVersion(
                                            opIndex, pkgIndex, chIdx, 'maxVersion', val,
                                          )
                                        }
                                        style={{ width: '160px' }}
                                      >
                                        <FormSelectOption value="" label="Select version..." />
                                        {versions.map(v => (
                                          <FormSelectOption key={v} value={v} label={v} />
                                        ))}
                                      </FormSelect>
                                    </FormGroup>
                                  </FlexItem>
                                  <FlexItem>
                                    <Button
                                      variant="danger"
                                      icon={<TrashIcon />}
                                      onClick={() =>
                                        removeOperatorPackageChannel(opIndex, pkgIndex, chIdx)
                                      }
                                      isSmall
                                    >
                                      Remove
                                    </Button>
                                  </FlexItem>
                                </Flex>
                              );
                            })}
                          </FormGroup>
                        </CardBody>
                      </Card>
                    ))}

                    <Button
                      variant="secondary"
                      icon={<PlusCircleIcon />}
                      onClick={() => addPackageToOperator(opIndex)}
                    >
                      Add Operator
                    </Button>
                  </CardBody>
                </Card>
              ))}

              <Button variant="primary" icon={<PlusCircleIcon />} onClick={addOperator}>
                Add Operator Catalog
              </Button>
            </Tab>

            <Tab
              eventKey="images"
              title={
                <>
                  <TabTitleIcon><CubesIcon /></TabTitleIcon>
                  <TabTitleText>Additional Images</TabTitleText>
                </>
              }
            >
              <br />
              <Title headingLevel="h3"><CubesIcon /> Additional Images</Title>
              <p>Add additional container images to mirror.</p>

              {config.mirror.additionalImages.map((image, index) => (
                <Card key={index} isCompact style={{ marginBottom: '1rem' }}>
                  <CardHeader
                    actions={{
                      actions: (
                        <Button
                          variant="danger"
                          icon={<TrashIcon />}
                          onClick={() => removeAdditionalImage(index)}
                        >
                          Remove
                        </Button>
                      ),
                    }}
                  >
                    <CardTitle>Image {index + 1}</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <FormGroup label="Image Name" fieldId={`img-name-${index}`}>
                      <TextInput
                        id={`img-name-${index}`}
                        value={image.name}
                        onChange={(_e, val) => updateAdditionalImage(index, val)}
                        placeholder="registry.redhat.io/example/image:tag"
                      />
                    </FormGroup>
                  </CardBody>
                </Card>
              ))}

              <Button variant="primary" icon={<PlusCircleIcon />} onClick={addAdditionalImage}>
                Add Image
              </Button>
            </Tab>

            <Tab
              eventKey="preview"
              title={
                <>
                  <TabTitleIcon><EyeIcon /></TabTitleIcon>
                  <TabTitleText>Preview</TabTitleText>
                </>
              }
            >
              <br />
              <Split hasGutter>
                <SplitItem isFilled>
                  <Title headingLevel="h3"><EyeIcon /> Configuration Preview</Title>
                  <p>Preview the generated YAML configuration.</p>
                </SplitItem>
                <SplitItem>
                  <Button
                    variant="secondary"
                    icon={<CopyIcon />}
                    onClick={() => {
                      navigator.clipboard.writeText(yamlPreview);
                      addSuccessAlert('YAML configuration copied to clipboard!');
                    }}
                  >
                    Copy YAML
                  </Button>
                </SplitItem>
              </Split>

              <Card isFlat isCompact style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                <CardBody>
                  <FormGroup
                    label="Archive Size (GiB)"
                    fieldId="archive-size"
                    labelIcon={
                      <Popover
                        bodyContent="Maximum size (in GiB) for archive files when mirroring to disk. Leave empty to use default behavior."
                      >
                        <Button variant="plain" aria-label="Archive size help">
                          <OutlinedQuestionCircleIcon />
                        </Button>
                      </Popover>
                    }
                  >
                    <TextInput
                      id="archive-size"
                      type="number"
                      value={config.archiveSize}
                      onChange={(_e, val) =>
                        setConfig(prev => ({ ...prev, archiveSize: val }))
                      }
                      placeholder="e.g., 4"
                      style={{ maxWidth: '200px' }}
                    />
                  </FormGroup>
                </CardBody>
              </Card>

              <CodeBlock>
                <CodeBlockCode id="yaml-preview">{yamlPreview}</CodeBlockCode>
              </CodeBlock>
            </Tab>

            <Tab
              eventKey="upload"
              title={
                <>
                  <TabTitleIcon><UploadIcon /></TabTitleIcon>
                  <TabTitleText>Load Configuration</TabTitleText>
                </>
              }
            >
              <br />
              <Title headingLevel="h3"><UploadIcon /> Load YAML Configuration</Title>
              <p>
                Upload an existing ImageSetConfiguration YAML file, review and edit it, then
                either save it to the server or load it into the form editor for further
                modification.
              </p>

              <Card isFlat isCompact style={{ marginTop: '1rem' }}>
                <CardBody>
                  <FormGroup label="Upload YAML File" fieldId="yaml-file-upload">
                    <FileUpload
                      id="yaml-file-upload"
                      type="text"
                      value={uploadedContent}
                      filename={uploadFilename}
                      filenamePlaceholder="Drag and drop a .yaml file or click to browse"
                      onFileInputChange={handleFileChange}
                      onClearClick={() => resetUploadState()}
                      isLoading={isUploadLoading}
                      browseButtonText="Browse"
                      clearButtonText="Clear"
                      hideDefaultPreview
                      dropzoneProps={{
                        accept: { 'text/yaml': ['.yaml', '.yml'] },
                      }}
                    />
                  </FormGroup>

                  {uploadError && (
                    <Alert
                      variant={AlertVariant.danger}
                      isInline
                      title={uploadError}
                      style={{ marginTop: '1rem' }}
                    />
                  )}

                  {parsedUpload && (
                    <Alert
                      variant={AlertVariant.success}
                      isInline
                      title="Valid ImageSetConfiguration detected"
                      style={{ marginTop: '1rem' }}
                    >
                      <DescriptionList isHorizontal isCompact>
                        <DescriptionListGroup>
                          <DescriptionListTerm>Kind</DescriptionListTerm>
                          <DescriptionListDescription>{parsedUpload.kind}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>API Version</DescriptionListTerm>
                          <DescriptionListDescription>{parsedUpload.apiVersion}</DescriptionListDescription>
                        </DescriptionListGroup>
                        {parsedUpload.mirror?.platform?.channels && (
                          <DescriptionListGroup>
                            <DescriptionListTerm>Platform Channels</DescriptionListTerm>
                            <DescriptionListDescription>{parsedUpload.mirror.platform.channels.length}</DescriptionListDescription>
                          </DescriptionListGroup>
                        )}
                        {parsedUpload.mirror?.operators && (
                          <DescriptionListGroup>
                            <DescriptionListTerm>Operators</DescriptionListTerm>
                            <DescriptionListDescription>{parsedUpload.mirror.operators.length}</DescriptionListDescription>
                          </DescriptionListGroup>
                        )}
                        {parsedUpload.mirror?.additionalImages && (
                          <DescriptionListGroup>
                            <DescriptionListTerm>Additional Images</DescriptionListTerm>
                            <DescriptionListDescription>{parsedUpload.mirror.additionalImages.length}</DescriptionListDescription>
                          </DescriptionListGroup>
                        )}
                      </DescriptionList>
                    </Alert>
                  )}

                  {uploadedContent && (
                    <FormGroup
                      label="YAML Content (editable)"
                      fieldId="yaml-editor"
                      style={{ marginTop: '1rem' }}
                    >
                      <TextArea
                        id="yaml-editor"
                        value={uploadedContent}
                        onChange={(_e, val) => handleTextAreaChange(val)}
                        rows={18}
                        resizeOrientation="vertical"
                        aria-label="YAML editor"
                        style={{ fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace", fontSize: '13px' }}
                      />
                    </FormGroup>
                  )}

                  <Split hasGutter style={{ marginTop: '1rem' }}>
                    <SplitItem>
                      <Button
                        variant="primary"
                        icon={<ArrowRightIcon />}
                        onClick={loadIntoEditor}
                        isDisabled={!parsedUpload}
                      >
                        Load into Editor
                      </Button>
                    </SplitItem>
                    <SplitItem>
                      <Button
                        variant="secondary"
                        icon={<SaveIcon />}
                        onClick={saveUploadedConfig}
                        isDisabled={!parsedUpload || uploading}
                        isLoading={uploading}
                      >
                        Save Configuration
                      </Button>
                    </SplitItem>
                    <SplitItem>
                      <Button variant="link" onClick={resetUploadState}>
                        Clear
                      </Button>
                    </SplitItem>
                  </Split>
                </CardBody>
              </Card>
            </Tab>
          </Tabs>
        </CardBody>
      </Card>

      <br />
      <Card>
        <CardHeader>
          <CardTitle>
            <Title headingLevel="h3">Actions</Title>
          </CardTitle>
        </CardHeader>
        <CardBody>
          <Flex direction={{ default: 'column' }} gap={{ default: 'gapMd' }}>
            <FlexItem>
              <Split hasGutter>
                <SplitItem>
                  <Button
                    variant="primary"
                    icon={<SaveIcon />}
                    onClick={handleSave}
                    isDisabled={loading}
                    isLoading={loading}
                  >
                    Save Configuration
                  </Button>
                </SplitItem>
                <SplitItem>
                  <Button
                    variant="secondary"
                    icon={<DownloadIcon />}
                    onClick={downloadConfiguration}
                  >
                    Download YAML
                  </Button>
                </SplitItem>
                <SplitItem>
                  <Button
                    variant="link"
                    onClick={() => setShowCustomNameInput(!showCustomNameInput)}
                  >
                    {showCustomNameInput ? 'Cancel Rename' : 'Rename'}
                  </Button>
                </SplitItem>
              </Split>
            </FlexItem>

            {showCustomNameInput && (
              <FlexItem>
                <FormGroup fieldId="custom-config-name" label="Custom configuration name">
                  <TextInput
                    id="custom-config-name"
                    value={customConfigName}
                    onChange={(_e, val) => setCustomConfigName(val)}
                    placeholder="Enter name (without .yaml extension)"
                  />
                </FormGroup>
              </FlexItem>
            )}

            <FlexItem>
              <HelperText>
                <HelperTextItem>
                  {showCustomNameInput && customConfigName.trim()
                    ? `Will save as: ${customConfigName.trim()}.yaml`
                    : `Default name: ${generateDefaultConfigName()}`}
                </HelperTextItem>
              </HelperText>
            </FlexItem>
          </Flex>
        </CardBody>
      </Card>

      <Modal
        variant={ModalVariant.small}
        title="File Already Exists"
        titleIconVariant="warning"
        isOpen={conflictModalOpen}
        onClose={() => setConflictModalOpen(false)}
        actions={[
          <Button
            key="cancel"
            variant="link"
            onClick={() => setConflictModalOpen(false)}
            isDisabled={uploading}
          >
            Cancel
          </Button>,
          <Button
            key="rename"
            variant="warning"
            onClick={handleAutoRename}
            isDisabled={uploading}
            isLoading={uploading}
          >
            Auto-rename
          </Button>,
          <Button
            key="overwrite"
            variant="danger"
            onClick={handleOverwriteConfirm}
            isDisabled={uploading}
            isLoading={uploading}
          >
            Overwrite
          </Button>,
        ]}
      >
        <p>
          Configuration file <span style={{ fontWeight: 600 }}>&quot;{conflictFilename}&quot;</span> already exists.
        </p>
        <p>Choose how you want to save this configuration:</p>
      </Modal>
    </div>
  );
};

export default MirrorConfig;
