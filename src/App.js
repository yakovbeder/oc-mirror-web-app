import React, { useState, useEffect, Suspense, lazy, useMemo, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';

// Lazy load components for better performance
const Dashboard = lazy(() => import('./components/Dashboard'));
const MirrorConfig = lazy(() => import('./components/MirrorConfig'));
const MirrorOperations = lazy(() => import('./components/MirrorOperations'));
const History = lazy(() => import('./components/History'));
const Settings = lazy(() => import('./components/Settings'));

// Loading component with better UX
const LoadingSpinner = () => (
  <div className="text-center" style={{ padding: '2rem' }}>
    <div className="loading"></div>
    <p>Loading...</p>
  </div>
);

// Hamburger Icon Component
const HamburgerIcon = ({ isOpen }) => (
  <div className={`hamburger-icon ${isOpen ? 'open' : ''}`}>
    <span></span>
    <span></span>
    <span></span>
  </div>
);

// Memoized Side Menu Item Component
const SideMenuItem = React.memo(({ 
  to, 
  icon, 
  label, 
  isActive, 
  isCollapsed, 
  onClick 
}) => {
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  }, [onClick]);

  return (
    <div 
      className={`side-menu-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={isCollapsed ? label : undefined}
      aria-current={isActive ? 'page' : undefined}
      title={isCollapsed ? label : undefined}
    >
      <Link 
        to={to} 
        style={{ 
          textDecoration: 'none', 
          color: 'inherit', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.7rem',
          width: '100%'
        }}
        onClick={(e) => e.preventDefault()} // Prevent default to handle with our onClick
      >
        <span className="side-menu-icon" aria-hidden="true">{icon}</span>
        {!isCollapsed && <span className="side-menu-label">{label}</span>}
      </Link>
    </div>
  );
});

SideMenuItem.displayName = 'SideMenuItem';

// Side Menu Content Component with Location Awareness
const SideMenuContent = React.memo(({ 
  navigationItems, 
  sidebarCollapsed, 
  toggleSidebar,
  navigate
}) => {
  const location = useLocation();
  return (
    <nav className={`side-menu${sidebarCollapsed ? ' collapsed' : ''}`}>
      <div className="side-menu-item side-menu-hamburger" tabIndex={0} role="button" aria-label={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'} aria-expanded={!sidebarCollapsed} onClick={toggleSidebar}>
        <span className="side-menu-icon"><HamburgerIcon isOpen={!sidebarCollapsed} /></span>
      </div>
      {navigationItems.map((item) => (
        <SideMenuItem
          key={item.path}
          to={item.path}
          icon={item.icon}
          label={item.label}
          isActive={location.pathname === item.path}
          isCollapsed={sidebarCollapsed}
          onClick={() => navigate(item.path)}
        />
      ))}
    </nav>
  );
});

SideMenuContent.displayName = 'SideMenuContent';

// AppLayout component to use useNavigate inside Router context
function AppLayout({ navigationItems, sidebarCollapsed, toggleSidebar }) {
  const navigate = useNavigate();
  return (
    <div className="main-layout">
      <SideMenuContent 
        navigationItems={navigationItems}
        sidebarCollapsed={sidebarCollapsed}
        toggleSidebar={toggleSidebar}
        navigate={navigate}
      />
      <div className="main-content container">
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            {navigationItems.map((item) => (
              <Route 
                key={item.path} 
                path={item.path} 
                element={<item.component />} 
              />
            ))}
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}

// Main App Component
function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Memoized navigation items
  const navigationItems = useMemo(() => [
    { path: '/', icon: '📊', label: 'Dashboard', component: Dashboard },
    { path: '/config', icon: '⚙️', label: 'Mirror Configuration', component: MirrorConfig },
    { path: '/operations', icon: '🔄', label: 'Mirror Operations', component: MirrorOperations },
    { path: '/history', icon: '📋', label: 'History', component: History },
    { path: '/settings', icon: '🔧', label: 'Settings', component: Settings }
  ], []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);



  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMobileMenuOpen && !event.target.closest('.side-menu')) {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isMobileMenuOpen]);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, []);

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
                <span className="version-badge">v3.2</span>
              </div>
            </div>
          </div>
        </header>
        <AppLayout
          navigationItems={navigationItems}
          sidebarCollapsed={sidebarCollapsed}
          toggleSidebar={toggleSidebar}
        />
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