import React, { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';

// Lazy load components for better performance
const Dashboard = lazy(() => import('./components/Dashboard'));
const MirrorConfig = lazy(() => import('./components/MirrorConfig'));
const MirrorOperations = lazy(() => import('./components/MirrorOperations'));
const History = lazy(() => import('./components/History'));
const Settings = lazy(() => import('./components/Settings'));

// Loading component
const LoadingSpinner = () => (
  <div className="text-center" style={{ padding: '2rem' }}>
    <div className="loading"></div>
    <p>Loading...</p>
  </div>
);

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => !prev);
  };

  return (
    <Router>
      <div className="App">
        <header className="header">
          <div className="container">
            <div className="header-content">
              <div className="header-brand">
                <h1>🚀 OC Mirror v2 Web Application</h1>
                <p>OpenShift Container Platform Mirroring Operations</p>
              </div>
              <div className="header-version">
                <span className="version-badge">v2.0</span>
              </div>
            </div>
          </div>
        </header>

        <div className="main-layout">
          <nav className={`side-menu${sidebarCollapsed ? ' collapsed' : ''}`}>
            <button className="sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}>
              {sidebarCollapsed ? <span>&#x25B6;</span> : <span>&#x25C0;</span>}
            </button>
            <div 
              className={`side-menu-item ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => handleTabChange('dashboard')}
              title={sidebarCollapsed ? 'Dashboard' : ''}
            >
              <Link to="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                <span className="side-menu-icon">📊</span>
                {!sidebarCollapsed && <span className="side-menu-label">Dashboard</span>}
              </Link>
            </div>
            <div 
              className={`side-menu-item ${activeTab === 'config' ? 'active' : ''}`}
              onClick={() => handleTabChange('config')}
              title={sidebarCollapsed ? 'Mirror Configuration' : ''}
            >
              <Link to="/config" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                <span className="side-menu-icon">⚙️</span>
                {!sidebarCollapsed && <span className="side-menu-label">Mirror Configuration</span>}
              </Link>
            </div>
            <div 
              className={`side-menu-item ${activeTab === 'operations' ? 'active' : ''}`}
              onClick={() => handleTabChange('operations')}
              title={sidebarCollapsed ? 'Mirror Operations' : ''}
            >
              <Link to="/operations" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                <span className="side-menu-icon">🔄</span>
                {!sidebarCollapsed && <span className="side-menu-label">Mirror Operations</span>}
              </Link>
            </div>
            <div 
              className={`side-menu-item ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => handleTabChange('history')}
              title={sidebarCollapsed ? 'History' : ''}
            >
              <Link to="/history" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                <span className="side-menu-icon">📋</span>
                {!sidebarCollapsed && <span className="side-menu-label">History</span>}
              </Link>
            </div>
            <div 
              className={`side-menu-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => handleTabChange('settings')}
              title={sidebarCollapsed ? 'Settings' : ''}
            >
              <Link to="/settings" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                <span className="side-menu-icon">🔧</span>
                {!sidebarCollapsed && <span className="side-menu-label">Settings</span>}
              </Link>
            </div>
          </nav>

          <div className="main-content container">
            <Suspense fallback={<LoadingSpinner />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/config" element={<MirrorConfig />} />
                <Route path="/operations" element={<MirrorOperations />} />
                <Route path="/history" element={<History />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Suspense>
          </div>
        </div>

        <ToastContainer
          position="top-right"
          autoClose={5000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
        />
      </div>
    </Router>
  );
}

export default App; 