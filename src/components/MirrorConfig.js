import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import axios from 'axios';
import YAML from 'yaml';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';

const MirrorConfig = () => {
  const [config, setConfig] = useState({
    kind: 'ImageSetConfiguration',
    apiVersion: 'mirror.openshift.io/v2alpha1',
    mirror: {
      platform: {
        channels: [],
        graph: true
      },
      operators: [],
      additionalImages: [],
      helm: {
        repositories: []
      }
    }
  });

  const [availableChannels, setAvailableChannels] = useState([]);
  const [availableOperators, setAvailableOperators] = useState([]);
  const [availableCatalogs, setAvailableCatalogs] = useState([]);
  const [operatorChannels, setOperatorChannels] = useState({});
  const [detailedOperators, setDetailedOperators] = useState({}); // Store detailed operator info by catalog
  const [availableVersions, setAvailableVersions] = useState({}); // Store available versions by operator/channel
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('platform');

  const ocpVersions = [
    '4.15', '4.16', '4.17', '4.18', '4.19'
  ];

  const catalogVersions = [
    'v4.15', 'v4.16', 'v4.17', 'v4.18', 'v4.19'
  ];

  const architectures = [
    'amd64', 'arm64', 'ppc64le', 's390x'
  ];

  // Use dynamic catalogs from API, fallback to static if needed
  const operatorCatalogs = availableCatalogs.length > 0 ? availableCatalogs : [
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

  // Helper function to get catalog URL with version
  const getCatalogUrlWithVersion = (catalogUrl, version) => {
    if (catalogUrl.includes(':')) {
      return catalogUrl;
    }
    return `${catalogUrl}:v${version}`;
  };

  // Helper function to get catalog display name with version
  const getCatalogDisplayName = (catalog, version) => {
    if (catalog.ocpVersion) {
      return `${catalog.name} (OCP ${catalog.ocpVersion})`;
    }
    return `${catalog.name} (OCP ${version})`;
  };

  useEffect(() => {
    fetchAvailableData();
  }, []);

  // Memoize expensive operations
  const memoizedConfig = useMemo(() => config, [config]);

  const fetchAvailableData = async () => {
    try {
      setLoading(true);
      const [channelsRes, catalogsRes] = await Promise.all([
        axios.get('/api/channels'),
        axios.get('/api/catalogs')
      ]);
      setAvailableChannels(channelsRes.data);
      setAvailableCatalogs(catalogsRes.data);
      // Don't fetch operators here - we'll fetch them per catalog
    } catch (error) {
      console.error('Error fetching available data:', error);
      toast.error('Failed to load available channels and operators');
    } finally {
      setLoading(false);
    }
  };

  const fetchOperatorsForCatalog = async (catalogUrl) => {
    try {
      const response = await axios.get(`/api/operators?catalog=${encodeURIComponent(catalogUrl)}&detailed=true`);
      const detailedOps = response.data;
      
      // Store detailed operator information
      setDetailedOperators(prev => ({
        ...prev,
        [catalogUrl]: detailedOps
      }));
      
      // Return just the operator names for backward compatibility
      return detailedOps.map(op => op.name);
    } catch (error) {
      console.error('Error fetching operators for catalog:', error);
      return [];
    }
  };

  const fetchOperatorChannels = async (operatorName, catalogUrl) => {
    const key = `${operatorName}:${catalogUrl}`;
    if (operatorChannels[key]) {
      return operatorChannels[key];
    }
    
    try {
      const response = await axios.get(`/api/operator-channels/${operatorName}?catalogUrl=${encodeURIComponent(catalogUrl)}`);
      setOperatorChannels(prev => ({
        ...prev,
        [key]: response.data
      }));
      return response.data;
    } catch (error) {
      console.error(`Error fetching channels for ${operatorName} from ${catalogUrl}:`, error);
      toast.error(`Failed to load channels for ${operatorName}`);
      return ['stable'];
    }
  };

  const fetchChannelVersions = async (operatorName, channelName, catalogUrl) => {
    try {
      // Generate versions based on the channel name
      const versions = [];
      
      // Extract version numbers from channel name (e.g., "stable-6.3" -> "6.3.0", "6.3.1", etc.)
      const versionMatch = channelName.match(/(\d+)\.(\d+)/);
      if (versionMatch) {
        const major = versionMatch[1];
        const minor = versionMatch[2];
        
        // Generate a few version options
        for (let patch = 0; patch <= 5; patch++) {
          versions.push(`${major}.${minor}.${patch}`);
        }
      } else {
        // For channels without version numbers, provide some common options
        versions.push('1.0.0', '1.0.1', '1.0.2', '1.1.0', '1.1.1');
      }
      
      return versions;
    } catch (error) {
      console.error(`Error generating versions for ${operatorName}/${channelName}:`, error);
      return [];
    }
  };

  // Helper function to get versions for a channel (with fallback)
  const getChannelVersions = (operatorIndex, packageIndex, channelName) => {
    const operator = config.mirror.operators[operatorIndex];
    const packageName = config.mirror.operators[operatorIndex].packages[packageIndex].name;
    const key = `${packageName}:${channelName}:${operator.catalog}`;
    const versions = availableVersions[key] || [];
    
    // If no versions are loaded yet, generate some based on channel name
    if (versions.length === 0 && channelName) {
      const versionMatch = channelName.match(/(\d+)\.(\d+)/);
      if (versionMatch) {
        const major = versionMatch[1];
        const minor = versionMatch[2];
        const fallbackVersions = [];
        for (let patch = 0; patch <= 5; patch++) {
          fallbackVersions.push(`${major}.${minor}.${patch}`);
        }
        return fallbackVersions;
      } else {
        return ['1.0.0', '1.0.1', '1.0.2', '1.1.0', '1.1.1'];
      }
    }
    
    return versions;
  };



  const addPlatformChannel = () => {
    const newChannel = {
      name: `stable-${ocpVersions[0]}`,
      minVersion: '',
      maxVersion: '',
      type: 'ocp',
      shortestPath: false
    };
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        platform: {
          ...prev.mirror.platform,
          channels: [...prev.mirror.platform.channels, newChannel]
        }
      }
    }));
  };

  const removePlatformChannel = (index) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        platform: {
          ...prev.mirror.platform,
          channels: prev.mirror.platform.channels.filter((_, i) => i !== index)
        }
      }
    }));
  };

  const updatePlatformChannel = (index, field, value) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        platform: {
          ...prev.mirror.platform,
          channels: prev.mirror.platform.channels.map((channel, i) => 
            i === index ? { ...channel, [field]: value } : channel
          )
        }
      }
    }));
  };

  const addOperator = async () => {
    const defaultCatalog = operatorCatalogs[0]?.url || 'registry.redhat.io/redhat/redhat-operator-index:v4.15';
    const operators = await fetchOperatorsForCatalog(defaultCatalog);
    
    const newOperator = {
      catalog: defaultCatalog,
      catalogVersion: defaultCatalog.split(':').pop(),
      availableOperators: operators,
      packages: []
    };
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: [...prev.mirror.operators, newOperator]
      }
    }));
  };

  const removeOperator = (index) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.filter((_, i) => i !== index)
      }
    }));
  };

  const addPackageToOperator = (operatorIndex) => {
    const newPackage = {
      name: '',
      channels: []
    };
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) => 
          i === operatorIndex 
            ? { ...op, packages: [...op.packages, newPackage] }
            : op
        )
      }
    }));
  };

  const removePackageFromOperator = (operatorIndex, packageIndex) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) => 
          i === operatorIndex 
            ? { ...op, packages: op.packages.filter((_, pIndex) => pIndex !== packageIndex) }
            : op
        )
      }
    }));
  };

  const updateOperatorPackage = async (operatorIndex, packageIndex, field, value) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) => 
          i === operatorIndex 
            ? { 
                ...op, 
                packages: op.packages.map((pkg, pIndex) => 
                  pIndex === packageIndex ? { ...pkg, [field]: value } : pkg
                )
              }
            : op
        )
      }
    }));

    // If updating package name, fetch channels for the new package
    if (field === 'name' && value) {
      const operator = config.mirror.operators[operatorIndex];
      await fetchOperatorChannels(value, operator.catalog);
    }
  };



  const removeOperatorPackageChannel = (operatorIndex, packageIndex, channelIndex) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) => 
          i === operatorIndex 
            ? { 
                ...op, 
                packages: op.packages.map((pkg, pIndex) => 
                  pIndex === packageIndex 
                    ? { 
                        ...pkg, 
                        channels: (pkg.channels || []).filter((_, cIndex) => cIndex !== channelIndex)
                      } 
                    : pkg
                )
              }
            : op
        )
      }
    }));
  };

  const updateOperatorPackageChannel = async (operatorIndex, packageIndex, channelIndex, value) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) => 
          i === operatorIndex 
            ? { 
                ...op, 
                packages: op.packages.map((pkg, pIndex) => 
                  pIndex === packageIndex 
                    ? { 
                        ...pkg, 
                        channels: (pkg.channels || []).map((channel, cIndex) => 
                          cIndex === channelIndex ? { ...channel, name: value } : channel
                        )
                      } 
                    : pkg
                )
              }
            : op
        )
      }
    }));

    // Fetch available versions for the selected channel
    if (value) {
      const operator = config.mirror.operators[operatorIndex];
      const packageName = config.mirror.operators[operatorIndex].packages[packageIndex].name;
      
      if (operator && packageName) {
        const versions = await fetchChannelVersions(packageName, value, operator.catalog);
        const key = `${packageName}:${value}:${operator.catalog}`;
        setAvailableVersions(prev => ({
          ...prev,
          [key]: versions
        }));
      }
    }
  };

  const updateOperatorPackageChannelVersion = (operatorIndex, packageIndex, channelIndex, field, value) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) => 
          i === operatorIndex 
            ? { 
                ...op, 
                packages: op.packages.map((pkg, pIndex) => 
                  pIndex === packageIndex 
                    ? { 
                        ...pkg, 
                        channels: (pkg.channels || []).map((channel, cIndex) => 
                          cIndex === channelIndex ? { ...channel, [field]: value } : channel
                        )
                      } 
                    : pkg
                )
              }
            : op
        )
      }
    }));
  };

  const addAdditionalImage = () => {
    const newImage = {
      name: ''
    };
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        additionalImages: [...prev.mirror.additionalImages, newImage]
      }
    }));
  };

  const removeAdditionalImage = (index) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        additionalImages: prev.mirror.additionalImages.filter((_, i) => i !== index)
      }
    }));
  };

  const updateAdditionalImage = (index, value) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        additionalImages: prev.mirror.additionalImages.map((img, i) => 
          i === index ? { ...img, name: value } : img
        )
      }
    }));
  };

  const [customConfigName, setCustomConfigName] = useState('');
  const [showCustomNameInput, setShowCustomNameInput] = useState(false);

  const generateDefaultConfigName = () => {
    const now = new Date();
    const dateStr = now.toISOString()
      .replace(/T/, '-')
      .replace(/\..+/, '')
      .replace(/:/g, '-');
    return `imageset-config-${dateStr}-UTC.yaml`;
  };

  const saveConfiguration = async () => {
    try {
      setLoading(true);
      const yamlString = YAML.stringify(generateCleanConfig());
      
      // Use custom name if provided, otherwise use default date/time format
      const configName = customConfigName.trim() 
        ? `${customConfigName.trim()}.yaml`
        : generateDefaultConfigName();
      
      const response = await axios.post('/api/config/save', {
        config: yamlString,
        name: configName
      });
      
      toast.success('Configuration saved successfully!');
      console.log('Configuration saved:', response.data);
      
      // Reset custom name after successful save
      setCustomConfigName('');
      setShowCustomNameInput(false);
    } catch (error) {
      console.error('Error saving configuration:', error);
      toast.error('Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  // Function to generate clean YAML configuration for preview and download
  const generateCleanConfig = () => {
    const cleanConfig = {
      kind: 'ImageSetConfiguration',
      apiVersion: 'mirror.openshift.io/v2alpha1',
      mirror: {
        operators: [],
        additionalImages: config.mirror.additionalImages
      }
    };

    // Only add platform section if channels exist
    if (config.mirror.platform.channels && config.mirror.platform.channels.length > 0) {
      cleanConfig.mirror.platform = {
        graph: config.mirror.platform.graph,
        channels: config.mirror.platform.channels.map(channel => {
          const cleanChannel = {
            name: channel.name,
            type: channel.type
          };
          
          // Only add minVersion if it's not empty
          if (channel.minVersion && channel.minVersion.trim() !== '') {
            cleanChannel.minVersion = channel.minVersion;
          }
          
          // Only add maxVersion if it's not empty
          if (channel.maxVersion && channel.maxVersion.trim() !== '') {
            cleanChannel.maxVersion = channel.maxVersion;
          }
          
          // Only add shortestPath if it's true (don't show false)
          if (channel.shortestPath === true) {
            cleanChannel.shortestPath = true;
          }
          
          return cleanChannel;
        })
      };
    }

    // Clean up operators - remove catalogVersion and availableOperators, filter version fields
    config.mirror.operators.forEach(operator => {
      const cleanOperator = {
        catalog: operator.catalog,
        packages: operator.packages.map(pkg => ({
          name: pkg.name,
          channels: pkg.channels.map(channel => {
            const cleanChannel = {
              name: channel.name
            };
            
            // Only add minVersion if it's not empty
            if (channel.minVersion && channel.minVersion.trim() !== '') {
              cleanChannel.minVersion = channel.minVersion;
            }
            
            // Only add maxVersion if it's not empty
            if (channel.maxVersion && channel.maxVersion.trim() !== '') {
              cleanChannel.maxVersion = channel.maxVersion;
            }
            
            return cleanChannel;
          })
        }))
      };
      cleanConfig.mirror.operators.push(cleanOperator);
    });

    return cleanConfig;
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

  const validateConfiguration = () => {
    const errors = [];
    
    // Check if we have any content to mirror
    const hasPlatformChannels = config.mirror.platform.channels.length > 0;
    const hasOperators = config.mirror.operators.length > 0;
    const hasAdditionalImages = config.mirror.additionalImages.length > 0;
    
    if (!hasPlatformChannels && !hasOperators && !hasAdditionalImages) {
      errors.push('At least one platform channel, operator, or additional image is required');
    }
    
    // Validate platform channels if present
    config.mirror.platform.channels.forEach((channel, index) => {
      if (!channel.name) {
        errors.push(`Platform channel ${index + 1} must have a name`);
      }
    });
    
    // Validate operators if present
    config.mirror.operators.forEach((operator, opIndex) => {
      if (!operator.catalog) {
        errors.push(`Operator ${opIndex + 1} must have a catalog`);
      }
      if (!operator.packages.length) {
        errors.push(`Operator ${opIndex + 1} must have at least one package`);
      }
      operator.packages.forEach((pkg, pkgIndex) => {
        if (!pkg.name) {
          errors.push(`Package ${pkgIndex + 1} in operator ${opIndex + 1} must have a name`);
        }
      });
    });
    
    return errors;
  };

  const handleSave = async () => {
    const errors = validateConfiguration();
    if (errors.length > 0) {
      errors.forEach(error => toast.error(error));
      return;
    }
    await saveConfiguration();
  };

  return (
    <div className="container">
      <div className="card">
        <h2>⚙️ Mirror Configuration</h2>
        <p className="text-muted">
          Create and manage ImageSetConfiguration files for oc-mirror v2 operations.
        </p>
      </div>

      <div className="card">
        <div className="nav-tabs">
          <div 
            className={`nav-tab ${activeTab === 'platform' ? 'active' : ''}`}
            onClick={() => setActiveTab('platform')}
          >
            🖥️ Platform Channels
          </div>
          <div 
            className={`nav-tab ${activeTab === 'operators' ? 'active' : ''}`}
            onClick={() => setActiveTab('operators')}
          >
            ⚙️ Operators
          </div>
          <div 
            className={`nav-tab ${activeTab === 'images' ? 'active' : ''}`}
            onClick={() => setActiveTab('images')}
          >
            🖼️ Additional Images
          </div>
          <div 
            className={`nav-tab ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
          >
            👁️ Preview
          </div>
        </div>

        <div className={`tab-content ${activeTab === 'platform' ? 'active' : ''}`}>
          <h3>🖥️ Platform Channels</h3>
          <p className="text-muted">Configure OpenShift Container Platform channels to mirror.</p>
          
          {config.mirror.platform.channels.map((channel, index) => (
            <div key={index} className="card" style={{ marginBottom: '1rem' }}>
              <div className="flex-between">
                <h4>Channel {index + 1}</h4>
                <button 
                  className="btn btn-danger" 
                  onClick={() => removePlatformChannel(index)}
                >
                  Remove
                </button>
              </div>
              
              <div className="grid">
                <div className="form-group">
                  <label>Channel Name</label>
                  <select 
                    className="form-control"
                    value={channel.name}
                    onChange={(e) => updatePlatformChannel(index, 'name', e.target.value)}
                  >
                    {ocpVersions.map(version => (
                      <option key={version} value={`stable-${version}`}>
                        stable-{version}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Min Version (optional)</label>
                  <input 
                    type="text" 
                    className="form-control"
                    value={channel.minVersion}
                    onChange={(e) => updatePlatformChannel(index, 'minVersion', e.target.value)}
                    placeholder="e.g., 4.16.0"
                  />
                </div>
                
                <div className="form-group">
                  <label>Max Version (optional)</label>
                  <input 
                    type="text" 
                    className="form-control"
                    value={channel.maxVersion}
                    onChange={(e) => updatePlatformChannel(index, 'maxVersion', e.target.value)}
                    placeholder="e.g., 4.16.10"
                  />
                </div>
                
                <div className="form-group">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={channel.shortestPath || false}
                      onChange={(e) => updatePlatformChannel(index, 'shortestPath', e.target.checked)}
                    />
                    {' '}Shortest Path
                  </label>
                  <small className="form-text text-muted">
                    Enable shortest path calculation for this channel. This will find the most direct upgrade path between versions.
                  </small>
                </div>
              </div>
            </div>
          ))}
          
          <button className="btn btn-primary" onClick={addPlatformChannel}>
            ➕ Add Platform Channel
          </button>
        </div>

        <div className={`tab-content ${activeTab === 'operators' ? 'active' : ''}`}>
          <div>
            <h3>⚙️ Operators</h3>
            <p className="text-muted">Configure operator catalogs and packages to mirror.</p>
          </div>
          
          {config.mirror.operators.map((operator, opIndex) => (
            <div key={opIndex} className="card" style={{ marginBottom: '1rem' }}>
              <div className="flex-between">
                <h4>Operator Catalog {opIndex + 1}</h4>
                <button 
                  className="btn btn-danger" 
                  onClick={() => removeOperator(opIndex)}
                >
                  Remove
                </button>
              </div>
              
              <div className="form-group">
                <label>Catalog</label>
                <select 
                  className="form-control"
                  value={operator.catalog}
                  onChange={async (e) => {
                    const newCatalog = e.target.value;
                    const version = newCatalog.split(':').pop();
                    
                    // Fetch operators for the selected catalog
                    const operators = await fetchOperatorsForCatalog(newCatalog);
                    
                    setConfig(prev => ({
                      ...prev,
                      mirror: {
                        ...prev.mirror,
                        operators: prev.mirror.operators.map((op, i) => 
                          i === opIndex ? { 
                            ...op, 
                            catalog: newCatalog,
                            catalogVersion: version,
                            availableOperators: operators // Store operators for this catalog
                          } : op
                        )
                      }
                    }));
                  }}
                >
                  {operatorCatalogs.map(catalog => (
                    <option key={catalog.url} value={catalog.url}>
                      {catalog.name} (OCP {catalog.url.split(':').pop()}) - {catalog.description}
                    </option>
                  ))}
                </select>
              </div>
              

              
              <h5>⚙️ Operators</h5>
              {operator.packages.map((pkg, pkgIndex) => (
                <div key={pkgIndex} className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
                  <div className="flex-between">
                    <h6>Operator {pkgIndex + 1}</h6>
                    <button 
                      className="btn btn-danger" 
                      onClick={() => removePackageFromOperator(opIndex, pkgIndex)}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="form-group">
                    <label>Operator Name</label>
                    <select 
                      className="form-control"
                      value={pkg.name}
                      onChange={(e) => updateOperatorPackage(opIndex, pkgIndex, 'name', e.target.value)}
                    >
                      <option value="">Select an operator...</option>
                      {(operator.availableOperators || [])
                        .slice()
                        .sort((a, b) => a.localeCompare(b))
                        .map(operatorName => (
                          <option key={operatorName} value={operatorName}>
                            {operatorName}
                          </option>
                        ))}
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label>Channels for {pkg.name || 'this operator'}</label>
                    
                    {/* Display comprehensive channel information */}
                    {pkg.name && (() => {
                      const operator = config.mirror.operators[opIndex];
                      const detailedOps = detailedOperators[operator.catalog];
                      const operatorInfo = detailedOps?.find(op => op.name === pkg.name);
                      
                      if (operatorInfo) {
                        return (
                          <div className="operator-channels-info" style={{ 
                            background: '#f8f9fa', 
                            padding: '1rem', 
                            borderRadius: '0.375rem',
                            marginBottom: '1rem'
                          }}>
                            <div style={{ marginBottom: '0.5rem' }}>
                              <strong>Default Channel:</strong> 
                              <span style={{ 
                                background: '#28a745', 
                                color: 'white', 
                                padding: '0.25rem 0.5rem', 
                                borderRadius: '0.25rem',
                                marginLeft: '0.5rem',
                                fontSize: '0.875rem'
                              }}>
                                {operatorInfo.defaultChannel}
                              </span>
                            </div>
                            <div>
                              <strong>All Available Channels ({operatorInfo.allChannels?.length || 0}):</strong>
                              <small style={{ color: '#6c757d', marginLeft: '0.5rem' }}>
                                Click on channels to add them to your selection
                              </small>
                              <div style={{ 
                                maxHeight: '200px', 
                                overflowY: 'auto', 
                                marginTop: '0.5rem',
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '0.25rem'
                              }}>
                                {operatorInfo.allChannels?.map((channel, idx) => (
                                  <span 
                                    key={idx} 
                                    style={{
                                      background: channel === operatorInfo.defaultChannel ? '#28a745' : '#6c757d',
                                      color: 'white',
                                      padding: '0.25rem 0.5rem',
                                      borderRadius: '0.25rem',
                                      fontSize: '0.75rem',
                                      cursor: 'pointer',
                                      opacity: pkg.channels?.some(ch => ch.name === channel) ? 0.5 : 1
                                    }} 
                                    title={channel}
                                    onClick={() => {
                                      // Add channel if not already selected
                                      if (!pkg.channels?.some(ch => ch.name === channel)) {
                                        const newChannel = { 
                                          name: channel,
                                          minVersion: '',
                                          maxVersion: ''
                                        };
                                        setConfig(prev => ({
                                          ...prev,
                                          mirror: {
                                            ...prev.mirror,
                                            operators: prev.mirror.operators.map((op, i) => 
                                              i === opIndex 
                                                ? { 
                                                    ...op, 
                                                    packages: op.packages.map((p, pIndex) => 
                                                      pIndex === pkgIndex 
                                                        ? { ...p, channels: [...(p.channels || []), newChannel] }
                                                        : p
                                                    )
                                                  }
                                                : op
                                            )
                                          }
                                        }));
                                      }
                                    }}
                                  >
                                    {channel}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}
                    
                    <div className="channels-container">
                      {pkg.channels && pkg.channels.map((channel, channelIndex) => (
                        <div key={channelIndex} className="channel-item" style={{ display: 'flex', marginBottom: '0.5rem', alignItems: 'flex-end', gap: '0.5rem' }}>
                          <select
                            className="form-control"
                             style={{ minWidth: '180px', maxWidth: '220px' }}
                            value={channel.name}
                            onChange={(e) => updateOperatorPackageChannel(opIndex, pkgIndex, channelIndex, e.target.value)}
                          >
                            <option value="">Select a channel...</option>
                            {(() => {
                              const operator = config.mirror.operators[opIndex];
                              const detailedOps = detailedOperators[operator.catalog];
                              const operatorInfo = detailedOps?.find(op => op.name === pkg.name);
                              return operatorInfo?.allChannels?.map(channel => (
                                <option key={channel} value={channel}>
                                  {channel} {channel === operatorInfo.defaultChannel ? '(default)' : ''}
                                </option>
                              )) || [];
                            })()}
                          </select>
                          
                          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <label style={{ fontSize: '0.8rem', margin: 0, whiteSpace: 'nowrap', fontWeight: '500' }}>Min Version:</label>
                              <select
                                className="form-control form-control-sm"
                                style={{ width: '160px' }}
                                value={channel.minVersion || ''}
                                onChange={(e) => updateOperatorPackageChannelVersion(opIndex, pkgIndex, channelIndex, 'minVersion', e.target.value)}
                              >
                                <option value="">Select version...</option>
                                {getChannelVersions(opIndex, pkgIndex, channel.name).map(version => (
                                  <option key={version} value={version}>
                                    {version}
                                  </option>
                                ))}
                              </select>
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <label style={{ fontSize: '0.8rem', margin: 0, whiteSpace: 'nowrap', fontWeight: '500' }}>Max Version:</label>
                              <select
                                className="form-control form-control-sm"
                                style={{ width: '160px' }}
                                value={channel.maxVersion || ''}
                                onChange={(e) => updateOperatorPackageChannelVersion(opIndex, pkgIndex, channelIndex, 'maxVersion', e.target.value)}
                              >
                                <option value="">Select version...</option>
                                {getChannelVersions(opIndex, pkgIndex, channel.name).map(version => (
                                  <option key={version} value={version}>
                                    {version}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          
                          <button
                            className="btn btn-sm btn-danger"
                            style={{ alignSelf: 'flex-end' }}
                            onClick={() => removeOperatorPackageChannel(opIndex, pkgIndex, channelIndex)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}

                    </div>

                  </div>
                </div>
              ))}
              
              <button 
                className="btn btn-secondary" 
                onClick={() => addPackageToOperator(opIndex)}
              >
                ➕ Add Operator
              </button>
            </div>
          ))}
          
          <button className="btn btn-primary" onClick={addOperator}>
            ➕ Add Operator Catalog
          </button>
        </div>

        <div className={`tab-content ${activeTab === 'images' ? 'active' : ''}`}>
          <h3>🖼️ Additional Images</h3>
          <p className="text-muted">Add additional container images to mirror.</p>
          
          {config.mirror.additionalImages.map((image, index) => (
            <div key={index} className="card" style={{ marginBottom: '1rem' }}>
              <div className="flex-between">
                <h4>Image {index + 1}</h4>
                <button 
                  className="btn btn-danger" 
                  onClick={() => removeAdditionalImage(index)}
                >
                  Remove
                </button>
              </div>
              
              <div className="form-group">
                <label>Image Name</label>
                <input 
                  type="text" 
                  className="form-control"
                  value={image.name}
                  onChange={(e) => updateAdditionalImage(index, e.target.value)}
                  placeholder="registry.redhat.io/example/image:tag"
                />
              </div>
            </div>
          ))}
          
          <button className="btn btn-primary" onClick={addAdditionalImage}>
            ➕ Add Image
          </button>
        </div>

        <div className={`tab-content ${activeTab === 'preview' ? 'active' : ''}`}>
          <div className="flex-between">
            <div>
              <h3>👁️ Configuration Preview</h3>
              <p className="text-muted">Preview the generated YAML configuration.</p>
            </div>
            <button 
              className="btn btn-secondary"
              onClick={() => {
                navigator.clipboard.writeText(YAML.stringify(generateCleanConfig(), { indent: 2 }));
                toast.success('YAML configuration copied to clipboard!');
              }}
            >
              📋 Copy YAML
            </button>
          </div>
          
          <div className="yaml-preview-container">
            <SyntaxHighlighter
              language="yaml"
              style={tomorrow}
              customStyle={{
                margin: 0,
                borderRadius: '8px',
                fontSize: '14px',
                lineHeight: '1.6',
                fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace"
              }}
              showLineNumbers={true}
              wrapLines={true}
              lineNumberStyle={{
                color: '#6a9955',
                marginRight: '1rem',
                userSelect: 'none'
              }}
            >
              {YAML.stringify(generateCleanConfig(), { indent: 2 })}
            </SyntaxHighlighter>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>⚡ Actions</h3>
        
        {/* Custom Name Input */}
        <div style={{ marginBottom: '1rem' }}>
          <div className="flex-between" style={{ alignItems: 'center', marginBottom: '0.5rem' }}>
            <label style={{ margin: 0, fontWeight: 'bold' }}>Configuration Name:</label>
            <button 
              className="btn btn-link" 
              onClick={() => setShowCustomNameInput(!showCustomNameInput)}
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}
            >
              {showCustomNameInput ? 'Use Default Name' : 'Use Custom Name'}
            </button>
          </div>
          
          {showCustomNameInput ? (
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <input 
                type="text" 
                className="form-control"
                value={customConfigName}
                onChange={(e) => setCustomConfigName(e.target.value)}
                placeholder="Enter custom configuration name (without .yaml extension)"
                style={{ marginBottom: '0.5rem' }}
              />
              <small className="text-muted">
                Leave empty to use default name: {generateDefaultConfigName()}
              </small>
            </div>
          ) : (
            <div style={{ marginBottom: '1rem' }}>
              <small className="text-muted">
                Default name: {generateDefaultConfigName()}
              </small>
            </div>
          )}
        </div>
        
        <div className="flex">
          <button 
            className="btn btn-primary" 
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? <div className="loading"></div> : '💾 Save Configuration'}
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={downloadConfiguration}
          >
            📥 Download YAML
          </button>
        </div>
      </div>
    </div>
  );
};

export default MirrorConfig; 