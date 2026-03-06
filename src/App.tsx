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
  Title,
  Content,
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
import redhatLogo from '/Logo-Red.svg';

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
        <Toolbar style={{ width: '100%' }}>
          <ToolbarContent>
            <ToolbarItem>
              <div style={{ borderLeft: '1px solid var(--pf-v6-global--BorderColor--100)', paddingLeft: '16px', marginLeft: '8px' }}>
                <Title headingLevel="h1" size="2xl" style={{ lineHeight: 1.2, fontSize: '2rem' }}>OC Mirror v2 Web Application</Title>
                <Content component="p" style={{ color: 'var(--pf-v6-global--Color--200)', fontSize: '1.25rem', lineHeight: 1.2 }}>
                  OpenShift Container Platform Mirroring Operations
                </Content>
              </div>
            </ToolbarItem>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <Label color="blue">v4.2</Label>
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
