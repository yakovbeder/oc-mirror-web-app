import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  PageSection,
  Card,
  CardBody,
  CardTitle,
  CardHeader,
  Grid,
  GridItem,
  Label,
  Title,
  Button,
  Spinner,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import {
  SyncAltIcon,
  CogIcon,
  CheckCircleIcon,
  TimesCircleIcon,
  InProgressIcon,
  HistoryIcon,
  ListIcon,
  HeartbeatIcon,
  ClockIcon,
} from '@patternfly/react-icons';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { useAlerts } from '../AlertContext';

interface Stats {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  runningOperations: number;
}

interface Operation {
  name: string;
  configFile: string;
  status: string;
  startedAt: string;
  duration: number | null;
}

interface SystemStatus {
  ocMirrorVersion: string;
  ocVersion: string;
  systemHealth: string;
}

type LabelColor = 'green' | 'red' | 'blue' | 'orange' | 'grey';

const getStatusLabelColor = (status: string): LabelColor => {
  switch (status) {
    case 'healthy':
      return 'green';
    case 'degraded':
    case 'warning':
      return 'orange';
    case 'error':
      return 'red';
    case 'running':
      return 'blue';
    default:
      return 'grey';
  }
};

const getStatusText = (status: string): string => {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'degraded':
      return 'Low Disk Space';
    case 'warning':
      return 'Last Operation Failed/Stopped';
    case 'error':
      return 'Error';
    case 'running':
      return 'Running';
    default:
      return 'Unknown';
  }
};

const getOperationLabelColor = (status: string): LabelColor => {
  switch (status) {
    case 'success':
      return 'green';
    case 'running':
      return 'blue';
    case 'failed':
    case 'stopped':
      return 'red';
    default:
      return 'grey';
  }
};

const getOperationStatusText = (status: string): string => {
  switch (status) {
    case 'success':
      return 'Success';
    case 'running':
      return 'Running';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Unknown';
  }
};

const getOperationStatusIcon = (status: string) => {
  switch (status) {
    case 'success':
      return <CheckCircleIcon />;
    case 'running':
      return <InProgressIcon />;
    case 'failed':
    case 'stopped':
      return <TimesCircleIcon />;
    default:
      return null;
  }
};

const Dashboard: React.FC = () => {
  const { addDangerAlert } = useAlerts();
  const navigate = useNavigate();

  const [stats, setStats] = useState<Stats>({
    totalOperations: 0,
    successfulOperations: 0,
    failedOperations: 0,
    runningOperations: 0,
  });
  const [recentOperations, setRecentOperations] = useState<Operation[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    ocMirrorVersion: '',
    ocVersion: '',
    systemHealth: 'unknown',
  });
  const [loading, setLoading] = useState(true);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, operationsRes, statusRes] = await Promise.all([
        axios.get('/api/stats'),
        axios.get('/api/operations/recent'),
        axios.get('/api/system/status'),
      ]);
      setStats(statsRes.data);
      setRecentOperations(operationsRes.data);
      setSystemStatus(statusRes.data);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      addDangerAlert('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastOperation = recentOperations.length > 0 ? recentOperations[0] : null;

  if (loading) {
    return (
      <PageSection>
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <Spinner aria-label="Loading dashboard" />
          <Title headingLevel="h3" style={{ marginTop: '1rem' }}>
            Loading dashboard...
          </Title>
        </div>
      </PageSection>
    );
  }

  return (
    <>
      {/* System Overview */}
      <PageSection>
        <Card>
          <CardHeader>
            <CardTitle>
              <Title headingLevel="h2">
                <HeartbeatIcon style={{ marginRight: '0.5rem' }} />
                System Overview
              </Title>
            </CardTitle>
          </CardHeader>
          <CardBody>
            <Grid hasGutter>
              <GridItem md={4}>
                <Card isPlain>
                  <CardBody>
                    <DescriptionList>
                      <DescriptionListGroup>
                        <DescriptionListTerm>
                          <SyncAltIcon style={{ marginRight: '0.5rem' }} />
                          OC Mirror Version
                        </DescriptionListTerm>
                        <DescriptionListDescription>
                          {systemStatus.ocMirrorVersion || 'Not available'}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </CardBody>
                </Card>
              </GridItem>
              <GridItem md={4}>
                <Card isPlain>
                  <CardBody>
                    <DescriptionList>
                      <DescriptionListGroup>
                        <DescriptionListTerm>
                          <CogIcon style={{ marginRight: '0.5rem' }} />
                          OC Version
                        </DescriptionListTerm>
                        <DescriptionListDescription>
                          {systemStatus.ocVersion || 'Not available'}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </CardBody>
                </Card>
              </GridItem>
              <GridItem md={4}>
                <Card isPlain>
                  <CardBody>
                    <DescriptionList>
                      <DescriptionListGroup>
                        <DescriptionListTerm>System Health</DescriptionListTerm>
                        <DescriptionListDescription>
                          <Label color={getStatusLabelColor(systemStatus.systemHealth)}>
                            {getStatusText(systemStatus.systemHealth)}
                          </Label>
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </CardBody>
                </Card>
              </GridItem>
            </Grid>
          </CardBody>
        </Card>
      </PageSection>

      {/* Operation Statistics */}
      <PageSection>
        <Card>
          <CardHeader>
            <CardTitle>
              <Title headingLevel="h2">
                <ListIcon style={{ marginRight: '0.5rem' }} />
                Operation Statistics
              </Title>
            </CardTitle>
          </CardHeader>
          <CardBody>
            <Grid hasGutter>
              <GridItem md={3} sm={6}>
                <Card>
                  <CardBody style={{ textAlign: 'center' }}>
                    <Title headingLevel="h3" size="4xl">
                      {stats.totalOperations}
                    </Title>
                    <Label color="blue">Total Operations</Label>
                  </CardBody>
                </Card>
              </GridItem>
              <GridItem md={3} sm={6}>
                <Card>
                  <CardBody style={{ textAlign: 'center' }}>
                    <Title headingLevel="h3" size="4xl">
                      {stats.successfulOperations}
                    </Title>
                    <Label color="green" icon={<CheckCircleIcon />}>
                      Successful
                    </Label>
                  </CardBody>
                </Card>
              </GridItem>
              <GridItem md={3} sm={6}>
                <Card>
                  <CardBody style={{ textAlign: 'center' }}>
                    <Title headingLevel="h3" size="4xl">
                      {stats.failedOperations}
                    </Title>
                    <Label color="red" icon={<TimesCircleIcon />}>
                      Failed
                    </Label>
                  </CardBody>
                </Card>
              </GridItem>
              <GridItem md={3} sm={6}>
                <Card>
                  <CardBody style={{ textAlign: 'center' }}>
                    <Title headingLevel="h3" size="4xl">
                      {stats.runningOperations}
                    </Title>
                    <Label color="blue" icon={<InProgressIcon />}>
                      Running
                    </Label>
                  </CardBody>
                </Card>
              </GridItem>
            </Grid>
            {lastOperation && (
              <div style={{ marginTop: '1rem' }}>
                <Label color={getOperationLabelColor(lastOperation.status)} icon={<ClockIcon />}>
                  Last Operation: {getOperationStatusText(lastOperation.status)}
                </Label>
              </div>
            )}
          </CardBody>
        </Card>
      </PageSection>

      {/* Recent Operations */}
      <PageSection>
        <Card>
          <CardHeader>
            <CardTitle>
              <Title headingLevel="h2">
                <HistoryIcon style={{ marginRight: '0.5rem' }} />
                Recent Operations
              </Title>
            </CardTitle>
          </CardHeader>
          <CardBody>
            {recentOperations.length === 0 ? (
              <EmptyState>
                <EmptyStateBody>No recent operations found.</EmptyStateBody>
              </EmptyState>
            ) : (
              <Table aria-label="Recent operations">
                <Thead>
                  <Tr>
                    <Th>Operation</Th>
                    <Th>Status</Th>
                    <Th>Started</Th>
                    <Th>Duration</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {recentOperations.map((op, index) => (
                    <Tr key={index}>
                      <Td dataLabel="Operation">
                        <div>
                          <div style={{ fontWeight: 700 }}>{op.name}</div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--pf-v6-global--Color--200)' }}>{op.configFile}</div>
                        </div>
                      </Td>
                      <Td dataLabel="Status">
                        <Label
                          color={getOperationLabelColor(op.status)}
                          icon={getOperationStatusIcon(op.status)}
                        >
                          {getOperationStatusText(op.status)}
                        </Label>
                      </Td>
                      <Td dataLabel="Started">{new Date(op.startedAt).toLocaleString()}</Td>
                      <Td dataLabel="Duration">{op.duration ? `${op.duration}s` : '-'}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </PageSection>

      {/* Quick Actions */}
      <PageSection>
        <Card>
          <CardHeader>
            <CardTitle>
              <Title headingLevel="h2">Quick Actions</Title>
            </CardTitle>
          </CardHeader>
          <CardBody>
            <Grid hasGutter>
              <GridItem>
                <Button variant="primary" icon={<CogIcon />} onClick={() => navigate('/config')}>
                  Create New Configuration
                </Button>
              </GridItem>
              <GridItem>
                <Button
                  variant="secondary"
                  icon={<SyncAltIcon />}
                  onClick={() => navigate('/operations')}
                >
                  View All Operations
                </Button>
              </GridItem>
              <GridItem>
                <Button
                  variant="tertiary"
                  icon={<HistoryIcon />}
                  onClick={() => navigate('/history')}
                >
                  View History
                </Button>
              </GridItem>
            </Grid>
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
};

export default Dashboard;
