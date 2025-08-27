import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import axios from 'axios';

const Settings = () => {
  const [settings, setSettings] = useState({
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
  });
  const [systemInfo, setSystemInfo] = useState({
    ocMirrorVersion: '',
    ocVersion: '',
    systemArchitecture: '',
    availableDiskSpace: '',
    totalDiskSpace: ''
  });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  useEffect(() => {
    fetchSettings();
    fetchSystemInfo();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await axios.get('/api/settings');
      setSettings(response.data);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error fetching settings:', error);
    }
  };

  const fetchSystemInfo = async () => {
    try {
      const response = await axios.get('/api/system/info');
      setSystemInfo(response.data);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error fetching system info:', error);
    }
  };

  const saveSettings = async () => {
    try {
      setLoading(true);
      await axios.post('/api/settings', settings);
      toast.success('Settings saved successfully!');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const testRegistryConnection = async () => {
    try {
      setLoading(true);
      await axios.post('/api/settings/test-registry', settings.registryCredentials);
      toast.success('Registry connection successful!');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error testing registry connection:', error);
      toast.error('Registry connection failed');
    } finally {
      setLoading(false);
    }
  };

  const cleanupOldLogs = async () => {
    try {
      setLoading(true);
      await axios.post('/api/settings/cleanup-logs');
      toast.success('Log cleanup completed successfully!');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error cleaning up logs:', error);
      toast.error('Failed to cleanup logs');
    } finally {
      setLoading(false);
    }
  };

  const resetSettings = () => {
    if (window.confirm('Are you sure you want to reset all settings to default values?')) {
      setSettings({
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
      });
      toast.success('Settings reset to defaults');
    }
  };

  const updateSetting = (path, value) => {
    const keys = path.split('.');
    setSettings(prev => {
      const newSettings = { ...prev };
      let current = newSettings;
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return newSettings;
    });
  };

  const formatBytes = (bytes) => {
    if (!bytes) return 'Unknown';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  return (
    <div className="container">
      <div className="card">
        <h2>🔧 Settings</h2>
        <p className="text-muted">
          Configure application settings and system preferences.
        </p>
      </div>

      <div className="card">
        <div className="nav-tabs">
          <div 
            className={`nav-tab ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            ⚙️ General
          </div>
          <div 
            className={`nav-tab ${activeTab === 'registry' ? 'active' : ''}`}
            onClick={() => setActiveTab('registry')}
          >
            🏢 Registry
          </div>
          <div 
            className={`nav-tab ${activeTab === 'proxy' ? 'active' : ''}`}
            onClick={() => setActiveTab('proxy')}
          >
            🌐 Proxy
          </div>
          <div 
            className={`nav-tab ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
          >
            🖥️ System
          </div>
        </div>

        <div className={`tab-content ${activeTab === 'general' ? 'active' : ''}`}>
          <h3>⚙️ General Settings</h3>
          
          <div className="form-group">
            <label>📝 Note: oc-mirror v2 uses a cache system instead of metadata storage</label>
            <p className="text-muted">The application will automatically manage the cache location for oc-mirror v2 operations.</p>
          </div>

          <div className="form-group">
            <label>🔄 Max Concurrent Operations</label>
            <input 
              type="number" 
              className="form-control"
              value={settings.maxConcurrentOperations}
              onChange={(e) => updateSetting('maxConcurrentOperations', parseInt(e.target.value))}
              min="1"
              max="5"
            />
            <small className="text-muted">Maximum number of mirror operations that can run simultaneously</small>
          </div>

          <div className="form-group">
            <label>📅 Log Retention (Days)</label>
            <input 
              type="number" 
              className="form-control"
              value={settings.logRetentionDays}
              onChange={(e) => updateSetting('logRetentionDays', parseInt(e.target.value))}
              min="1"
              max="365"
            />
            <small className="text-muted">Number of days to keep operation logs</small>
          </div>

          <div className="form-group">
            <label>
              <input 
                type="checkbox" 
                checked={settings.autoCleanup}
                onChange={(e) => updateSetting('autoCleanup', e.target.checked)}
                style={{ marginRight: '0.5rem' }}
              />
              🧹 Enable Auto Cleanup
            </label>
            <small className="text-muted">Automatically clean up old logs and temporary files</small>
          </div>
        </div>

        <div className={`tab-content ${activeTab === 'registry' ? 'active' : ''}`}>
          <h3>🏢 Registry Settings</h3>
          
          <div className="form-group">
            <label>🌐 Registry URL</label>
            <input 
              type="text" 
              className="form-control"
              value={settings.registryCredentials.registry}
              onChange={(e) => updateSetting('registryCredentials.registry', e.target.value)}
              placeholder="registry.redhat.io"
            />
          </div>

          <div className="form-group">
            <label>👤 Username</label>
            <input 
              type="text" 
              className="form-control"
              value={settings.registryCredentials.username}
              onChange={(e) => updateSetting('registryCredentials.username', e.target.value)}
              placeholder="Your registry username"
            />
          </div>

          <div className="form-group">
            <label>🔑 Password/Token</label>
            <input 
              type="password" 
              className="form-control"
              value={settings.registryCredentials.password}
              onChange={(e) => updateSetting('registryCredentials.password', e.target.value)}
              placeholder="Your registry password or token"
            />
          </div>

          <button 
            className="btn btn-secondary"
            onClick={testRegistryConnection}
            disabled={loading || !settings.registryCredentials.registry}
          >
            🔍 Test Connection
          </button>
        </div>

        <div className={`tab-content ${activeTab === 'proxy' ? 'active' : ''}`}>
          <h3>🌐 Proxy Settings</h3>
          
          <div className="form-group">
            <label>
              <input 
                type="checkbox" 
                checked={settings.proxySettings.enabled}
                onChange={(e) => updateSetting('proxySettings.enabled', e.target.checked)}
                style={{ marginRight: '0.5rem' }}
              />
              🌐 Enable Proxy
            </label>
          </div>

          {settings.proxySettings.enabled && (
            <>
              <div className="grid">
                <div className="form-group">
                  <label>🏠 Proxy Host</label>
                  <input 
                    type="text" 
                    className="form-control"
                    value={settings.proxySettings.host}
                    onChange={(e) => updateSetting('proxySettings.host', e.target.value)}
                    placeholder="proxy.example.com"
                  />
                </div>

                <div className="form-group">
                  <label>🔌 Proxy Port</label>
                  <input 
                    type="number" 
                    className="form-control"
                    value={settings.proxySettings.port}
                    onChange={(e) => updateSetting('proxySettings.port', e.target.value)}
                    placeholder="8080"
                  />
                </div>
              </div>

              <div className="grid">
                <div className="form-group">
                  <label>👤 Proxy Username (optional)</label>
                  <input 
                    type="text" 
                    className="form-control"
                    value={settings.proxySettings.username}
                    onChange={(e) => updateSetting('proxySettings.username', e.target.value)}
                    placeholder="proxy_username"
                  />
                </div>

                <div className="form-group">
                  <label>🔑 Proxy Password (optional)</label>
                  <input 
                    type="password" 
                    className="form-control"
                    value={settings.proxySettings.password}
                    onChange={(e) => updateSetting('proxySettings.password', e.target.value)}
                    placeholder="proxy_password"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <div className={`tab-content ${activeTab === 'system' ? 'active' : ''}`}>
          <h3>🖥️ System Information</h3>
          
          <div className="grid">
            <div className="card">
              <h4>🔄 OC Mirror Version</h4>
              <p className="text-muted">{systemInfo.ocMirrorVersion || 'Not available'}</p>
            </div>
            
            <div className="card">
              <h4>⚙️ OC Version</h4>
              <p className="text-muted">{systemInfo.ocVersion || 'Not available'}</p>
            </div>
            
            <div className="card">
              <h4>🏗️ System Architecture</h4>
              <p className="text-muted">{systemInfo.systemArchitecture || 'Not available'}</p>
            </div>
            
            <div className="card">
              <h4>💾 Available Disk Space</h4>
              <p className="text-muted">{formatBytes(systemInfo.availableDiskSpace)}</p>
            </div>
          </div>

          <div className="card" style={{ marginTop: '2rem' }}>
            <h4>⚡ System Actions</h4>
            <div className="flex">
              <button 
                className="btn btn-secondary"
                onClick={cleanupOldLogs}
                disabled={loading}
              >
                🧹 Cleanup Old Logs
              </button>
              <button 
                className="btn btn-secondary"
                onClick={fetchSystemInfo}
                disabled={loading}
              >
                🔄 Refresh System Info
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>⚡ Actions</h3>
        <div className="flex">
          <button 
            className="btn btn-primary" 
            onClick={saveSettings}
            disabled={loading}
          >
            {loading ? <div className="loading"></div> : '💾 Save Settings'}
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={resetSettings}
            disabled={loading}
          >
            🔄 Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings; 