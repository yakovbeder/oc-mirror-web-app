import { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';

const Dashboard = () => {
  const [stats, setStats] = useState({
    totalOperations: 0,
    successfulOperations: 0,
    failedOperations: 0,
    runningOperations: 0
  });
  const [recentOperations, setRecentOperations] = useState([]);
  const [systemStatus, setSystemStatus] = useState({
    ocMirrorVersion: '',
    ocVersion: '',
    systemHealth: 'unknown'
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
    // Only start interval if component is still mounted after initial load
    const interval = setInterval(() => {
      fetchDashboardData();
    }, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, operationsRes, statusRes] = await Promise.all([
        axios.get('/api/stats'),
        axios.get('/api/operations/recent'),
        axios.get('/api/system/status')
      ]);

      setStats(statsRes.data);
      setRecentOperations(operationsRes.data);
      setSystemStatus(statusRes.data);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error fetching dashboard data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy': return 'status-success';
      case 'degraded': return 'status-warning';
      case 'warning': return 'status-warning2';
      case 'error': return 'status-error';
      case 'running': return 'status-running';
      default: return 'status-unknown';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'healthy': return 'Healthy';
      case 'degraded': return 'Low Disk Space';
      case 'warning': return 'Last Operation Failed/Stopped';
      case 'error': return 'Error';
      case 'running': return 'Running';
      default: return 'Unknown';
    }
  };

  const getStatusClass = (status) => {
    switch (status) {
      case 'healthy': return 'status-success-text';
      case 'degraded': return 'status-warning-text';
      case 'warning': return 'status-warning-text';
      case 'error': return 'status-error-text';
      case 'running': return 'status-running-text';
      default: return 'status-error-text';
    }
  };

  const getOperationStatusColor = (status) => {
    switch (status) {
      case 'success': return 'status-success';
      case 'running': return 'status-running';
      case 'failed': return 'status-error';
      case 'stopped': return 'status-error';
      default: return 'status-unknown';
    }
  };

  const getOperationStatusText = (status) => {
    switch (status) {
      case 'success': return 'Success';
      case 'running': return 'Running';
      case 'failed': return 'Failed';
      case 'stopped': return 'Stopped';
      default: return 'Unknown';
    }
  };

  const getOperationStatusClass = (status) => {
    switch (status) {
      case 'success': return 'status-success-text';
      case 'running': return 'status-running-text';
      case 'failed': return 'status-error-text';
      case 'stopped': return 'status-error-text';
      default: return 'status-error-text';
    }
  };

  // Find last operation status
  const lastOperation = recentOperations && recentOperations.length > 0 ? recentOperations[0] : null;
  const lastOperationStatus = lastOperation ? lastOperation.status : null;

  if (loading) {
    return (
      <div className="text-center">
        <div className="loading"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <h2>🖥️ System Overview</h2>
        <div className="grid">
          <div className="card">
            <h3>🔄 OC Mirror Version</h3>
            <p className="text-muted">{systemStatus.ocMirrorVersion || 'Not available'}</p>
          </div>
          <div className="card">
            <h3>⚙️ OC Version</h3>
            <p className="text-muted">{systemStatus.ocVersion || 'Not available'}</p>
          </div>
          <div className="card">
            <h3>💚 System Health</h3>
            <div className="flex">
              <span className={`status-indicator ${getStatusColor(systemStatus.systemHealth)}`}></span>
              <span className={getStatusClass(systemStatus.systemHealth)}>
                {getStatusText(systemStatus.systemHealth)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>📊 Operation Statistics</h2>
        <div className="grid">
          <div className="card">
            <h3>📋 Total Operations</h3>
            <p className="text-muted" style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--rh-blue)' }}>
              {stats.totalOperations}
            </p>
          </div>
          <div className="card">
            <h3>✅ Successful</h3>
            <p className="text-muted" style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--rh-green)' }}>
              {stats.successfulOperations}
            </p>
          </div>
          <div className="card">
            <h3>❌ Failed</h3>
            <p className="text-muted" style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--rh-red)' }}>
              {stats.failedOperations}
            </p>
          </div>
          <div className="card">
            <h3>🔄 Running</h3>
            <p className="text-muted" style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--rh-yellow)' }}>
              {stats.runningOperations}
            </p>
          </div>
          <div className="card">
            <h3>🕑 Last Operation Status</h3>
            <div className="flex">
              {lastOperation && (
                <>
                  <span className={`status-indicator ${getOperationStatusColor(lastOperationStatus)}`}></span>
                  <span className={getOperationStatusClass(lastOperationStatus)}>
                    {getOperationStatusText(lastOperationStatus)}
                  </span>
                </>
              )}
              {!lastOperation && <span className="text-muted">N/A</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>📋 Recent Operations</h2>
        {recentOperations.length === 0 ? (
          <p className="text-muted">No recent operations found.</p>
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
                {recentOperations.map((op, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid #e9ecef' }}>
                    <td style={{ padding: '1rem' }}>
                      <div>
                        <strong>{op.name}</strong>
                        <br />
                        <small className="text-muted">{op.configFile}</small>
                      </div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div className="flex">
                        <span className={`status-indicator ${getOperationStatusColor(op.status)}`}></span>
                        <span className={getOperationStatusClass(op.status)}>
                          {getOperationStatusText(op.status)}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      {new Date(op.startedAt).toLocaleString()}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      {op.duration ? `${op.duration}s` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>⚡ Quick Actions</h2>
        <div className="grid">
          <button className="btn btn-primary" onClick={() => window.location.href = '/config'}>
            ⚙️ Create New Configuration
          </button>
          <button className="btn btn-secondary" onClick={() => window.location.href = '/operations'}>
            🔄 View All Operations
          </button>
          <button className="btn btn-success" onClick={() => window.location.href = '/history'}>
            📋 View History
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard; 