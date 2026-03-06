import { useState, useEffect, useCallback, useRef } from 'react';
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
  Select,
  SelectOption,
  SelectList,
  MenuToggle,
  TextInputGroup,
  TextInputGroupMain,
  TextInputGroupUtilities,
} from '@patternfly/react-core';
import { TimesIcon } from '@patternfly/react-icons';
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
  InfoCircleIcon,
  SaveIcon,
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

type VersionField = 'minVersion' | 'maxVersion';

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

const getMajorMinor = (version: string): string => {
  const parts = version.split('.');
  return `${parts[0]}.${parts[1]}`;
};

const getChannelVersionLine = (channelName: string): string | undefined => {
  const match = channelName.match(/(\d+\.\d+)/);
  return match ? match[1] : undefined;
};

const getPlatformChannelValidationMessage = (channel: PlatformChannel): string => {
  const channelLine = getChannelVersionLine(channel.name);

  if (channel.minVersion) {
    if (!isValidVersion(channel.minVersion)) {
      return 'Min version must be a valid version like 4.16.0';
    }
    if (channelLine && getMajorMinor(channel.minVersion) !== channelLine) {
      return `Min version must match channel ${channelLine}.x (e.g., ${channelLine}.0)`;
    }
  }

  if (channel.maxVersion) {
    if (!isValidVersion(channel.maxVersion)) {
      return 'Max version must be a valid version like 4.16.0';
    }
    if (channelLine && getMajorMinor(channel.maxVersion) !== channelLine) {
      return `Max version must match channel ${channelLine}.x (e.g., ${channelLine}.0)`;
    }
  }

  if (channel.minVersion && channel.maxVersion) {
    const validation = validateVersionRange(channel.minVersion, channel.maxVersion, []);
    if (!validation.isValid) {
      return validation.message;
    }
  }

  return '';
};

const getOperatorChannelValidationMessage = (
  channel: OperatorChannel,
  versions: string[],
): string => {
  if (channel.minVersion && !isValidVersion(channel.minVersion)) {
    return 'Min version must be a valid version';
  }

  if (channel.maxVersion && !isValidVersion(channel.maxVersion)) {
    return 'Max version must be a valid version';
  }

  if (channel.minVersion && channel.maxVersion) {
    const validation = validateVersionRange(channel.minVersion, channel.maxVersion, versions);
    if (!validation.isValid) {
      return validation.message;
    }
  }

  return '';
};

const getSelectableVersions = (
  versions: string[],
  field: VersionField,
  channel: OperatorChannel,
): string[] => {
  const minNum =
    channel.minVersion && isValidVersion(channel.minVersion)
      ? versionToNumber(channel.minVersion)
      : undefined;
  const maxNum =
    channel.maxVersion && isValidVersion(channel.maxVersion)
      ? versionToNumber(channel.maxVersion)
      : undefined;

  return versions.filter(version => {
    const versionNum = versionToNumber(version);

    if (field === 'minVersion' && maxNum !== undefined) {
      return versionNum <= maxNum;
    }

    if (field === 'maxVersion' && minNum !== undefined) {
      return versionNum >= minNum;
    }

    return true;
  });
};

const sanitizeArchiveSizeInput = (value: string): string => value.replace(/\D+/g, '');

const getArchiveSizeValidationMessage = (value: string): string => {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '';
  }

  if (!/^\d+$/.test(trimmedValue)) {
    return 'Archive size must contain digits only';
  }

  if (Number.parseInt(trimmedValue, 10) <= 0) {
    return 'Archive size must be greater than 0';
  }

  return '';
};

const clearMismatchedPlatformVersions = (channel: PlatformChannel): PlatformChannel => {
  const channelLine = getChannelVersionLine(channel.name);
  if (!channelLine) return channel;

  return {
    ...channel,
    minVersion:
      channel.minVersion &&
      isValidVersion(channel.minVersion) &&
      getMajorMinor(channel.minVersion) !== channelLine
        ? ''
        : channel.minVersion,
    maxVersion:
      channel.maxVersion &&
      isValidVersion(channel.maxVersion) &&
      getMajorMinor(channel.maxVersion) !== channelLine
        ? ''
        : channel.maxVersion,
  };
};

const sanitizePlatformChannelValue = (
  channel: PlatformChannel,
  field: VersionField,
): { channel: PlatformChannel; message: string } => {
  const value = channel[field];
  if (!value) {
    return { channel, message: '' };
  }

  const channelLine = getChannelVersionLine(channel.name);
  const label = field === 'minVersion' ? 'Min version' : 'Max version';

  if (!isValidVersion(value)) {
    return {
      channel: { ...channel, [field]: '' },
      message: `${label} must be a valid version like ${channelLine ? `${channelLine}.0` : '4.16.0'}`,
    };
  }

  if (channelLine && getMajorMinor(value) !== channelLine) {
    return {
      channel: { ...channel, [field]: '' },
      message: `${label} must match channel ${channelLine}.x (e.g., ${channelLine}.0)`,
    };
  }

  const otherField: VersionField = field === 'minVersion' ? 'maxVersion' : 'minVersion';
  const otherValue = channel[otherField];

  if (otherValue && isValidVersion(otherValue)) {
    const validation = validateVersionRange(
      field === 'minVersion' ? value : otherValue,
      field === 'maxVersion' ? value : otherValue,
      [],
    );

    if (!validation.isValid) {
      return {
        channel: { ...channel, [field]: '' },
        message: validation.message,
      };
    }
  }

  return { channel, message: '' };
};

const InfoPopoverButton = ({
  ariaLabel,
  bodyContent,
}: {
  ariaLabel: string;
  bodyContent: React.ReactNode;
}) => (
  <Popover bodyContent={bodyContent}>
    <Button
      variant="plain"
      aria-label={ariaLabel}
      hasNoPadding
      type="button"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 'auto',
        height: '1.25rem',
        lineHeight: 1,
        color: 'var(--pf-t--global--text--color--regular, #151515)',
      }}
    >
      <InfoCircleIcon style={{ fontSize: '0.875rem' }} />
    </Button>
  </Popover>
);

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
  const [isEditingPreview, setIsEditingPreview] = useState(false);
  const [editedYaml, setEditedYaml] = useState('');
  const [showCustomNameInput, setShowCustomNameInput] = useState(false);

  const [operatorSelectOpen, setOperatorSelectOpen] = useState<Record<string, boolean>>({});
  const [operatorFilterText, setOperatorFilterText] = useState<Record<string, string>>({});
  const operatorFilterInputRef = useRef<Record<string, HTMLInputElement | null>>({});

  const [uploadFilename, setUploadFilename] = useState('');
  const [uploadedContent, setUploadedContent] = useState('');
  const [parsedUpload, setParsedUpload] = useState<Record<string, any> | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [isUploadLoading, setIsUploadLoading] = useState(false);

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
      const channelDetails = Array.isArray(response.data?.channels)
        ? response.data.channels
        : Array.isArray(response.data)
          ? response.data
          : [];

      const allChannels = Array.isArray(response.data?.allChannels)
        ? response.data.allChannels
        : channelDetails
            .map((channel: { name?: string }) => channel?.name)
            .filter((channel: string | undefined): channel is string => Boolean(channel));

      if (channelDetails.length > 0) {
        setAvailableVersions(prev => {
          const next = { ...prev };
          channelDetails.forEach((channel: { name?: string; availableVersions?: string[] }) => {
            if (channel?.name && Array.isArray(channel.availableVersions)) {
              next[`${operatorName}:${channel.name}:${catalogUrl}`] = channel.availableVersions;
            }
          });
          return next;
        });
      }

      setOperatorChannels(prev => ({ ...prev, [key]: allChannels }));
      return allChannels;
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
        params: { catalog: catalogUrl, channel: channelName },
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

  const getStoredChannelVersions = (
    catalogUrl: string,
    packageName: string,
    channelName: string,
  ): string[] => {
    if (!catalogUrl || !packageName || !channelName) return [];
    return availableVersions[`${packageName}:${channelName}:${catalogUrl}`] || [];
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
    const versions = getStoredChannelVersions(operator.catalog, packageName, channelName);

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
    if (field === 'name' && typeof value === 'string') {
      const currentChannel = config.mirror.platform.channels[index];
      const updatedChannel = clearMismatchedPlatformVersions({
        ...currentChannel,
        name: value,
      });

      const clearedMin = Boolean(currentChannel?.minVersion && !updatedChannel.minVersion);
      const clearedMax = Boolean(currentChannel?.maxVersion && !updatedChannel.maxVersion);

      setConfig(prev => ({
        ...prev,
        mirror: {
          ...prev.mirror,
          platform: {
            ...prev.mirror.platform,
            channels: prev.mirror.platform.channels.map((ch, i) =>
              i === index ? updatedChannel : ch,
            ),
          },
        },
      }));

      if (clearedMin || clearedMax) {
        addInfoAlert('Platform Channel: Cleared versions that do not match the selected channel');
      }
      return;
    }

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

  const validatePlatformChannel = (index: number, field: VersionField) => {
    const channel = config.mirror.platform.channels[index];
    if (!channel) return;

    const result = sanitizePlatformChannelValue(channel, field);
    if (result.channel !== channel) {
      setConfig(prev => ({
        ...prev,
        mirror: {
          ...prev.mirror,
          platform: {
            ...prev.mirror.platform,
            channels: prev.mirror.platform.channels.map((ch, i) =>
              i === index ? result.channel : ch,
            ),
          },
        },
      }));
    }

    if (result.message) {
      addDangerAlert(`Platform Channel: ${result.message}`);
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
                          cIdx === channelIndex
                            ? { ...ch, name: value, minVersion: '', maxVersion: '' }
                            : ch,
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
    field: VersionField,
    value: string,
  ) => {
    const operator = config.mirror.operators[operatorIndex];
    const pkg = operator?.packages[packageIndex];
    const channel = pkg?.channels[channelIndex];
    if (!operator || !pkg || !channel) return;

    const nextChannel = { ...channel, [field]: value };
    const versions = getStoredChannelVersions(operator.catalog, pkg.name, nextChannel.name);
    const validationMessage = getOperatorChannelValidationMessage(nextChannel, versions);

    if (validationMessage) {
      addDangerAlert(`Operator Channel: ${validationMessage}`);
      return;
    }

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
                          cIdx === channelIndex ? nextChannel : ch,
                        ),
                      }
                    : pkg,
                ),
              }
            : op,
        ),
      },
    }));
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

    const archiveSizeValue = config.archiveSize.trim();
    if (archiveSizeValue && !getArchiveSizeValidationMessage(archiveSizeValue)) {
      clean.archiveSize = Number.parseInt(archiveSizeValue, 10);
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

  const validateConfiguration = (currentConfig: ImageSetConfig = config): string[] => {
    const errors: string[] = [];
    const hasPlatform = currentConfig.mirror.platform.channels.length > 0;
    const hasOps = currentConfig.mirror.operators.length > 0;
    const hasImages = currentConfig.mirror.additionalImages.length > 0;
    const archiveSizeValidationMessage = getArchiveSizeValidationMessage(
      currentConfig.archiveSize,
    );

    if (!hasPlatform && !hasOps && !hasImages) {
      errors.push('At least one platform channel, operator, or additional image is required');
    }

    if (archiveSizeValidationMessage) {
      errors.push(archiveSizeValidationMessage);
    }

    currentConfig.mirror.platform.channels.forEach((ch, i) => {
      if (!ch.name) errors.push(`Platform channel ${i + 1} must have a name`);
      const validationMessage = getPlatformChannelValidationMessage(ch);
      if (validationMessage) {
        errors.push(`Platform channel ${i + 1} (${ch.name || 'unnamed'}): ${validationMessage}`);
      }
    });

    currentConfig.mirror.operators.forEach((op, oIdx) => {
      if (!op.catalog) errors.push(`Operator ${oIdx + 1} must have a catalog`);
      if (!op.packages.length) errors.push(`Operator ${oIdx + 1} must have at least one package`);
      op.packages.forEach((pkg, pIdx) => {
        if (!pkg.name)
          errors.push(`Package ${pIdx + 1} in operator ${oIdx + 1} must have a name`);
        pkg.channels.forEach((ch, chIdx) => {
          if (!ch.name) {
            errors.push(
              `Channel ${chIdx + 1} in package ${pkg.name || pIdx + 1} of operator ${oIdx + 1} must have a name`,
            );
            return;
          }

          const validationMessage = getOperatorChannelValidationMessage(
            ch,
            getStoredChannelVersions(op.catalog, pkg.name, ch.name),
          );
          if (validationMessage) {
            errors.push(
              `Channel ${ch.name} in package ${pkg.name || pIdx + 1} of operator ${oIdx + 1}: ${validationMessage}`,
            );
          }
        });
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
    const errors = validateConfiguration();
    if (errors.length > 0) {
      errors.forEach(e => addDangerAlert(e));
      return;
    }

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

    const nextConfig: ImageSetConfig = {
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
    };

    const errors = validateConfiguration(nextConfig);
    if (errors.length > 0) {
      errors.forEach(e => addDangerAlert(e));
      return;
    }

    setConfig(nextConfig);

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

  const yamlPreview = YAML.stringify(generateCleanConfig(), { indent: 2 });
  const startEditingPreview = () => {
    setEditedYaml(yamlPreview);
    setIsEditingPreview(true);
  };

  const cancelEditingPreview = () => {
    setIsEditingPreview(false);
    setEditedYaml('');
  };

  const applyPreviewEdits = () => {
    try {
      const parsed = YAML.parse(editedYaml);

      if (!parsed || parsed.kind !== 'ImageSetConfiguration') {
        addDangerAlert('Invalid YAML: Must be an ImageSetConfiguration');
        return;
      }
      if (!parsed.apiVersion?.includes('mirror.openshift.io')) {
        addDangerAlert('Invalid YAML: Must have mirror.openshift.io API version');
        return;
      }
      if (!parsed.mirror) {
        addDangerAlert('Invalid YAML: Missing mirror section');
        return;
      }

      const mirror = parsed.mirror || {};
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
      const archiveSize = parsed.archiveSize != null ? String(parsed.archiveSize) : '';

      const nextConfig: ImageSetConfig = {
        kind: parsed.kind,
        apiVersion: parsed.apiVersion,
        archiveSize,
        mirror: {
          platform: { channels: platformChannels, graph: mirror.platform?.graph ?? true },
          operators,
          additionalImages,
          helm: { repositories: [] },
        },
      };

      const errors = validateConfiguration(nextConfig);
      if (errors.length > 0) {
        errors.forEach(e => addDangerAlert(e));
        return;
      }

      setConfig(nextConfig);

      setIsEditingPreview(false);
      setEditedYaml('');
      addSuccessAlert('YAML changes applied to form editor');
    } catch (err: any) {
      addDangerAlert(`Invalid YAML: ${err.message}`);
    }
  };

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
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                <Title headingLevel="h3" style={{ margin: 0 }}>
                  <ServerIcon /> Platform Channels
                </Title>
                <InfoPopoverButton
                  ariaLabel="Platform channel version guidance"
                  bodyContent={
                    <div>
                      Use full OpenShift versions like `4.16.0` and `4.16.10`.
                      Leave both fields empty to mirror the entire channel.
                      Min and max must stay within the selected channel line, and
                      min cannot be greater than max.
                    </div>
                  }
                />
              </div>
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
                            onBlur={() => validatePlatformChannel(index, 'minVersion')}
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
                            onBlur={() => validatePlatformChannel(index, 'maxVersion')}
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
                style={{ marginTop: '1rem' }}
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
                      <Card key={pkgIndex} isCompact isPlain style={{ marginBottom: '1rem' }}>
                        <CardHeader
                          actions={{
                            actions: (
                              <Button
                                variant="danger"
                                icon={<TrashIcon />}
                                onClick={() => removePackageFromOperator(opIndex, pkgIndex)}
                                size="sm"
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
                            {(() => {
                              const selectKey = `${opIndex}-${pkgIndex}`;
                              const isOpen = operatorSelectOpen[selectKey] || false;
                              const filterText = operatorFilterText[selectKey] || '';
                              const sorted = (operator.availableOperators || []).slice().sort((a, b) => a.localeCompare(b));
                              const filtered = filterText
                                ? sorted.filter(n => n.toLowerCase().includes(filterText.toLowerCase()))
                                : sorted;

                              const onToggle = () => {
                                setOperatorSelectOpen(prev => ({ ...prev, [selectKey]: !prev[selectKey] }));
                                if (!isOpen) {
                                  setTimeout(() => operatorFilterInputRef.current[selectKey]?.focus(), 0);
                                }
                              };

                              const onSelect = (_e: any, value: string | number | undefined) => {
                                if (value) {
                                  updateOperatorPackage(opIndex, pkgIndex, 'name', String(value));
                                }
                                setOperatorSelectOpen(prev => ({ ...prev, [selectKey]: false }));
                                setOperatorFilterText(prev => ({ ...prev, [selectKey]: '' }));
                              };

                              const onFilterChange = (_e: any, value: string) => {
                                setOperatorFilterText(prev => ({ ...prev, [selectKey]: value }));
                                if (!isOpen) {
                                  setOperatorSelectOpen(prev => ({ ...prev, [selectKey]: true }));
                                }
                              };

                              const onClear = () => {
                                setOperatorFilterText(prev => ({ ...prev, [selectKey]: '' }));
                                updateOperatorPackage(opIndex, pkgIndex, 'name', '');
                                operatorFilterInputRef.current[selectKey]?.focus();
                              };

                              const toggle = (toggleRef: React.Ref<any>) => (
                                <MenuToggle
                                  ref={toggleRef}
                                  variant="typeahead"
                                  onClick={onToggle}
                                  isExpanded={isOpen}
                                  isFullWidth
                                >
                                  <TextInputGroup isPlain>
                                    <TextInputGroupMain
                                      value={isOpen ? filterText : (pkg.name || filterText)}
                                      onChange={onFilterChange}
                                      onClick={() => {
                                        if (!isOpen) setOperatorSelectOpen(prev => ({ ...prev, [selectKey]: true }));
                                      }}
                                      ref={(el: HTMLInputElement | null) => {
                                        operatorFilterInputRef.current[selectKey] = el;
                                      }}
                                      placeholder="Type to search operators..."
                                      autoComplete="off"
                                    />
                                    {(pkg.name || filterText) && (
                                      <TextInputGroupUtilities>
                                        <Button variant="plain" onClick={onClear} aria-label="Clear">
                                          <TimesIcon />
                                        </Button>
                                      </TextInputGroupUtilities>
                                    )}
                                  </TextInputGroup>
                                </MenuToggle>
                              );

                              return (
                                <Select
                                  id={`op-pkg-name-${opIndex}-${pkgIndex}`}
                                  isOpen={isOpen}
                                  selected={pkg.name || undefined}
                                  onSelect={onSelect}
                                  onOpenChange={(open) =>
                                    setOperatorSelectOpen(prev => ({ ...prev, [selectKey]: open }))
                                  }
                                  toggle={toggle}
                                  shouldFocusFirstItemOnOpen={false}
                                >
                                  <SelectList style={{ maxHeight: '300px', overflow: 'auto' }}>
                                    {filtered.length > 0 ? (
                                      filtered.map(name => (
                                        <SelectOption key={name} value={name}>
                                          {name}
                                        </SelectOption>
                                      ))
                                    ) : (
                                      <SelectOption isDisabled>No results found</SelectOption>
                                    )}
                                  </SelectList>
                                </Select>
                              );
                            })()}
                          </FormGroup>

                          {pkg.name && (() => {
                            const dOps = detailedOperators[operator.catalog];
                            const info = dOps?.find(o => o.name === pkg.name);
                            if (!info) return null;
                            return (
                              <Card isPlain isCompact style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
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
                              const minVersionOptions = getSelectableVersions(
                                versions,
                                'minVersion',
                                channel,
                              );
                              const maxVersionOptions = getSelectableVersions(
                                versions,
                                'maxVersion',
                                channel,
                              );

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
                                        {minVersionOptions.map(v => (
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
                                        {maxVersionOptions.map(v => (
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
                                      size="sm"
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

              <Button variant="primary" icon={<PlusCircleIcon />} onClick={addOperator} style={{ marginTop: '1rem' }}>
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

              <Button variant="primary" icon={<PlusCircleIcon />} onClick={addAdditionalImage} style={{ marginTop: '1rem' }}>
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
                  <p>Preview and edit the generated YAML configuration.</p>
                </SplitItem>
                <SplitItem>
                  <Split hasGutter>
                    <SplitItem>
                      <Button
                        variant="secondary"
                        icon={<CopyIcon />}
                        onClick={() => {
                          navigator.clipboard.writeText(isEditingPreview ? editedYaml : yamlPreview);
                          addSuccessAlert('YAML configuration copied to clipboard!');
                        }}
                      >
                        Copy YAML
                      </Button>
                    </SplitItem>
                    {!isEditingPreview && (
                      <SplitItem>
                        <Button variant="secondary" onClick={startEditingPreview}>
                          Edit
                        </Button>
                      </SplitItem>
                    )}
                  </Split>
                </SplitItem>
              </Split>

              <Card
                isPlain
                isCompact
                style={{ marginTop: '1rem', marginBottom: '1.5rem', overflow: 'visible' }}
              >
                <CardBody style={{ padding: 0 }}>
                  <Grid hasGutter>
                    <GridItem span={3}>
                      <FormGroup
                        label={
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                            }}
                          >
                            <span>Archive Size (GiB)</span>
                            <InfoPopoverButton
                              ariaLabel="Archive size guidance"
                              bodyContent={
                                <div>
                                  Maximum size in GiB for each archive when mirroring to disk.
                                  Leave this blank to use the default behavior.
                                </div>
                              }
                            />
                          </span>
                        }
                        fieldId="archive-size"
                      >
                        <TextInput
                          id="archive-size"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={config.archiveSize}
                          onChange={(_e, val) =>
                            setConfig(prev => ({
                              ...prev,
                              archiveSize: sanitizeArchiveSizeInput(val),
                            }))
                          }
                        />
                      </FormGroup>
                    </GridItem>
                  </Grid>
                </CardBody>
              </Card>

              {isEditingPreview ? (
                <>
                  <TextArea
                    id="yaml-preview-editor"
                    value={editedYaml}
                    onChange={(_e, val) => setEditedYaml(val)}
                    aria-label="YAML configuration editor"
                    style={{
                      fontFamily: 'var(--pf-v6-global--FontFamily--mono, "Red Hat Mono", monospace)',
                      fontSize: '0.875rem',
                      minHeight: '400px',
                      lineHeight: 1.5,
                      resize: 'vertical',
                    }}
                  />
                  <Split hasGutter style={{ marginTop: '0.5rem' }}>
                    <SplitItem>
                      <Button variant="primary" onClick={applyPreviewEdits}>
                        Apply Changes
                      </Button>
                    </SplitItem>
                    <SplitItem>
                      <Button variant="link" onClick={cancelEditingPreview}>
                        Cancel
                      </Button>
                    </SplitItem>
                  </Split>
                </>
              ) : (
                <CodeBlock>
                  <CodeBlockCode id="yaml-preview">{yamlPreview}</CodeBlockCode>
                </CodeBlock>
              )}
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

              <Card isPlain isCompact style={{ marginTop: '1rem' }}>
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
              <div style={{ fontSize: '1rem' }}>
                {showCustomNameInput && customConfigName.trim()
                  ? `Will save as: ${customConfigName.trim()}.yaml`
                  : generateDefaultConfigName()}
              </div>
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
          </Flex>
        </CardBody>
      </Card>

    </div>
  );
};

export default MirrorConfig;
