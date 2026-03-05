import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import {
  Page,
  Masthead,
  MastheadMain,
  MastheadBrand,
  MastheadContent,
  PageSidebar,
  PageSidebarBody,
  PageSection,
  Nav,
  NavList,
  NavItem,
  Brand,
  Label,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import {
  TachometerAltIcon,
  CogIcon,
  SyncAltIcon,
  HistoryIcon,
  WrenchIcon,
} from '@patternfly/react-icons';
import { AlertProvider } from './AlertContext';
import redhatLogo from '/redhat-logo.svg';

const Dashboard = lazy(() => import('./components/Dashboard'));
const MirrorConfig = lazy(() => import('./components/MirrorConfig'));
const MirrorOperations = lazy(() => import('./components/MirrorOperations'));
const History = lazy(() => import('./components/History'));
const Settings = lazy(() => import('./components/Settings'));

interface NavRoute {
  path: string;
  label: string;
  icon: React.ReactNode;
  component: React.LazyExoticComponent<React.ComponentType>;
}

const navRoutes: NavRoute[] = [
  { path: '/', label: 'Dashboard', icon: <TachometerAltIcon />, component: Dashboard },
  { path: '/config', label: 'Mirror Configuration', icon: <CogIcon />, component: MirrorConfig },
  { path: '/operations', label: 'Mirror Operations', icon: <SyncAltIcon />, component: MirrorOperations },
  { path: '/history', label: 'History', icon: <HistoryIcon />, component: History },
  { path: '/settings', label: 'Settings', icon: <WrenchIcon />, component: Settings },
];

const AppLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const sidebar = (
    <PageSidebar>
      <PageSidebarBody>
        <Nav>
          <NavList>
            {navRoutes.map((item) => (
              <NavItem
                key={item.path}
                itemId={item.path}
                isActive={location.pathname === item.path}
                onClick={() => navigate(item.path)}
                icon={item.icon}
                style={{ fontSize: '1rem' }}
              >
                {item.label}
              </NavItem>
            ))}
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  );

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadBrand>
          <Brand src={redhatLogo} alt="Red Hat" heights={{ default: '36px' }} />
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <span style={{ fontWeight: 600, fontSize: '1rem' }}>
                OC Mirror v2 Web Application
              </span>
            </ToolbarItem>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <Label color="blue">v4.0</Label>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );

  return (
    <Page masthead={masthead} sidebar={sidebar}>
      <PageSection>
        <Suspense
          fallback={
            <div style={{ textAlign: 'center', padding: '3rem' }}>
              <Spinner aria-label="Loading page" />
            </div>
          }
        >
          <Routes>
            {navRoutes.map((item) => (
              <Route key={item.path} path={item.path} element={<item.component />} />
            ))}
          </Routes>
        </Suspense>
      </PageSection>
    </Page>
  );
};

const App: React.FC = () => (
  <AlertProvider>
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  </AlertProvider>
);

export default App;
