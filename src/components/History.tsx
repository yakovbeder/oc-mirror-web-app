import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import {
  Card,
  CardBody,
  CardTitle,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  FormSelect,
  FormSelectOption,
  Label,
  Button,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  CodeBlock,
  CodeBlockCode,
  Alert,
  Spinner,
  Title,
  Split,
  SplitItem,
  EmptyState,
  EmptyStateBody,
  Flex,
  FlexItem,
} from '@patternfly/react-core';
import {
  HistoryIcon,
  SearchIcon,
  DownloadIcon,
  CheckCircleIcon,
  TimesCircleIcon,
  StopIcon,
  SyncAltIcon,
  OutlinedClockIcon,
  LockIcon,
  LockOpenIcon,
  PauseIcon,
  PlayIcon,
  TrashAltIcon,
  ListIcon,
} from '@patternfly/react-icons';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { useAlerts } from '../AlertContext';

interface Operation {
  id: string;
  name: string;
  configFile: string;
  status: 'running' | 'success' | 'failed' | 'stopped';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  errorMessage?: string;
}

interface OperationDetails {
  imagesMirrored?: number;
  operatorsMirrored?: number;
  totalSize?: number;
  platformImages?: number;
  additionalImages?: number;
  helmCharts?: number;
  configFile?: string;
  status?: string;
}

const History: React.FC = () => {
  const { addDangerAlert } = useAlerts();

  const [operations, setOperations] = useState<Operation[]>([]);
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null);
  const [operationDetails, setOperationDetails] = useState<OperationDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [liveLog, setLiveLog] = useState('');
  const [logSource, setLogSource] = useState<EventSource | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/operations/history');
      setOperations(response.data);
    } catch (error) {
      console.error('Error fetching history:', error);
      addDangerAlert('Failed to load operation history');
    } finally {
      setLoading(false);
    }
  }, [addDangerAlert]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!selectedOperation) return;
    setLiveLog('');
    if (logSource) {
      logSource.close();
      setLogSource(null);
    }

    axios.get(`/api/operations/${selectedOperation.id}/logs`).then(res => {
      setLiveLog(res.data.logs || '');
    }).catch(err => {
      console.error('Error fetching logs:', err);
      setLiveLog('No logs available for this operation.');
    });

    if (selectedOperation.status === 'running') {
      try {
        const es = new EventSource(`/api/operations/${selectedOperation.id}/logstream`);
        es.onmessage = (e) => {
          if (!isPaused) {
            setLiveLog((prev) => prev + (e.data ? e.data + '\n' : ''));
          }
        };
        es.onerror = () => {
          es.close();
        };
        setLogSource(es);
        return () => {
          es.close();
        };
      } catch (error) {
        console.error('Error setting up SSE connection:', error);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOperation, isPaused]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [liveLog, autoScroll]);

  const fetchOperationDetails = async (operationId: string) => {
    try {
      const response = await axios.get(`/api/operations/${operationId}/details`);
      setOperationDetails(response.data);
    } catch (error) {
      console.error('Error fetching operation details:', error);
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
          status: operation.status,
        });
      }
    }
  };

  const handleOperationSelect = (operation: Operation) => {
    setSelectedOperation(operation);
    fetchOperationDetails(operation.id);
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'success':
        return <Label color="green" icon={<CheckCircleIcon />}>Success</Label>;
      case 'running':
        return <Label color="blue" icon={<SyncAltIcon />}>Running</Label>;
      case 'failed':
        return <Label color="red" icon={<TimesCircleIcon />}>Failed</Label>;
      case 'stopped':
        return <Label color="orange" icon={<StopIcon />}>Stopped</Label>;
      default:
        return <Label color="grey">Unknown</Label>;
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  const formatFileSize = (bytes?: number) => {
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
        op.errorMessage || '',
      ]),
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
      <EmptyState>
        <Spinner size="xl" />
        <EmptyStateBody>Loading history...</EmptyStateBody>
      </EmptyState>
    );
  }

  return (
    <div>
      <Card>
        <CardBody>
          <Title headingLevel="h2">
            <HistoryIcon /> Operation History
          </Title>
          <p>View detailed history of all mirror operations.</p>
        </CardBody>
      </Card>

      <Card style={{ marginTop: '1rem' }}>
        <CardBody>
          <Toolbar>
            <ToolbarContent>
              <ToolbarItem>
                <FormSelect
                  value={filter}
                  onChange={(_event, value) => setFilter(value)}
                  aria-label="Filter operations"
                >
                  <FormSelectOption value="all" label="All Operations" />
                  <FormSelectOption value="success" label="Successful" />
                  <FormSelectOption value="failed" label="Failed" />
                  <FormSelectOption value="stopped" label="Stopped" />
                  <FormSelectOption value="running" label="Running" />
                </FormSelect>
              </ToolbarItem>
              <ToolbarItem>
                <Button variant="secondary" icon={<DownloadIcon />} onClick={exportHistory}>
                  Export CSV
                </Button>
              </ToolbarItem>
            </ToolbarContent>
          </Toolbar>
        </CardBody>
      </Card>

      <Split hasGutter style={{ marginTop: '1rem' }}>
        <SplitItem isFilled style={{ minWidth: 0 }}>
          <Card>
            <CardBody>
              <Title headingLevel="h3" style={{ marginBottom: '1rem' }}>
                <ListIcon /> Operations List
              </Title>
              {filteredOperations.length === 0 ? (
                <EmptyState>
                  <SearchIcon />
                  <EmptyStateBody>No operations found.</EmptyStateBody>
                </EmptyState>
              ) : (
                <Table aria-label="Operations list">
                  <Thead>
                    <Tr>
                      <Th>Operation</Th>
                      <Th>Status</Th>
                      <Th>Started</Th>
                      <Th>Duration</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {filteredOperations.map((op) => (
                      <Tr
                        key={op.id}
                        isSelectable
                        isClickable
                        isRowSelected={selectedOperation?.id === op.id}
                        onRowClick={() => handleOperationSelect(op)}
                      >
                        <Td dataLabel="Operation">
                          <div>
                            <div style={{ fontWeight: 700 }}>{op.name}</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--pf-v6-global--Color--200)' }}>{op.configFile}</div>
                          </div>
                        </Td>
                        <Td dataLabel="Status">
                          {getStatusLabel(op.status)}
                        </Td>
                        <Td dataLabel="Started">
                          {new Date(op.startedAt).toLocaleString()}
                        </Td>
                        <Td dataLabel="Duration">
                          <OutlinedClockIcon /> {formatDuration(op.duration)}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </CardBody>
          </Card>
        </SplitItem>

        {selectedOperation && (
          <SplitItem isFilled style={{ minWidth: 0 }}>
            <Card>
              <CardBody>
                <Title headingLevel="h3" style={{ marginBottom: '1rem' }}>
                  <SearchIcon /> Operation Details
                </Title>

                <DescriptionList isHorizontal>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Name</DescriptionListTerm>
                    <DescriptionListDescription>{selectedOperation.name}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Status</DescriptionListTerm>
                    <DescriptionListDescription>{getStatusLabel(selectedOperation.status)}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Started</DescriptionListTerm>
                    <DescriptionListDescription>{new Date(selectedOperation.startedAt).toLocaleString()}</DescriptionListDescription>
                  </DescriptionListGroup>
                  {selectedOperation.completedAt && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>Completed</DescriptionListTerm>
                      <DescriptionListDescription>{new Date(selectedOperation.completedAt).toLocaleString()}</DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                  <DescriptionListGroup>
                    <DescriptionListTerm>Duration</DescriptionListTerm>
                    <DescriptionListDescription>{formatDuration(selectedOperation.duration)}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Config File</DescriptionListTerm>
                    <DescriptionListDescription>{selectedOperation.configFile}</DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>

                {selectedOperation.errorMessage && (
                  <Alert
                    variant="danger"
                    isInline
                    title="Error"
                    style={{ marginTop: '1rem' }}
                  >
                    {selectedOperation.errorMessage}
                  </Alert>
                )}

                {operationDetails && (
                  <div style={{ marginTop: '1rem' }}>
                    <Title headingLevel="h4" style={{ marginBottom: '0.5rem' }}>
                      Operation Statistics
                    </Title>
                    <DescriptionList isHorizontal columnModifier={{ default: '2Col' }}>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Images Mirrored</DescriptionListTerm>
                        <DescriptionListDescription>{operationDetails.imagesMirrored || 0}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Operators Mirrored</DescriptionListTerm>
                        <DescriptionListDescription>{operationDetails.operatorsMirrored || 0}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Total Size</DescriptionListTerm>
                        <DescriptionListDescription>{formatFileSize(operationDetails.totalSize)}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Platform Images</DescriptionListTerm>
                        <DescriptionListDescription>{operationDetails.platformImages || 0}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Additional Images</DescriptionListTerm>
                        <DescriptionListDescription>{operationDetails.additionalImages || 0}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Helm Charts</DescriptionListTerm>
                        <DescriptionListDescription>{operationDetails.helmCharts || 0}</DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                    <Alert
                      variant="info"
                      isInline
                      isPlain
                      title={`Configuration File: ${operationDetails.configFile || selectedOperation.configFile}`}
                      style={{ marginTop: '1rem' }}
                    />
                  </div>
                )}

                <div style={{ marginTop: '1.5rem' }}>
                  <Flex
                    justifyContent={{ default: 'justifyContentSpaceBetween' }}
                    alignItems={{ default: 'alignItemsCenter' }}
                    style={{ marginBottom: '0.5rem' }}
                  >
                    <FlexItem>
                      <Title headingLevel="h4">
                        <ListIcon /> Log Output
                      </Title>
                    </FlexItem>
                    <FlexItem>
                      <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                        <FlexItem>
                          <Button
                            variant={autoScroll ? 'primary' : 'secondary'}
                            icon={autoScroll ? <LockIcon /> : <LockOpenIcon />}
                            onClick={() => setAutoScroll(!autoScroll)}
                            isSmall
                          >
                            Auto-scroll
                          </Button>
                        </FlexItem>
                        <FlexItem>
                          <Button
                            variant={isPaused ? 'warning' : 'secondary'}
                            icon={isPaused ? <PlayIcon /> : <PauseIcon />}
                            onClick={() => setIsPaused(!isPaused)}
                            isSmall
                          >
                            {isPaused ? 'Resume' : 'Pause'}
                          </Button>
                        </FlexItem>
                        <FlexItem>
                          <Button
                            variant="secondary"
                            icon={<TrashAltIcon />}
                            onClick={clearLog}
                            isSmall
                          >
                            Clear
                          </Button>
                        </FlexItem>
                      </Flex>
                    </FlexItem>
                  </Flex>
                  <div ref={logRef} style={{ maxHeight: '400px', overflow: 'auto' }}>
                    <CodeBlock>
                      <CodeBlockCode>{liveLog || 'No log output available...'}</CodeBlockCode>
                    </CodeBlock>
                  </div>
                </div>
              </CardBody>
            </Card>
          </SplitItem>
        )}
      </Split>
    </div>
  );
};

export default History;
