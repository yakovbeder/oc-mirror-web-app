import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import axios from 'axios';

const MirrorOperations = () => {
  const [operations, setOperations] = useState([]);
  const [selectedConfig, setSelectedConfig] = useState('');
  const [availableConfigs, setAvailableConfigs] = useState([]);
  const [runningOperation, setRunningOperation] = useState(null);
  const [logs, setLogs] = useState('');
  const [logStream, setLogStream] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    fetchOperations();
    fetchConfigurations();
    const interval = setInterval(fetchOperations, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!runningOperation) {
      stopLogStream();
      return;
    }
    
    // Start SSE stream for running operations
    const stream = startLogStream(runningOperation.id);
    
    return () => {
      if (stream) {
        stream.close();
      }
    };
  }, [runningOperation]);

  const fetchOperations = async () => {
    try {
      const response = await axios.get('/api/operations');
      setOperations(response.data);
      
      // Check if any operation is running
      const running = response.data.find(op => op.status === 'running');
      setRunningOperation(running);
      
      if (running) {
        fetchLogs(running.id);
      }
    } catch (error) {
      console.error('Error fetching operations:', error);
    }
  };

  const fetchConfigurations = async () => {
    try {
      const response = await axios.get('/api/config/list');
      setAvailableConfigs(response.data);
    } catch (error) {
      console.error('Error fetching configurations:', error);
    }
  };

  const fetchLogs = async (operationId) => {
    try {
      const response = await axios.get(`/api/operations/${operationId}/logs`);
      setLogs(response.data.logs || 'No logs available for this operation');
    } catch (error) {
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

    eventSource.onmessage = (event) => {
      setLogs(prevLogs => prevLogs + event.data);
    };

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      eventSource.close();
      setLogStream(null);
    };

    return eventSource;
  };

  const stopLogStream = () => {
    if (logStream) {
      logStream.close();
      setLogStream(null);
    }
  };

  const startOperation = async () => {
    if (!selectedConfig) {
      toast.error('Please select a configuration file');
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post('/api/operations/start', {
        configFile: selectedConfig
      });
      
      toast.success('Operation started successfully!');
      setShowLogs(true);
      fetchOperations();
      
      // Start polling for logs if operation is running
      if (response.data.status === 'running') {
        const logInterval = setInterval(async () => {
          try {
            const logResponse = await axios.get(`/api/operations/${response.data.id}/logs`);
            setLogs(logResponse.data.logs || '');
          } catch (error) {
            console.error('Error polling logs:', error);
          }
        }, 2000); // Poll every 2 seconds
        
        // Clear interval when operation completes
        setTimeout(() => {
          clearInterval(logInterval);
        }, 300000); // Stop after 5 minutes
      }
    } catch (error) {
      console.error('Error starting operation:', error);
      toast.error('Failed to start operation: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const stopOperation = async (operationId) => {
    try {
      await axios.post(`/api/operations/${operationId}/stop`);
      toast.success('Operation stopped successfully!');
      fetchOperations();
    } catch (error) {
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

  const viewLogs = async (operationId) => {
    setShowLogs(true);
    await fetchLogs(operationId);
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
        <div className="grid">
          <div className="form-group">
            <label>Configuration File</label>
            <select 
              className="form-control"
              value={selectedConfig}
              onChange={(e) => setSelectedConfig(e.target.value)}
            >
              <option value="">Select a configuration file...</option>
              {availableConfigs.map(config => (
                <option key={config.name} value={config.name}>
                  {config.name} ({config.size})
                </option>
              ))}
            </select>
          </div>
          
          <div className="form-group">
            <label>&nbsp;</label>
            <button 
              className="btn btn-primary" 
              onClick={startOperation}
              disabled={loading || !selectedConfig || runningOperation}
            >
              {loading ? <div className="loading"></div> : '▶️ Start Operation'}
            </button>
          </div>
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
    </div>
  );
};

export default MirrorOperations; 