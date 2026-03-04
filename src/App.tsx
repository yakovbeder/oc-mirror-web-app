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
  Label,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Flex,
  FlexItem,
} from '@patternfly/react-core';
import {
  TachometerAltIcon,
  CogIcon,
  SyncAltIcon,
  HistoryIcon,
  WrenchIcon,
} from '@patternfly/react-icons';
import { AlertProvider } from './AlertContext';

const Dashboard = lazy(() => import('./components/Dashboard'));
const MirrorConfig = lazy(() => import('./components/MirrorConfig'));
const MirrorOperations = lazy(() => import('./components/MirrorOperations'));
const History = lazy(() => import('./components/History'));
const Settings = lazy(() => import('./components/Settings'));

const RedHatLogo: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 613 145" width="110" height="26">
    <path
      d="M127.4 104.3c12.2 0 21.1-2 21.1-13.3 0-3.7-.7-8.2-1.7-12.5l-7.8-33.7c-1.7-7.5-5.7-10.5-12.5-10.5-8.7 0-16 8.5-16 17.7 0 2.5.5 5 1 7l9.5 35c1 3 2.7 10.3 6.4 10.3zm44.6 5.7c0 9-30.2 18-53.5 18-34.5 0-48-17-48-34.2 0-3.5.5-6.7 1.5-10-9.2 0-18.2-.5-18.2-10.5 0-14 14-25.7 29.2-25.7 1.7 0 3.5 0 5.2.5-1-3.5-1.5-6.7-1.5-10 0-20 17.5-37.5 37.7-37.5 16.7 0 28.7 9.7 33.7 25l8.2 34.2c2 8 3.5 14 3.5 19.2 0 3-.5 5.5-1 7.5 6 1 3.2 23.5 3.2 23.5z"
      fill="#e00"
    />
    <path
      d="M127.4 104.3c-3.7 0-5.5-7.3-6.5-10.3l-9.5-35c-.5-2-.7-4.5-.7-7 0-9.2 7-17.7 15.7-17.7 7 0 10.7 3 12.5 10.5l7.7 33.7c1 4.2 1.7 8.7 1.7 12.5 0 11.3-8.7 13.3-20.9 13.3zm16 5.7c.5-2 1-4.5 1-7.5 0-5.2-1.5-11.2-3.5-19.2l-8-34.2c-5-15.2-17-25-33.7-25-20.2 0-37.7 17.5-37.7 37.5 0 3.5.5 6.7 1.5 10-1.7-.5-3.5-.5-5.2-.5-15.2 0-29.2 11.7-29.2 25.7 0 10 9 10.5 18.2 10.5-1 3.2-1.5 6.5-1.5 10 0 17.2 13.5 34.2 48 34.2 23.5 0 53.5-9 53.5-18 0 0 2.7-22.5-3.4-23.5z"
      fill="#2d2d2d"
    />
    <g fill="#fff">
      <path d="M213 82.4V55h11.7c9 0 13 3.7 13 12.5 0 9.2-4.2 14.7-14 14.7H213zm7.5-6.5h3.5c4.2 0 5.7-3.2 5.7-8.2 0-4.2-1.2-6.2-5.7-6.2h-3.5v14.5zM247.7 82.4V55h21v6.5h-13.5v4h12v6h-12v4.5H269v6.5h-21.3zM279 82.4V55h12.5c8.5 0 12 3.7 12 11.7 0 5.7-2 9.5-6 11.2l7 4.5h-9.5l-5.2-4.2c-.7 0-1.5.2-2.2.2h-1.2v3.7h-7.5zm7.5-10.2h4c3.7 0 5.5-1.7 5.5-5.7 0-3.7-1.5-5.2-5.5-5.2h-4v10.7zM316 82.4V55h7.5v27.5H316z" />
      <path d="M337 55l5.7 14.7L348.5 55h8l-10.7 27.5h-8L327 55h10zM365.2 82.4V55h21v6.5H373v4h12v6h-12v4.5h13.7v6.5h-21.5zM396.7 82.4V55h11.7c9 0 13 3.7 13 12.5 0 9.2-4.2 14.7-14 14.7h-10.7zm7.5-6.5h3.5c4.2 0 5.7-3.2 5.7-8.2 0-4.2-1.2-6.2-5.7-6.2h-3.5v14.5z" />
      <path d="M444.2 82.4V55h13c8.2 0 11.7 3.5 11.7 10.7 0 4.5-1.5 7.5-4.2 9.5l5.5 7.2h-8.7l-4.5-6h-5.2v6h-7.5zm7.5-12.2h4c3.7 0 5.2-1.5 5.2-4.7 0-3-1.5-4.2-5.2-4.2h-4v8.7zM478.5 82.4V55h21v6.5H486v4h12.2v6H486v4.5h14v6.5h-21.5zM509 82.4V55h7.5v27.5H509zM528.5 82.4V55h7.5v21h13.5v6.5h-21z" />
      <path d="M564.5 82.4h-7.7l12-27.5h8l12 27.5h-8l-2-5.2h-12.2l-2 5.2zm5.2-11.2h7.5l-3.7-10-3.7 10zM596.5 82.4V61.7h-8.7V55h25v6.7H604v20.7h-7.5z" />
    </g>
    <g fill="#fff">
      <path d="M213 126.4V99h7.5v10.7h10.5V99h7.5v27.5h-7.5v-10.2h-10.5v10.2H213zM249.7 126.4h-7.7l12-27.5h8l12 27.5h-8l-2-5.2H252l-2.2 5.2zm5.2-11.2h7.5l-3.7-10-3.7 10zM283.2 126.4V105.7h-8.7V99h25v6.7h-8.7v20.7h-7.5z" />
    </g>
  </svg>
);

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
    <Masthead style={{ backgroundColor: '#151515' }}>
      <MastheadMain>
        <MastheadBrand>
          <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapMd' }}>
            <FlexItem>
              <RedHatLogo />
            </FlexItem>
            <FlexItem>
              <span style={{ color: '#fff', fontSize: '0.875rem', opacity: 0.8 }}>
                OC Mirror v2 Web Application
              </span>
            </FlexItem>
          </Flex>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
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
