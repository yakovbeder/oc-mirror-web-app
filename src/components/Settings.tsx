import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Card,
  CardBody,
  CardTitle,
  CardHeader,
  Tabs,
  Tab,
  TabTitleText,
  FormGroup,
  TextInput,
  NumberInput,
  Switch,
  Button,
  ActionGroup,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Grid,
  GridItem,
  Spinner,
  Title,
  HelperText,
  HelperTextItem,
  Alert,
  Modal,
  ModalVariant,
} from '@patternfly/react-core';
import {
  CogIcon,
  RegistryIcon,
  GlobeIcon,
  ServerIcon,
  SaveIcon,
  UndoIcon,
  SearchIcon,
  TrashAltIcon,
  RedoIcon,
} from '@patternfly/react-icons';
import { useAlerts } from '../AlertContext';

interface RegistryCredentials {
  username: string;
  password: string;
  registry: string;
}

interface ProxySettings {
  enabled: boolean;
  host: string;
  port: string;
  username: string;
  password: string;
}

interface Settings {
  maxConcurrentOperations: number;
  logRetentionDays: number;
  autoCleanup: boolean;
  registryCredentials: RegistryCredentials;
  proxySettings: ProxySettings;
}

interface SystemInfo {
  ocMirrorVersion: string;
  ocVersion: string;
  systemArchitecture: string;
  availableDiskSpace: string | number;
  totalDiskSpace: string | number;
}

const defaultSettings: Settings = {
  maxConcurrentOperations: 1,
  logRetentionDays: 30,
  autoCleanup: true,
  registryCredentials: {
    username: '',
    password: '',
    registry: '',
  },
  proxySettings: {
    enabled: false,
    host: '',
    port: '',
    username: '',
    password: '',
  },
};

const SettingsPage: React.FC = () => {
  const { addSuccessAlert, addDangerAlert } = useAlerts();

  const [settings, setSettings] = useState<Settings>({ ...defaultSettings });
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    ocMirrorVersion: '',
    ocVersion: '',
    systemArchitecture: '',
    availableDiskSpace: '',
    totalDiskSpace: '',
  });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string | number>('general');
  const [showResetModal, setShowResetModal] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchSystemInfo();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await axios.get('/api/settings');
      setSettings(response.data);
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  };

  const fetchSystemInfo = async () => {
    try {
      const response = await axios.get('/api/system/info');
      setSystemInfo(response.data);
    } catch (error) {
      console.error('Error fetching system info:', error);
    }
  };

  const saveSettings = async () => {
    try {
      setLoading(true);
      await axios.post('/api/settings', settings);
      addSuccessAlert('Settings saved successfully!');
    } catch (error) {
      console.error('Error saving settings:', error);
      addDangerAlert('Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const testRegistryConnection = async () => {
    try {
      setLoading(true);
      await axios.post('/api/settings/test-registry', settings.registryCredentials);
      addSuccessAlert('Registry connection successful!');
    } catch (error) {
      console.error('Error testing registry connection:', error);
      addDangerAlert('Registry connection failed');
    } finally {
      setLoading(false);
    }
  };

  const cleanupOldLogs = async () => {
    try {
      setLoading(true);
      await axios.post('/api/settings/cleanup-logs');
      addSuccessAlert('Log cleanup completed successfully!');
    } catch (error) {
      console.error('Error cleaning up logs:', error);
      addDangerAlert('Failed to cleanup logs');
    } finally {
      setLoading(false);
    }
  };

  const resetSettings = () => {
    setSettings({ ...defaultSettings });
    addSuccessAlert('Settings reset to defaults');
    setShowResetModal(false);
  };

  const updateSetting = (path: string, value: string | number | boolean) => {
    const keys = path.split('.');
    setSettings(prev => {
      const newSettings = JSON.parse(JSON.stringify(prev)) as Settings;
      let current: Record<string, unknown> = newSettings as unknown as Record<string, unknown>;
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]] as Record<string, unknown>;
      }
      current[keys[keys.length - 1]] = value;
      return newSettings;
    });
  };

  const formatBytes = (bytes: string | number) => {
    if (!bytes) return 'Unknown';
    const numBytes = typeof bytes === 'string' ? parseFloat(bytes) : bytes;
    if (isNaN(numBytes)) return String(bytes);
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(numBytes) / Math.log(1024));
    return `${(numBytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  return (
    <div>
      <Card>
        <CardBody>
          <Title headingLevel="h2">
            <CogIcon /> Settings
          </Title>
          <p>Configure application settings and system preferences.</p>
        </CardBody>
      </Card>

      <Card style={{ marginTop: '1rem' }}>
        <CardBody>
          <Tabs
            activeKey={activeTab}
            onSelect={(_event, tabIndex) => setActiveTab(tabIndex)}
            aria-label="Settings tabs"
          >
            <Tab
              eventKey="general"
              title={<TabTitleText><CogIcon /> General</TabTitleText>}
            >
              <div style={{ padding: '1.5rem 0' }}>
                <Title headingLevel="h3" style={{ marginBottom: '1rem' }}>General Settings</Title>

                <Alert
                  variant="info"
                  isInline
                  isPlain
                  title="oc-mirror v2 uses a cache system instead of metadata storage. The application will automatically manage the cache location for oc-mirror v2 operations."
                  style={{ marginBottom: '1.5rem' }}
                />

                <FormGroup
                  label="Max Concurrent Operations"
                  fieldId="max-concurrent"
                >
                  <NumberInput
                    id="max-concurrent"
                    value={settings.maxConcurrentOperations}
                    onMinus={() => updateSetting('maxConcurrentOperations', Math.max(1, settings.maxConcurrentOperations - 1))}
                    onPlus={() => updateSetting('maxConcurrentOperations', Math.min(5, settings.maxConcurrentOperations + 1))}
                    onChange={(event) => {
                      const val = parseInt((event.target as HTMLInputElement).value);
                      if (!isNaN(val)) updateSetting('maxConcurrentOperations', Math.max(1, Math.min(5, val)));
                    }}
                    min={1}
                    max={5}
                  />
                  <HelperText>
                    <HelperTextItem>Maximum number of mirror operations that can run simultaneously</HelperTextItem>
                  </HelperText>
                </FormGroup>

                <FormGroup
                  label="Log Retention (Days)"
                  fieldId="log-retention"
                  style={{ marginTop: '1rem' }}
                >
                  <NumberInput
                    id="log-retention"
                    value={settings.logRetentionDays}
                    onMinus={() => updateSetting('logRetentionDays', Math.max(1, settings.logRetentionDays - 1))}
                    onPlus={() => updateSetting('logRetentionDays', Math.min(365, settings.logRetentionDays + 1))}
                    onChange={(event) => {
                      const val = parseInt((event.target as HTMLInputElement).value);
                      if (!isNaN(val)) updateSetting('logRetentionDays', Math.max(1, Math.min(365, val)));
                    }}
                    min={1}
                    max={365}
                  />
                  <HelperText>
                    <HelperTextItem>Number of days to keep operation logs</HelperTextItem>
                  </HelperText>
                </FormGroup>

                <FormGroup
                  label="Auto Cleanup"
                  fieldId="auto-cleanup"
                  style={{ marginTop: '1rem' }}
                >
                  <Switch
                    id="auto-cleanup"
                    label="Enabled"
                    labelOff="Disabled"
                    isChecked={settings.autoCleanup}
                    onChange={(_event, checked) => updateSetting('autoCleanup', checked)}
                  />
                  <HelperText>
                    <HelperTextItem>Automatically clean up old logs and temporary files</HelperTextItem>
                  </HelperText>
                </FormGroup>
              </div>
            </Tab>

            <Tab
              eventKey="registry"
              title={<TabTitleText><RegistryIcon /> Registry</TabTitleText>}
            >
              <div style={{ padding: '1.5rem 0' }}>
                <Title headingLevel="h3" style={{ marginBottom: '1rem' }}>Registry Settings</Title>

                <FormGroup label="Registry URL" fieldId="registry-url">
                  <TextInput
                    id="registry-url"
                    value={settings.registryCredentials.registry}
                    onChange={(_event, value) => updateSetting('registryCredentials.registry', value)}
                    placeholder="registry.redhat.io"
                  />
                </FormGroup>

                <FormGroup label="Username" fieldId="registry-username" style={{ marginTop: '1rem' }}>
                  <TextInput
                    id="registry-username"
                    value={settings.registryCredentials.username}
                    onChange={(_event, value) => updateSetting('registryCredentials.username', value)}
                    placeholder="Your registry username"
                  />
                </FormGroup>

                <FormGroup label="Password / Token" fieldId="registry-password" style={{ marginTop: '1rem' }}>
                  <TextInput
                    id="registry-password"
                    type="password"
                    value={settings.registryCredentials.password}
                    onChange={(_event, value) => updateSetting('registryCredentials.password', value)}
                    placeholder="Your registry password or token"
                  />
                </FormGroup>

                <ActionGroup style={{ marginTop: '1.5rem' }}>
                  <Button
                    variant="secondary"
                    icon={<SearchIcon />}
                    onClick={testRegistryConnection}
                    isDisabled={loading || !settings.registryCredentials.registry}
                    isLoading={loading}
                  >
                    Test Connection
                  </Button>
                </ActionGroup>
              </div>
            </Tab>

            <Tab
              eventKey="proxy"
              title={<TabTitleText><GlobeIcon /> Proxy</TabTitleText>}
            >
              <div style={{ padding: '1.5rem 0' }}>
                <Title headingLevel="h3" style={{ marginBottom: '1rem' }}>Proxy Settings</Title>

                <FormGroup label="Enable Proxy" fieldId="proxy-enabled">
                  <Switch
                    id="proxy-enabled"
                    label="Enabled"
                    labelOff="Disabled"
                    isChecked={settings.proxySettings.enabled}
                    onChange={(_event, checked) => updateSetting('proxySettings.enabled', checked)}
                  />
                </FormGroup>

                {settings.proxySettings.enabled && (
                  <>
                    <Grid hasGutter style={{ marginTop: '1rem' }}>
                      <GridItem span={8}>
                        <FormGroup label="Proxy Host" fieldId="proxy-host">
                          <TextInput
                            id="proxy-host"
                            value={settings.proxySettings.host}
                            onChange={(_event, value) => updateSetting('proxySettings.host', value)}
                            placeholder="proxy.example.com"
                          />
                        </FormGroup>
                      </GridItem>
                      <GridItem span={4}>
                        <FormGroup label="Proxy Port" fieldId="proxy-port">
                          <TextInput
                            id="proxy-port"
                            type="number"
                            value={settings.proxySettings.port}
                            onChange={(_event, value) => updateSetting('proxySettings.port', value)}
                            placeholder="8080"
                          />
                        </FormGroup>
                      </GridItem>
                    </Grid>

                    <Grid hasGutter style={{ marginTop: '1rem' }}>
                      <GridItem span={6}>
                        <FormGroup label="Proxy Username (optional)" fieldId="proxy-username">
                          <TextInput
                            id="proxy-username"
                            value={settings.proxySettings.username}
                            onChange={(_event, value) => updateSetting('proxySettings.username', value)}
                            placeholder="proxy_username"
                          />
                        </FormGroup>
                      </GridItem>
                      <GridItem span={6}>
                        <FormGroup label="Proxy Password (optional)" fieldId="proxy-password">
                          <TextInput
                            id="proxy-password"
                            type="password"
                            value={settings.proxySettings.password}
                            onChange={(_event, value) => updateSetting('proxySettings.password', value)}
                            placeholder="proxy_password"
                          />
                        </FormGroup>
                      </GridItem>
                    </Grid>
                  </>
                )}
              </div>
            </Tab>

            <Tab
              eventKey="system"
              title={<TabTitleText><ServerIcon /> System</TabTitleText>}
            >
              <div style={{ padding: '1.5rem 0' }}>
                <Title headingLevel="h3" style={{ marginBottom: '1rem' }}>System Information</Title>

                <Grid hasGutter>
                  <GridItem span={6}>
                    <Card isPlain>
                      <CardHeader>
                        <CardTitle>OC Mirror Version</CardTitle>
                      </CardHeader>
                      <CardBody>{systemInfo.ocMirrorVersion || 'Not available'}</CardBody>
                    </Card>
                  </GridItem>
                  <GridItem span={6}>
                    <Card isPlain>
                      <CardHeader>
                        <CardTitle>OC Version</CardTitle>
                      </CardHeader>
                      <CardBody>{systemInfo.ocVersion || 'Not available'}</CardBody>
                    </Card>
                  </GridItem>
                  <GridItem span={6}>
                    <Card isPlain>
                      <CardHeader>
                        <CardTitle>System Architecture</CardTitle>
                      </CardHeader>
                      <CardBody>{systemInfo.systemArchitecture || 'Not available'}</CardBody>
                    </Card>
                  </GridItem>
                  <GridItem span={6}>
                    <Card isPlain>
                      <CardHeader>
                        <CardTitle>Available Disk Space</CardTitle>
                      </CardHeader>
                      <CardBody>{formatBytes(systemInfo.availableDiskSpace)}</CardBody>
                    </Card>
                  </GridItem>
                </Grid>

                <Card isPlain style={{ marginTop: '1.5rem' }}>
                  <CardHeader>
                    <CardTitle>System Actions</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <ActionGroup>
                      <Button
                        variant="secondary"
                        icon={<TrashAltIcon />}
                        onClick={cleanupOldLogs}
                        isDisabled={loading}
                        isLoading={loading}
                      >
                        Cleanup Old Logs
                      </Button>
                      <Button
                        variant="secondary"
                        icon={<RedoIcon />}
                        onClick={fetchSystemInfo}
                        isDisabled={loading}
                      >
                        Refresh System Info
                      </Button>
                    </ActionGroup>
                  </CardBody>
                </Card>
              </div>
            </Tab>
          </Tabs>
        </CardBody>
      </Card>

      <Card style={{ marginTop: '1rem' }}>
        <CardBody>
          <Title headingLevel="h3" style={{ marginBottom: '1rem' }}>Actions</Title>
          <ActionGroup>
            <Button
              variant="primary"
              icon={loading ? <Spinner size="md" /> : <SaveIcon />}
              onClick={saveSettings}
              isDisabled={loading}
              isLoading={loading}
            >
              Save Settings
            </Button>
            <Button
              variant="secondary"
              icon={<UndoIcon />}
              onClick={() => setShowResetModal(true)}
              isDisabled={loading}
            >
              Reset to Defaults
            </Button>
          </ActionGroup>
        </CardBody>
      </Card>

      <Modal
        variant={ModalVariant.small}
        title="Reset Settings"
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        actions={[
          <Button key="confirm" variant="danger" onClick={resetSettings}>
            Reset
          </Button>,
          <Button key="cancel" variant="link" onClick={() => setShowResetModal(false)}>
            Cancel
          </Button>,
        ]}
      >
        Are you sure you want to reset all settings to default values?
        <br /><br />
        <Alert variant="warning" isInline isPlain title="This will discard any unsaved changes." />
      </Modal>
    </div>
  );
};

export default SettingsPage;
