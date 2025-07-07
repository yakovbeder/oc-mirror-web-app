import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import axios from 'axios';
import YAML from 'yaml';

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
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('platform');

  const ocpVersions = [
    '4.16', '4.17', '4.18', '4.19', '4.20'
  ];

  const architectures = [
    'amd64', 'arm64', 'ppc64le', 's390x'
  ];

  const operatorCatalogs = [
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
    },
    {
      name: 'marketplace-operator-index',
      url: 'registry.redhat.io/redhat/redhat-marketplace-index',
      description: 'Marketplace operators'
    }
  ];

  useEffect(() => {
    fetchAvailableData();
  }, []);

  // Memoize expensive operations
  const memoizedConfig = useMemo(() => config, [config]);

  const fetchAvailableData = async () => {
    try {
      setLoading(true);
      const [channelsRes, operatorsRes] = await Promise.all([
        axios.get('/api/channels'),
        axios.get('/api/operators')
      ]);
      setAvailableChannels(channelsRes.data);
      setAvailableOperators(operatorsRes.data);
    } catch (error) {
      console.error('Error fetching available data:', error);
      toast.error('Failed to load available channels and operators');
    } finally {
      setLoading(false);
    }
  };

  const addPlatformChannel = () => {
    const newChannel = {
      name: `stable-${ocpVersions[0]}`,
      minVersion: '',
      maxVersion: '',
      type: 'ocp'
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

  const addOperator = () => {
    const newOperator = {
      catalog: operatorCatalogs[0].url,
      targetCatalog: 'my-catalog',
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

  const updateOperatorPackage = (operatorIndex, packageIndex, field, value) => {
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
  };

  const addOperatorPackageChannel = (operatorIndex, packageIndex) => {
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
                        channels: [...(pkg.channels || []), { name: '' }]
                      } 
                    : pkg
                )
              }
            : op
        )
      }
    }));
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

  const updateOperatorPackageChannel = (operatorIndex, packageIndex, channelIndex, value) => {
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

  const saveConfiguration = async () => {
    try {
      setLoading(true);
      const yamlString = YAML.stringify(config);
      const response = await axios.post('/api/config/save', {
        config: yamlString,
        name: `imageset-config-${Date.now()}.yaml`
      });
      
      toast.success('Configuration saved successfully!');
      console.log('Configuration saved:', response.data);
    } catch (error) {
      console.error('Error saving configuration:', error);
      toast.error('Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  const downloadConfiguration = () => {
    const yamlString = YAML.stringify(config);
    const blob = new Blob([yamlString], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `imageset-config-${Date.now()}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const validateConfiguration = () => {
    const errors = [];
    
    if (!config.mirror.platform.channels.length) {
      errors.push('At least one platform channel is required');
    }
    
    config.mirror.platform.channels.forEach((channel, index) => {
      if (!channel.name) {
        errors.push(`Platform channel ${index + 1} must have a name`);
      }
    });
    
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
              </div>
            </div>
          ))}
          
          <button className="btn btn-primary" onClick={addPlatformChannel}>
            ➕ Add Platform Channel
          </button>
        </div>

        <div className={`tab-content ${activeTab === 'operators' ? 'active' : ''}`}>
          <h3>⚙️ Operators</h3>
          <p className="text-muted">Configure operator catalogs and packages to mirror.</p>
          
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
                  onChange={(e) => {
                    setConfig(prev => ({
                      ...prev,
                      mirror: {
                        ...prev.mirror,
                        operators: prev.mirror.operators.map((op, i) => 
                          i === opIndex ? { ...op, catalog: e.target.value } : op
                        )
                      }
                    }));
                  }}
                >
                  {operatorCatalogs.map(catalog => (
                    <option key={catalog.name} value={catalog.url}>
                      {catalog.name} - {catalog.description}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="form-group">
                <label>Target Catalog Name</label>
                <input 
                  type="text" 
                  className="form-control"
                  value={operator.targetCatalog}
                  onChange={(e) => {
                    setConfig(prev => ({
                      ...prev,
                      mirror: {
                        ...prev.mirror,
                        operators: prev.mirror.operators.map((op, i) => 
                          i === opIndex ? { ...op, targetCatalog: e.target.value } : op
                        )
                      }
                    }));
                  }}
                  placeholder="my-catalog"
                />
              </div>
              
              <h5>📦 Packages</h5>
              {operator.packages.map((pkg, pkgIndex) => (
                <div key={pkgIndex} className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
                  <div className="flex-between">
                    <h6>Package {pkgIndex + 1}</h6>
                    <button 
                      className="btn btn-danger" 
                      onClick={() => removePackageFromOperator(opIndex, pkgIndex)}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="form-group">
                    <label>Package Name</label>
                    <input 
                      type="text" 
                      className="form-control"
                      value={pkg.name}
                      onChange={(e) => updateOperatorPackage(opIndex, pkgIndex, 'name', e.target.value)}
                      placeholder="e.g., advanced-cluster-management"
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Channels for {pkg.name || 'this package'}</label>
                    <div className="channels-container">
                      {pkg.channels && pkg.channels.map((channel, channelIndex) => (
                        <div key={channelIndex} className="channel-item" style={{ display: 'flex', marginBottom: '0.5rem' }}>
                          <input
                            type="text"
                            className="form-control"
                            style={{ marginRight: '0.5rem' }}
                            value={channel.name}
                            onChange={(e) => updateOperatorPackageChannel(opIndex, pkgIndex, channelIndex, e.target.value)}
                            placeholder="e.g., stable, preview, candidate"
                          />
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => removeOperatorPackageChannel(opIndex, pkgIndex, channelIndex)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => addOperatorPackageChannel(opIndex, pkgIndex)}
                      >
                        ➕ Add Channel
                      </button>
                    </div>
                    <small className="form-text text-muted">
                      Leave empty to mirror all channels for this package
                    </small>
                  </div>
                </div>
              ))}
              
              <button 
                className="btn btn-secondary" 
                onClick={() => addPackageToOperator(opIndex)}
              >
                ➕ Add Package
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
          <h3>👁️ Configuration Preview</h3>
          <p className="text-muted">Preview the generated YAML configuration.</p>
          
          <div className="log-output">
            {YAML.stringify(config, { indent: 2 })}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>⚡ Actions</h3>
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