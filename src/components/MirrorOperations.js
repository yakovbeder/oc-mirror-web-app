import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import axios from 'axios';
import YAML from 'yaml';

const MirrorOperations = () => {
  const [operations, setOperations] = useState([]);
  const [selectedConfig, setSelectedConfig] = useState('');
  const [availableConfigs, setAvailableConfigs] = useState([]);
  const [runningOperation, setRunningOperation] = useState(null);
  const [logs, setLogs] = useState('');
  const [logStream, setLogStream] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  
  // Upload functionality state
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploadedContent, setUploadedContent] = useState('');
  const [parsedConfig, setParsedConfig] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  
  // Overwrite confirmation modal state
  const [showOverwriteModal, setShowOverwriteModal] = useState(false);
  const [conflictFilename, setConflictFilename] = useState('');
  
  // Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteFilename, setDeleteFilename] = useState('');
  
  // Mirror destination subdirectory state
  const [mirrorDestinationSubdir, setMirrorDestinationSubdir] = useState('');
  const [notifiedOperations, setNotifiedOperations] = useState(new Set());
  const [showMirrorLocation, setShowMirrorLocation] = useState({});
  const operationsRef = useRef([]);
  const notifiedOperationsRef = useRef(new Set());
  const logStreamOperationIdRef = useRef(null);
  const lastRunningOperationIdRef = useRef(null);

  useEffect(() => {
    fetchOperations();
    fetchConfigurations();
    const interval = setInterval(fetchOperations, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    operationsRef.current = operations;
  }, [operations]);

  useEffect(() => {
    notifiedOperationsRef.current = notifiedOperations;
  }, [notifiedOperations]);

  useEffect(() => {
    if (runningOperation) {
      lastRunningOperationIdRef.current = runningOperation.id;
      if (logStreamOperationIdRef.current !== runningOperation.id) {
        startLogStream(runningOperation.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningOperation]);

  useEffect(() => () => stopLogStream(), []);

  const fetchOperations = async () => {
    try {
      const response = await axios.get('/api/operations');
      const previousOps = operationsRef.current;
      setOperations(response.data);
      
      // Check for newly completed operations and show location (only once per operation)
      response.data.forEach(op => {
        const prevOp = previousOps.find(p => p.id === op.id);
        // Check if operation just completed (was running, now has terminal status)
        const justCompleted = prevOp && prevOp.status === 'running' && 
          (op.status === 'success' || op.status === 'failed' || op.status === 'stopped');
        
        if (justCompleted) {
          handleOperationCompleted(op);
        }
      });
      
      // Check if any operation is running
      const running = response.data.find(op => op.status === 'running');
      if (running) {
        lastRunningOperationIdRef.current = running.id;
      }

      if (!running && lastRunningOperationIdRef.current) {
        const lastOpId = lastRunningOperationIdRef.current;
        const completedOp = response.data.find(op => op.id === lastOpId);
        if (completedOp && (completedOp.status === 'success' || completedOp.status === 'failed' || completedOp.status === 'stopped')) {
          handleOperationCompleted(completedOp);
          if (logStreamOperationIdRef.current === completedOp.id) {
            stopLogStream();
          }
          lastRunningOperationIdRef.current = null;
        }
      }
      setRunningOperation(running);
      
      if (running) {
        fetchLogs(running.id);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error fetching operations:', error);
    }
  };

  const fetchConfigurations = async () => {
    try {
      const response = await axios.get('/api/config/list');
      setAvailableConfigs(response.data);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error fetching configurations:', error);
    }
  };

  const handleOperationCompleted = (op) => {
    if (!op || !op.id) return;

    // Fetch final logs after a short delay to ensure server has finished writing
    setTimeout(() => fetchLogs(op.id), 500);

    const isTerminalStatus = op.status === 'success' || op.status === 'failed' || op.status === 'stopped';
    if (!isTerminalStatus) {
      return;
    }

    if (!notifiedOperationsRef.current.has(op.id)) {
      // Mark as notified immediately to avoid double toasts from multiple sources
      notifiedOperationsRef.current.add(op.id);

      if (op.status === 'success') {
        toast.success(
          `Mirror Operation Completed!`,
          { duration: 5000 }
        );
      } else if (op.status === 'failed') {
        toast.error(
          `❌ Mirror Operation Failed`,
          { duration: 5000 }
        );
      } else if (op.status === 'stopped') {
        toast.info(
          `⚠️ Mirror Operation Stopped`,
          { duration: 5000 }
        );
      }

      setNotifiedOperations(prev => {
        const next = new Set(prev);
        next.add(op.id);
        return next;
      });
    }
  };


  const fetchLogs = async (operationId) => {
    try {
      const response = await axios.get(`/api/operations/${operationId}/logs`);
      setLogs(response.data.logs || 'No logs available for this operation');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error fetching logs:', error);
      setLogs('Error loading logs: ' + (error.response?.data?.message || error.message));
    }
  };

  const startLogStream = (operationId) => {
    // Close existing stream if any
    if (logStream) {
      logStream.close();
    }

    // Start new SSE stream
    const eventSource = new EventSource(`/api/operations/${operationId}/logstream`);
    setLogStream(eventSource);
    logStreamOperationIdRef.current = operationId;

    eventSource.onmessage = (event) => {
      setLogs(prevLogs => prevLogs + event.data);
    };

    eventSource.addEventListener('done', (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {}

      const status = payload?.status || 'unknown';
      const completedOp = operationsRef.current.find(op => op.id === operationId) || {
        id: operationId,
        status
      };
      handleOperationCompleted(completedOp);
      lastRunningOperationIdRef.current = null;
      stopLogStream();
    });

    eventSource.onerror = (error) => {
      // eslint-disable-next-line no-console
      console.error('SSE error:', error);
      eventSource.close();
      setLogStream(null);
      logStreamOperationIdRef.current = null;
    };

    return eventSource;
  };

  const stopLogStream = () => {
    if (logStream) {
      logStream.close();
      setLogStream(null);
    }
    logStreamOperationIdRef.current = null;
  };

  const startOperation = async () => {
    if (!selectedConfig) {
      toast.error('Please select a configuration file');
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post('/api/operations/start', {
        configFile: selectedConfig,
        mirrorDestinationSubdir: mirrorDestinationSubdir.trim() || undefined
      });
      
      toast.success('Operation started successfully!');
      setShowLogs(true);
      fetchOperations();
      // Clear mirror destination subdirectory after starting
      setMirrorDestinationSubdir('');
      
      // Start polling for logs if operation is running
      if (response.data.status === 'running') {
        const logInterval = setInterval(async () => {
          try {
            const logResponse = await axios.get(`/api/operations/${response.data.id}/logs`);
            setLogs(logResponse.data.logs || '');
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Error polling logs:', error);
          }
        }, 2000); // Poll every 2 seconds
        
        // Clear interval when operation completes
        setTimeout(() => {
          clearInterval(logInterval);
        }, 300000); // Stop after 5 minutes
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error starting operation:', error);
      toast.error('Failed to start operation: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  // Upload functionality
  const openUploadSection = () => {
    setShowUploadSection(true);
    setUploadedFile(null);
    setUploadedContent('');
    setParsedConfig(null);
    setUploadError('');

    // Auto-scroll to the upload section
    setTimeout(() => {
      const uploadSection = document.getElementById('upload-section');
      if (uploadSection) {
        uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  const closeUploadSection = () => {
    setShowUploadSection(false);
    setUploadedFile(null);
    setUploadedContent('');
    setParsedConfig(null);
    setUploadError('');
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      processUploadedFile(file);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      processUploadedFile(file);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const processUploadedFile = (file) => {
    // Validate file type
    if (!file.name.endsWith('.yaml') && !file.name.endsWith('.yml')) {
      setUploadError('Please upload a YAML file (.yaml or .yml)');
      return;
    }

    setUploadedFile(file);
    setUploadError('');

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      setUploadedContent(content);
      parseYAMLContent(content);
    };
    reader.readAsText(file);
  };

  const parseYAMLContent = (content) => {
    try {
      const parsed = YAML.parse(content);
      
      // Validate that it's an ImageSetConfiguration
      if (!parsed.kind || parsed.kind !== 'ImageSetConfiguration') {
        setUploadError('Invalid YAML: Must be an ImageSetConfiguration');
        setParsedConfig(null);
        return;
      }

      if (!parsed.apiVersion || !parsed.apiVersion.includes('mirror.openshift.io')) {
        setUploadError('Invalid YAML: Must have mirror.openshift.io API version');
        setParsedConfig(null);
        return;
      }

      if (!parsed.mirror) {
        setUploadError('Invalid YAML: Missing mirror section');
        setParsedConfig(null);
        return;
      }

      setParsedConfig(parsed);
      setUploadError('');
    } catch (error) {
      setUploadError(`Invalid YAML: ${error.message}`);
      setParsedConfig(null);
    }
  };

  const saveUploadedConfig = async () => {
    if (!parsedConfig || !uploadedFile) {
      toast.error('No valid configuration to save');
      return;
    }

    try {
      setUploading(true);
      
      // Generate a filename based on the uploaded file or current timestamp
      let filename = uploadedFile.name || `config-${Date.now()}.yaml`;
      
      // Ensure filename has .yaml extension
      if (!filename.endsWith('.yaml') && !filename.endsWith('.yml')) {
        filename = `${filename}.yaml`;
      }
      
      // Try to save the configuration
      try {
        await axios.post('/api/config/upload', {
          filename: filename,
          content: uploadedContent
        });
      } catch (uploadError) {
        // If file already exists (409), show custom modal
        if (uploadError.response?.status === 409) {
          setConflictFilename(filename);
          setShowOverwriteModal(true);
          setUploading(false);
          return; // Exit early, will be handled by modal actions
        } else {
          throw uploadError;
        }
      }

      toast.success('Configuration uploaded successfully!');
      closeUploadSection();
      
      // Refresh the configurations list
      fetchConfigurations();
      
      // Auto-select the newly uploaded config
      setSelectedConfig(filename);
      
      // Auto-scroll back to Start Operation section
      setTimeout(() => {
        const startOperationSection = document.querySelector('.card h3');
        if (startOperationSection && startOperationSection.textContent.includes('Start New Operation')) {
          startOperationSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
      
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error saving configuration:', error);
      toast.error('Failed to save configuration: ' + (error.response?.data?.message || error.message));
    } finally {
      setUploading(false);
    }
  };

  // Overwrite modal actions
  const handleOverwriteConfirm = async () => {
    try {
      setUploading(true);
      setShowOverwriteModal(false);
      
      // Use the save endpoint which allows overwriting
      await axios.post('/api/config/save', {
        config: uploadedContent,
        name: conflictFilename
      });

      toast.success('Configuration uploaded and overwritten successfully!');
      closeUploadSection();
      
      // Refresh the configurations list
      fetchConfigurations();
      
      // Auto-select the newly uploaded config
      setSelectedConfig(conflictFilename);
      
      // Auto-scroll back to Start Operation section
      setTimeout(() => {
        const startOperationSection = document.querySelector('.card h3');
        if (startOperationSection && startOperationSection.textContent.includes('Start New Operation')) {
          startOperationSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
      
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error saving configuration:', error);
      toast.error('Failed to save configuration: ' + (error.response?.data?.message || error.message));
    } finally {
      setUploading(false);
    }
  };

  const handleAutoRename = async () => {
    try {
      setUploading(true);
      setShowOverwriteModal(false);
      
      // Generate a unique filename
      const timestamp = Date.now();
      const nameWithoutExt = conflictFilename.replace(/\.(yaml|yml)$/, '');
      const newFilename = `${nameWithoutExt}-${timestamp}.yaml`;
      
      await axios.post('/api/config/upload', {
        filename: newFilename,
        content: uploadedContent
      });

      toast.success(`Configuration uploaded as "${newFilename}"!`);
      closeUploadSection();
      
      // Refresh the configurations list
      fetchConfigurations();
      
      // Auto-select the newly uploaded config
      setSelectedConfig(newFilename);
      
      // Auto-scroll back to Start Operation section
      setTimeout(() => {
        const startOperationSection = document.querySelector('.card h3');
        if (startOperationSection && startOperationSection.textContent.includes('Start New Operation')) {
          startOperationSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
      
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error saving configuration:', error);
      toast.error('Failed to save configuration: ' + (error.response?.data?.message || error.message));
    } finally {
      setUploading(false);
    }
  };

  const handleOverwriteCancel = () => {
    setShowOverwriteModal(false);
    setUploading(false);
    // Don't close the upload modal, let user try again
  };

  // Delete configuration function
  const deleteConfiguration = (configName) => {
    setDeleteFilename(configName);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    try {
      await axios.delete(`/api/config/delete/${encodeURIComponent(deleteFilename)}`);
      toast.success(`Configuration "${deleteFilename}" deleted successfully!`);
      fetchConfigurations();
      
      // If the deleted config was selected, clear the selection
      if (selectedConfig === deleteFilename) {
        setSelectedConfig('');
      }
      
      setShowDeleteModal(false);
      setDeleteFilename('');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error deleting configuration:', error);
      toast.error('Failed to delete configuration: ' + (error.response?.data?.message || error.message));
    }
  };

  const cancelDelete = () => {
    setShowDeleteModal(false);
    setDeleteFilename('');
  };

  const stopOperation = async (operationId) => {
    try {
      await axios.post(`/api/operations/${operationId}/stop`);
      toast.success('Operation stopped successfully!');
      fetchOperations();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error stopping operation:', error);
      toast.error('Failed to stop operation');
    }
  };

  const deleteOperation = async (operationId) => {
    if (!window.confirm('Are you sure you want to delete this operation?')) {
      return;
    }

    try {
      await axios.delete(`/api/operations/${operationId}`);
      toast.success('Operation deleted successfully!');
      fetchOperations();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error deleting operation:', error);
      toast.error('Failed to delete operation');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'success': return 'status-success';
      case 'running': return 'status-running';
      case 'failed': return 'status-error';
      case 'stopped': return 'status-error';
      default: return 'status-error';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'success': return 'Success';
      case 'running': return 'Running';
      case 'failed': return 'Failed';
      case 'stopped': return 'Stopped';
      default: return 'Unknown';
    }
  };

  const getStatusClass = (status) => {
    switch (status) {
      case 'success': return 'status-success-text';
      case 'running': return 'status-running-text';
      case 'failed': return 'status-error-text';
      case 'stopped': return 'status-error-text';
      default: return 'status-error-text';
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '-';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };



  const clearLogs = () => {
    setLogs('');
    setShowLogs(false);
  };


  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (showLogs && logs) {
      const logContainer = document.getElementById('log-container');
      if (logContainer) {
        logContainer.scrollTop = logContainer.scrollHeight;
      }
    }
  }, [logs, showLogs]);

  return (
    <div className="container">
      <div className="card">
        <h2>🔄 Mirror Operations</h2>
        <p className="text-muted">
          Execute and monitor oc-mirror v2 operations.
        </p>
      </div>

      <div className="card">
        <h3>🚀 Start New Operation</h3>
        
        <div className="form-group">
          <label>Configuration File</label>
          <div style={{ 
            display: 'flex', 
            gap: '0.75rem', 
            alignItems: 'center',
            flexWrap: 'wrap'
          }}>
            <select
              className="form-control"
              value={selectedConfig}
              onChange={(e) => setSelectedConfig(e.target.value)}
              style={{ minWidth: '200px', flex: '1 1 200px' }}
            >
              <option value="">Select a configuration file...</option>
              {availableConfigs.map(config => (
                <option key={config.name} value={config.name}>
                  {config.name} ({config.size})
                </option>
              ))}
            </select>
            <button
              className="btn btn-secondary"
              onClick={openUploadSection}
              style={{ 
                whiteSpace: 'nowrap',
                minWidth: '140px',
                padding: '0.5rem 1rem'
              }}
            >
              📤 Upload YAML
            </button>
            {selectedConfig && (
              <button
                className="btn btn-danger"
                onClick={() => deleteConfiguration(selectedConfig)}
                style={{ 
                  whiteSpace: 'nowrap',
                  minWidth: '100px',
                  padding: '0.5rem 1rem'
                }}
                title={`Delete ${selectedConfig}`}
              >
                🗑️ Delete
              </button>
            )}
          </div>
        </div>
        
        <div className="form-group" style={{ marginTop: '1rem', display: 'flex', alignItems: 'flex-end', gap: '0.75rem', flexWrap: 'wrap', position: 'relative' }}>
          <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', whiteSpace: 'nowrap' }}>
              📁 Mirror Destination Subdirectory
              <span 
                style={{ 
                  cursor: 'pointer', 
                  color: '#007bff', 
                  fontSize: '12px',
                  fontWeight: 'bold',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  border: '1.5px solid #007bff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: '1',
                  flexShrink: 0
                }}
                onClick={() => toast.info('Mirror files are saved to data/mirrors/<subdirectory>. Leave empty for "default". The subdirectory is created automatically with correct permissions.', { autoClose: 5000 })}
                title="Mirror files are saved to data/mirrors/<subdirectory>. Leave empty for 'default'. Click for more info."
              >
                ?
              </span>
            </label>
            <input
              type="text"
              className="form-control"
              placeholder="default"
              value={mirrorDestinationSubdir}
              onChange={(e) => setMirrorDestinationSubdir(e.target.value)}
              style={{ width: '250px', height: '38px' }}
            />
          </div>
          <button 
            className="btn btn-primary" 
            onClick={startOperation}
            disabled={!selectedConfig || loading}
            style={{ 
              whiteSpace: 'nowrap',
              minWidth: '140px',
              padding: '0.5rem 1rem',
              height: '38px',
              flexShrink: 0,
              marginBottom: '0'
            }}
          >
            {loading ? <div className="loading"></div> : '▶️ Start Operation'}
          </button>
        </div>
        
        {runningOperation && (
          <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#d1ecf1', border: '1px solid #bee5eb', borderRadius: '4px', color: '#0c5460' }}>
            <strong>🔄 Operation in progress:</strong> {runningOperation.name}
            <button 
              className="btn btn-danger" 
              style={{ marginLeft: '1rem' }}
              onClick={() => stopOperation(runningOperation.id)}
            >
              ⏹️ Stop Operation
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex-between">
          <h3>📋 Operation History</h3>
          <button 
            className="btn btn-secondary"
            onClick={() => setShowLogs(!showLogs)}
          >
            {showLogs ? '👁️ Hide Logs' : '📝 Show Logs'}
          </button>
        </div>
        
        {operations.length === 0 ? (
          <p className="text-muted">No operations found.</p>
        ) : (
          <div className="table-responsive">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e9ecef' }}>
                  <th style={{ padding: '1rem', textAlign: 'left' }}>Operation</th>
                  <th style={{ padding: '1rem', textAlign: 'left' }}>Status</th>
                  <th style={{ padding: '1rem', textAlign: 'left' }}>Started</th>
                  <th style={{ padding: '1rem', textAlign: 'left' }}>Duration</th>
                  <th style={{ padding: '1rem', textAlign: 'left' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((op) => (
                  <tr key={op.id} style={{ borderBottom: '1px solid #e9ecef' }}>
                    <td style={{ padding: '1rem' }}>
                      <div>
                        <strong>{op.name}</strong>
                        <br />
                        <small className="text-muted">{op.configFile}</small>
                      </div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div className="flex">
                        <span className={`status-indicator ${getStatusColor(op.status)}`}></span>
                        <span className={getStatusClass(op.status)}>
                          {getStatusText(op.status)}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      {new Date(op.startedAt).toLocaleString()}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      {formatDuration(op.duration)}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div className="flex">
                        {op.status === 'running' && (
                          <button 
                            className="btn btn-danger"
                            onClick={() => stopOperation(op.id)}
                          >
                            ⏹️ Stop
                          </button>
                        )}
                        {op.status === 'success' && op.mirrorDestination && (
                          <button 
                            className="btn btn-secondary"
                            onClick={() => {
                              setShowMirrorLocation(prev => ({
                                ...prev,
                                [op.id]: !prev[op.id]
                              }));
                            }}
                            title="Show/Hide mirror files location"
                          >
                            📁 {showMirrorLocation[op.id] ? 'Hide Location' : 'Location'}
                          </button>
                        )}
                        <button 
                          className="btn btn-secondary"
                          onClick={() => {
                            setSelectedConfig(op.configFile);
                            fetchLogs(op.id);
                            setShowLogs(true);
                          }}
                        >
                          📝 Logs
                        </button>
                        <button 
                          className="btn btn-danger"
                          onClick={() => deleteOperation(op.id)}
                        >
                          🗑️ Delete
                        </button>
                      </div>
                      {op.status === 'success' && op.mirrorDestination && showMirrorLocation[op.id] && (
                        <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: '4px', fontSize: '0.85rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <strong style={{ color: '#155724', whiteSpace: 'nowrap' }}>📁 Mirror Files Location:</strong>
                            <code style={{ 
                              backgroundColor: '#fff', 
                              padding: '0.5rem 0.75rem', 
                              borderRadius: '4px',
                              border: '1px solid #ced4da',
                              flex: '1 1 400px',
                              fontFamily: 'monospace',
                              fontSize: '0.9rem',
                              wordBreak: 'break-all',
                              minWidth: '200px'
                            }}>
                              {(() => {
                                const hostPath = op.mirrorDestination.replace('/app/data', 'data');
                                // Construct full absolute path - project is typically in /home/ybeder/oc-mirror-web-app
                                const projectRoot = '/home/ybeder/oc-mirror-web-app';
                                return `${projectRoot}/${hostPath}`.replace(/\/\//g, '/');
                              })()}
                            </code>
                            <button
                              className="btn btn-sm btn-outline-primary"
                              onClick={async () => {
                                const hostPath = op.mirrorDestination.replace('/app/data', 'data');
                                // Construct full absolute path - project is in /home/ybeder/oc-mirror-web-app
                                const projectRoot = '/home/ybeder/oc-mirror-web-app';
                                const fullPath = `${projectRoot}/${hostPath}`.replace(/\/\//g, '/');
                                
                                try {
                                  await navigator.clipboard.writeText(fullPath);
                                  toast.success('Full path copied to clipboard!');
                                } catch (error) {
                                  // Fallback for older browsers
                                  const textArea = document.createElement('textarea');
                                  textArea.value = fullPath;
                                  textArea.style.position = 'fixed';
                                  textArea.style.opacity = '0';
                                  document.body.appendChild(textArea);
                                  textArea.select();
                                  try {
                                    document.execCommand('copy');
                                    toast.success('Full path copied to clipboard!');
                                  } catch (err) {
                                    toast.error('Failed to copy path');
                                  }
                                  document.body.removeChild(textArea);
                                }
                              }}
                              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                            >
                              📋 Copy
                            </button>
                            <small style={{ color: '#6c757d', fontSize: '0.8rem', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                              ✓ Files persist across container restarts
                            </small>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showLogs && (
        <div className="log-viewer">
          <div className="log-header">
            <h4>📋 Operation Logs</h4>
            <div className="log-actions">
              <button 
                className="btn btn-secondary"
                onClick={clearLogs}
              >
                🗑️ Clear Logs
              </button>
            </div>
          </div>
          <div 
            id="log-container"
            className="log-content"
          >
            {logs || 'No logs available'}
          </div>
        </div>
      )}

      <div className="card">
        <h3>📊 Operation Details</h3>
        <div className="grid">
          <div className="card">
            <h4>🔄 Current Status</h4>
            {runningOperation ? (
              <div>
                <p><strong>Operation:</strong> {runningOperation.name}</p>
                <p><strong>Started:</strong> {new Date(runningOperation.startedAt).toLocaleString()}</p>
                <p><strong>Duration:</strong> {formatDuration(runningOperation.duration)}</p>
              </div>
            ) : (
              <p className="text-muted">No operation currently running</p>
            )}
          </div>
          
          <div className="card">
            <h4>⚡ Quick Actions</h4>
            <div className="flex">
              <button 
                className="btn btn-primary"
                onClick={() => window.location.href = '/config'}
                disabled={runningOperation}
              >
                ⚙️ Create New Config
              </button>
              <button 
                className="btn btn-secondary"
                onClick={fetchOperations}
              >
                🔄 Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Upload Section */}
      {showUploadSection && (
        <div id="upload-section" className="card" style={{ marginTop: '1rem', border: '2px solid #007bff', backgroundColor: '#f8f9ff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, color: '#007bff' }}>📤 Upload YAML Configuration</h3>
            <button 
              className="btn btn-sm btn-outline-secondary" 
              onClick={closeUploadSection}
              style={{ padding: '0.25rem 0.5rem' }}
            >
              ✕ Close
            </button>
          </div>
          
          <div className="grid" style={{ gap: '1rem' }}>
            <div className="form-group">
              <label>Upload YAML File</label>
              <div
                className="upload-area"
                onClick={() => document.getElementById('file-input').click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                style={{
                  border: '2px dashed #007bff',
                  borderRadius: '8px',
                  padding: '2rem',
                  textAlign: 'center',
                  cursor: 'pointer',
                  backgroundColor: uploadedFile ? '#e8f5e8' : '#f8f9ff',
                  transition: 'all 0.3s ease',
                  minHeight: '120px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
              >
                {uploadedFile ? (
                  <div>
                    <div style={{ color: '#28a745', fontSize: '1.2rem', marginBottom: '0.5rem' }}>
                      ✅ {uploadedFile.name}
                    </div>
                    <div style={{ color: '#666', fontSize: '0.9rem' }}>
                      Click to change file
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📁</div>
                    <div style={{ color: '#007bff', marginBottom: '0.5rem', fontWeight: '500' }}>
                      Drag & drop YAML file here
                    </div>
                    <div style={{ color: '#6c757d', fontSize: '0.9rem' }}>
                      or click to browse
                    </div>
                  </div>
                )}
              </div>
              <input
                id="file-input"
                type="file"
                accept=".yaml,.yml"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
            </div>

            {uploadError && (
              <div className="alert alert-danger">
                ❌ {uploadError}
              </div>
            )}

            {parsedConfig && (
              <div className="alert alert-success">
                ✅ Valid ImageSetConfiguration detected
                <div style={{ marginTop: '0.5rem', fontSize: '0.9em' }}>
                  <strong>Kind:</strong> {parsedConfig.kind}<br/>
                  <strong>API Version:</strong> {parsedConfig.apiVersion}<br/>
                  {parsedConfig.mirror?.platform?.channels && (
                    <><strong>Platform Channels:</strong> {parsedConfig.mirror.platform.channels.length}<br/></>
                  )}
                  {parsedConfig.mirror?.operators && (
                    <><strong>Operators:</strong> {parsedConfig.mirror.operators.length}<br/></>
                  )}
                  {parsedConfig.mirror?.additionalImages && (
                    <><strong>Additional Images:</strong> {parsedConfig.mirror.additionalImages.length}</>
                  )}
                </div>
              </div>
            )}

            {uploadedContent && (
              <div className="form-group">
                <label>YAML Preview</label>
                <div style={{ 
                  backgroundColor: '#f8f9fa', 
                  padding: '1rem', 
                  borderRadius: '4px', 
                  border: '1px solid #dee2e6',
                  fontSize: '0.875rem',
                  maxHeight: '300px',
                  overflow: 'auto'
                }}>
                  <pre style={{ 
                    margin: 0, 
                    whiteSpace: 'pre-wrap', 
                    wordBreak: 'break-word',
                    fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace'
                  }}>
                    {uploadedContent}
                  </pre>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-start', marginTop: '1rem' }}>
              <button 
                className="btn btn-secondary" 
                onClick={closeUploadSection}
                disabled={uploading}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary" 
                onClick={saveUploadedConfig}
                disabled={!parsedConfig || uploading}
              >
                {uploading ? <div className="loading"></div> : '💾 Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overwrite Confirmation Modal */}
      {showOverwriteModal && (
        <div className="modal-overlay" onClick={handleOverwriteCancel} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: 'white', borderRadius: '12px', maxWidth: '480px', width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', border: '1px solid #e0e0e0' }}>
            <div className="modal-header" style={{ padding: '1.5rem 1.5rem 0 1.5rem', borderBottom: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ fontSize: '1.5rem' }}>⚠️</div>
                <h3 style={{ margin: 0, color: '#dc3545', fontSize: '1.25rem' }}>File Already Exists</h3>
              </div>
            </div>
            
            <div className="modal-body" style={{ padding: '1.5rem' }}>
              <p style={{ marginBottom: '1rem', color: '#495057' }}>
                Configuration file <strong style={{ color: '#007bff' }}>"{conflictFilename}"</strong> already exists.
              </p>
              <p style={{ marginBottom: '0', color: '#6c757d', fontSize: '0.95rem' }}>
                Choose how you want to save this configuration:
              </p>
            </div>
            
            <div className="modal-footer" style={{ padding: '0 1.5rem 1.5rem 1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'flex-start' }}>
              <button 
                className="btn btn-outline-secondary" 
                onClick={handleOverwriteCancel}
                disabled={uploading}
                style={{ padding: '0.5rem 1rem' }}
              >
                Cancel
              </button>
              <button 
                className="btn btn-warning" 
                onClick={handleAutoRename}
                disabled={uploading}
                style={{ padding: '0.5rem 1rem' }}
              >
                {uploading ? <div className="loading"></div> : '🔄 Auto-Generate Name'}
              </button>
              <button 
                className="btn btn-danger" 
                onClick={handleOverwriteConfirm}
                disabled={uploading}
                style={{ padding: '0.5rem 1rem' }}
              >
                {uploading ? <div className="loading"></div> : '⚠️ Overwrite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={cancelDelete} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1002, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: 'white', borderRadius: '12px', maxWidth: '450px', width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', border: '1px solid #e0e0e0' }}>
            <div className="modal-header" style={{ padding: '1.5rem 1.5rem 0 1.5rem', borderBottom: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ fontSize: '1.5rem' }}>🗑️</div>
                <h3 style={{ margin: 0, color: '#dc3545', fontSize: '1.25rem' }}>Delete Configuration</h3>
              </div>
            </div>
            
            <div className="modal-body" style={{ padding: '1.5rem' }}>
              <p style={{ marginBottom: '1rem', color: '#495057' }}>
                Are you sure you want to delete configuration <strong style={{ color: '#007bff' }}>"{deleteFilename}"</strong>?
              </p>
              <p style={{ marginBottom: '0', color: '#dc3545', fontSize: '0.95rem', fontWeight: '500' }}>
                ⚠️ This action cannot be undone.
              </p>
            </div>
            
            <div className="modal-footer" style={{ padding: '0 1.5rem 1.5rem 1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'flex-start' }}>
              <button 
                className="btn btn-outline-secondary" 
                onClick={cancelDelete}
                style={{ padding: '0.5rem 1rem' }}
              >
                Cancel
              </button>
              <button 
                className="btn btn-danger" 
                onClick={confirmDelete}
                style={{ padding: '0.5rem 1rem' }}
              >
                🗑️ Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MirrorOperations; 