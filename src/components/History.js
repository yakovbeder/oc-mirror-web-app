import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import axios from 'axios';

const History = () => {
  const [operations, setOperations] = useState([]);
  const [selectedOperation, setSelectedOperation] = useState(null);
  const [operationDetails, setOperationDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [liveLog, setLiveLog] = useState('');
  const [logSource, setLogSource] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    if (!selectedOperation) return;
    setLiveLog('');
    if (logSource) {
      logSource.close();
      setLogSource(null);
    }
    
    // Always try to fetch logs first
    axios.get(`/api/operations/${selectedOperation.id}/logs`).then(res => {
      setLiveLog(res.data.logs || '');
    }).catch(err => {
      // eslint-disable-next-line no-console
      console.error('Error fetching logs:', err);
      setLiveLog('No logs available for this operation.');
    });
    
    // If operation is running, also set up SSE for live updates
    if (selectedOperation.status === 'running') {
      try {
        const es = new window.EventSource(`/api/operations/${selectedOperation.id}/logstream`);
        es.onmessage = (e) => {
          if (!isPaused) {
            setLiveLog((prev) => prev + (e.data ? e.data + '\n' : ''));
          }
        };
        es.onerror = (e) => {
          // eslint-disable-next-line no-console
          console.error('SSE connection error:', e);
          es.close();
        };
        setLogSource(es);
        return () => {
          es.close();
        };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error setting up SSE connection:', error);
      }
    }
    // eslint-disable-next-line
  }, [selectedOperation, isPaused]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [liveLog, autoScroll]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/operations/history');
      setOperations(response.data);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error fetching history:', error);
      toast.error('Failed to load operation history');
    } finally {
      setLoading(false);
    }
  };

  const fetchOperationDetails = async (operationId) => {
    try {
      const response = await axios.get(`/api/operations/${operationId}/details`);
      setOperationDetails(response.data);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error fetching operation details:', error);
      // If details endpoint fails, create a basic details object from the operation
      const operation = operations.find(op => op.id === operationId);
      if (operation) {
        setOperationDetails({
          imagesMirrored: 0,
          operatorsMirrored: 0,
          totalSize: 0,
          platformImages: 0,
          additionalImages: 0,
          helmCharts: 0,
          configFile: operation.configFile,
          status: operation.status
        });
      }
    }
  };

  const handleOperationSelect = (operation) => {
    setSelectedOperation(operation);
    fetchOperationDetails(operation.id);
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

  const formatFileSize = (bytes) => {
    if (!bytes) return '-';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  const filteredOperations = operations.filter(op => {
    if (filter === 'all') return true;
    return op.status === filter;
  });

  const exportHistory = () => {
    const csvContent = [
      ['Operation Name', 'Status', 'Started', 'Duration', 'Config File', 'Error Message'],
      ...filteredOperations.map(op => [
        op.name,
        op.status,
        new Date(op.startedAt).toLocaleString(),
        formatDuration(op.duration),
        op.configFile,
        op.errorMessage || ''
      ])
    ].map(row => row.map(field => `"${field}"`).join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mirror-history-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearLog = () => {
    setLiveLog('');
  };

  if (loading) {
    return (
      <div className="text-center">
        <div className="loading"></div>
        <p>Loading history...</p>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <h2>📋 Operation History</h2>
        <p className="text-muted">
          View detailed history of all mirror operations.
        </p>
      </div>

      <div className="card">
        <div className="flex-between">
          <h3>🔍 Filter Operations</h3>
          <div className="flex">
            <select 
              className="form-control"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ width: 'auto', marginRight: '1rem' }}
            >
              <option value="all">📊 All Operations</option>
              <option value="success">✅ Successful</option>
              <option value="failed">❌ Failed</option>
              <option value="stopped">⏹️ Stopped</option>
            </select>
            <button 
              className="btn btn-secondary"
              onClick={exportHistory}
            >
              📥 Export CSV
            </button>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="card" style={{ flex: 2 }}>
          <h3>📋 Operations List</h3>
          {filteredOperations.length === 0 ? (
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
                  </tr>
                </thead>
                <tbody>
                  {filteredOperations.map((op) => (
                    <tr 
                      key={op.id} 
                      style={{ 
                        borderBottom: '1px solid #e9ecef',
                        cursor: 'pointer',
                        backgroundColor: selectedOperation?.id === op.id ? '#f8f9fa' : 'transparent'
                      }}
                      onClick={() => handleOperationSelect(op)}
                    >
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedOperation && (
          <div className="card" style={{ flex: 3, marginLeft: '2rem' }}>
            <h3>🔍 Operation Details</h3>
            <div>
              <div className="grid">
                <div>
                  <strong>Name:</strong> {selectedOperation.name}
                </div>
                <div>
                  <strong>Status:</strong> 
                  <span className={`status-indicator ${getStatusColor(selectedOperation.status)}`}></span>
                  <span className={getStatusClass(selectedOperation.status)}>
                    {getStatusText(selectedOperation.status)}
                  </span>
                </div>
                <div>
                  <strong>Started:</strong> {new Date(selectedOperation.startedAt).toLocaleString()}
                </div>
                {selectedOperation.completedAt && (
                  <div>
                    <strong>Completed:</strong> {new Date(selectedOperation.completedAt).toLocaleString()}
                  </div>
                )}
                <div>
                  <strong>Duration:</strong> {formatDuration(selectedOperation.duration)}
                </div>
                <div>
                  <strong>Config File:</strong> {selectedOperation.configFile}
                </div>
              </div>

              {selectedOperation.errorMessage && (
                <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: '4px', color: '#721c24' }}>
                  <strong>Error:</strong> {selectedOperation.errorMessage}
                </div>
              )}

              {operationDetails && (
                <div style={{ marginTop: '1rem' }}>
                  <h4>📊 Operation Statistics</h4>
                  <div className="grid">
                    <div>🖼️ Images Mirrored: {operationDetails.imagesMirrored || 0}</div>
                    <div>⚙️ Operators Mirrored: {operationDetails.operatorsMirrored || 0}</div>
                    <div>💾 Total Size: {formatFileSize(operationDetails.totalSize || 0)}</div>
                    <div>🖥️ Platform Images: {operationDetails.platformImages || 0}</div>
                    <div>➕ Additional Images: {operationDetails.additionalImages || 0}</div>
                    <div>📦 Helm Charts: {operationDetails.helmCharts || 0}</div>
                  </div>
                  <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: '4px' }}>
                    <strong>📋 Configuration File:</strong> {operationDetails.configFile || selectedOperation.configFile}
                  </div>
                </div>
              )}

              <div className="log-viewer">
                <div className="log-viewer-header">
                  <h4>📝 Live Log Output</h4>
                  <div className="log-controls">
                    <button 
                      className={`log-control-btn ${autoScroll ? 'active' : ''}`}
                      onClick={() => setAutoScroll(!autoScroll)}
                      title="Toggle auto-scroll"
                    >
                      {autoScroll ? '🔒' : '🔓'} Auto-scroll
                    </button>
                    <button 
                      className={`log-control-btn ${isPaused ? 'active' : ''}`}
                      onClick={() => setIsPaused(!isPaused)}
                      title="Pause/Resume log updates"
                    >
                      {isPaused ? '▶️' : '⏸️'} {isPaused ? 'Resume' : 'Pause'}
                    </button>
                    <button 
                      className="log-control-btn"
                      onClick={clearLog}
                      title="Clear log"
                    >
                      🗑️ Clear
                    </button>
                  </div>
                </div>
                <div 
                  ref={logRef}
                  className="log-output"
                >
                  <pre style={{ margin: 0 }}>{liveLog || 'No log output available...'}</pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default History; 