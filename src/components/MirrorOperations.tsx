import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import {
  Card,
  CardBody,
  CardTitle,
  CardHeader,
  FormGroup,
  FormSelect,
  FormSelectOption,
  TextInput,
  Button,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalVariant,
  CodeBlock,
  CodeBlockCode,
  Spinner,
  Title,
  Flex,
  FlexItem,
  Popover,
  EmptyState,
  EmptyStateBody,
  Alert,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
} from '@patternfly/react-core';
import {
  SyncAltIcon,
  PlayIcon,
  StopIcon,
  TrashAltIcon,
  FolderIcon,
  ListIcon,
  CopyIcon,
  InfoCircleIcon,
  CheckCircleIcon,
  TimesCircleIcon,
  OutlinedClockIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@patternfly/react-icons';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { useAlerts } from '../AlertContext';

interface ConfigFile {
  name: string;
  size: string;
}

interface Operation {
  id: string;
  name: string;
  configFile: string;
  status: 'running' | 'success' | 'failed' | 'stopped';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  mirrorDestination?: string;
  errorMessage?: string;
}

const MirrorOperations: React.FC = () => {
  const { addSuccessAlert, addDangerAlert, addInfoAlert } = useAlerts();

  const [operations, setOperations] = useState<Operation[]>([]);
  const [selectedConfig, setSelectedConfig] = useState('');
  const [availableConfigs, setAvailableConfigs] = useState<ConfigFile[]>([]);
  const [runningOperation, setRunningOperation] = useState<Operation | null>(null);
  const [logs, setLogs] = useState('');
  const [logStream, setLogStream] = useState<EventSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteFilename, setDeleteFilename] = useState('');
  const [deleteOperationId, setDeleteOperationId] = useState<string | null>(null);
  const [mirrorDestinationSubdir, setMirrorDestinationSubdir] = useState('');
  const [showMirrorLocation, setShowMirrorLocation] = useState<Record<string, boolean>>({});

  const operationsRef = useRef<Operation[]>([]);
  const notifiedOperationsRef = useRef(new Set<string>());
  const logStreamOperationIdRef = useRef<string | null>(null);
  const lastRunningOperationIdRef = useRef<string | null>(null);

  const stopLogStream = useCallback(() => {
    if (logStream) {
      logStream.close();
      setLogStream(null);
    }
    logStreamOperationIdRef.current = null;
  }, [logStream]);

  const fetchLogs = useCallback(async (operationId: string) => {
    try {
      const response = await axios.get(`/api/operations/${operationId}/logs`);
      setLogs(response.data.logs || 'No logs available for this operation');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      console.error('Error fetching logs:', error);
      setLogs(`Error loading logs: ${err.response?.data?.message || err.message}`);
    }
  }, []);

  const handleOperationCompleted = useCallback((op: Operation) => {
    if (!op?.id) return;

    setTimeout(() => fetchLogs(op.id), 500);

    const isTerminalStatus = op.status === 'success' || op.status === 'failed' || op.status === 'stopped';
    if (!isTerminalStatus) return;

    if (!notifiedOperationsRef.current.has(op.id)) {
      notifiedOperationsRef.current.add(op.id);

      if (op.status === 'success') {
        addSuccessAlert('Mirror Operation Completed!');
      } else if (op.status === 'failed') {
        addDangerAlert('Mirror Operation Failed');
      } else if (op.status === 'stopped') {
        addInfoAlert('Mirror Operation Stopped');
      }
    }
  }, [addSuccessAlert, addDangerAlert, addInfoAlert, fetchLogs]);

  const startLogStream = useCallback((operationId: string) => {
    if (logStream) {
      logStream.close();
    }

    const eventSource = new EventSource(`/api/operations/${operationId}/logstream`);
    setLogStream(eventSource);
    logStreamOperationIdRef.current = operationId;

    eventSource.onmessage = (event) => {
      setLogs(prevLogs => prevLogs + event.data);
    };

    eventSource.addEventListener('done', (event) => {
      let payload: { status?: string } | null = null;
      try {
        payload = JSON.parse((event as MessageEvent).data);
      } catch { /* ignore parse errors */ }

      const status = payload?.status || 'unknown';
      const completedOp = operationsRef.current.find(op => op.id === operationId) || {
        id: operationId,
        status: status as Operation['status'],
        name: '',
        configFile: '',
        startedAt: '',
      };
      handleOperationCompleted(completedOp);
      lastRunningOperationIdRef.current = null;
      stopLogStream();
    });

    eventSource.onerror = () => {
      eventSource.close();
      setLogStream(null);
      logStreamOperationIdRef.current = null;
    };

    return eventSource;
  }, [logStream, handleOperationCompleted, stopLogStream]);

  const fetchConfigurations = useCallback(async () => {
    try {
      const response = await axios.get('/api/config/list');
      setAvailableConfigs(response.data);
    } catch (error) {
      console.error('Error fetching configurations:', error);
    }
  }, []);

  const fetchOperations = useCallback(async () => {
    try {
      const response = await axios.get('/api/operations');
      const previousOps = operationsRef.current;
      setOperations(response.data);

      response.data.forEach((op: Operation) => {
        const prevOp = previousOps.find(p => p.id === op.id);
        const justCompleted = prevOp && prevOp.status === 'running' &&
          (op.status === 'success' || op.status === 'failed' || op.status === 'stopped');

        if (justCompleted) {
          handleOperationCompleted(op);
        }
      });

      const running = response.data.find((op: Operation) => op.status === 'running');
      if (running) {
        lastRunningOperationIdRef.current = running.id;
      }

      if (!running && lastRunningOperationIdRef.current) {
        const lastOpId = lastRunningOperationIdRef.current;
        const completedOp = response.data.find((op: Operation) => op.id === lastOpId);
        if (completedOp && (completedOp.status === 'success' || completedOp.status === 'failed' || completedOp.status === 'stopped')) {
          handleOperationCompleted(completedOp);
          if (logStreamOperationIdRef.current === completedOp.id) {
            stopLogStream();
          }
          lastRunningOperationIdRef.current = null;
        }
      }
      setRunningOperation(running || null);

      if (running) {
        fetchLogs(running.id);
      }
    } catch (error) {
      console.error('Error fetching operations:', error);
    }
  }, [handleOperationCompleted, stopLogStream, fetchLogs]);

  useEffect(() => {
    fetchOperations();
    fetchConfigurations();
    const interval = setInterval(fetchOperations, 5000);
    return () => clearInterval(interval);
  }, [fetchOperations, fetchConfigurations]);

  useEffect(() => {
    operationsRef.current = operations;
  }, [operations]);

  useEffect(() => {
    if (runningOperation) {
      lastRunningOperationIdRef.current = runningOperation.id;
      if (logStreamOperationIdRef.current !== runningOperation.id) {
        startLogStream(runningOperation.id);
      }
    }
  }, [runningOperation, startLogStream]);

  useEffect(() => () => {
    if (logStream) {
      logStream.close();
    }
  }, [logStream]);

  useEffect(() => {
    if (showLogs && logs) {
      const logContainer = document.getElementById('log-container');
      if (logContainer) {
        logContainer.scrollTop = logContainer.scrollHeight;
      }
    }
  }, [logs, showLogs]);

  const startOperation = async () => {
    if (!selectedConfig) {
      addDangerAlert('Please select a configuration file');
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post('/api/operations/start', {
        configFile: selectedConfig,
        mirrorDestinationSubdir: mirrorDestinationSubdir.trim() || undefined,
      });

      addSuccessAlert('Operation started successfully!');
      setShowLogs(true);
      fetchOperations();
      setMirrorDestinationSubdir('');

      if (response.data.status === 'running') {
        const logInterval = setInterval(async () => {
          try {
            const logResponse = await axios.get(`/api/operations/${response.data.id}/logs`);
            setLogs(logResponse.data.logs || '');
          } catch (error) {
            console.error('Error polling logs:', error);
          }
        }, 2000);

        setTimeout(() => clearInterval(logInterval), 300000);
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      console.error('Error starting operation:', error);
      addDangerAlert(`Failed to start operation: ${err.response?.data?.message || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteConfiguration = (configName: string) => {
    setDeleteFilename(configName);
    setDeleteOperationId(null);
    setShowDeleteModal(true);
  };

  const confirmDeleteConfig = async () => {
    try {
      await axios.delete(`/api/config/delete/${encodeURIComponent(deleteFilename)}`);
      addSuccessAlert(`Configuration "${deleteFilename}" deleted successfully!`);
      fetchConfigurations();

      if (selectedConfig === deleteFilename) {
        setSelectedConfig('');
      }

      setShowDeleteModal(false);
      setDeleteFilename('');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      console.error('Error deleting configuration:', error);
      addDangerAlert(`Failed to delete configuration: ${err.response?.data?.message || err.message}`);
    }
  };

  const stopOperation = async (operationId: string) => {
    try {
      await axios.post(`/api/operations/${operationId}/stop`);
      addSuccessAlert('Operation stopped successfully!');
      fetchOperations();
    } catch (error) {
      console.error('Error stopping operation:', error);
      addDangerAlert('Failed to stop operation');
    }
  };

  const promptDeleteOperation = (operationId: string) => {
    setDeleteOperationId(operationId);
    setDeleteFilename('');
    setShowDeleteModal(true);
  };

  const confirmDeleteOperation = async () => {
    if (!deleteOperationId) return;
    try {
      await axios.delete(`/api/operations/${deleteOperationId}`);
      addSuccessAlert('Operation deleted successfully!');
      fetchOperations();
      setShowDeleteModal(false);
      setDeleteOperationId(null);
    } catch (error) {
      console.error('Error deleting operation:', error);
      addDangerAlert('Failed to delete operation');
    }
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

  const clearLogs = () => {
    setLogs('');
    setShowLogs(false);
  };

  const getMirrorFullPath = (mirrorDestination: string) => {
    if (mirrorDestination.startsWith('/app/data')) {
      const hostPath = mirrorDestination.replace('/app/data', 'data');
      const projectRoot = '/home/ybeder/oc-mirror-web-app';
      return `${projectRoot}/${hostPath}`.replace(/\/\//g, '/');
    }

    return mirrorDestination;
  };

  const copyMirrorPath = async (mirrorDestination: string) => {
    const fullPath = getMirrorFullPath(mirrorDestination);

    try {
      await navigator.clipboard.writeText(fullPath);
      addSuccessAlert('Full path copied to clipboard!');
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = fullPath;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        addSuccessAlert('Full path copied to clipboard!');
      } catch {
        addDangerAlert('Failed to copy path');
      }
      document.body.removeChild(textArea);
    }
  };

  const isDeleteConfig = deleteFilename && !deleteOperationId;

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>
            <Title headingLevel="h2">
              <SyncAltIcon /> Mirror Operations
            </Title>
          </CardTitle>
        </CardHeader>
        <CardBody>
          Execute and monitor oc-mirror v2 operations.
        </CardBody>
      </Card>

      <Card style={{ marginTop: '1rem' }}>
        <CardHeader>
          <CardTitle>
            <Title headingLevel="h3">
              <PlayIcon /> Start New Operation
            </Title>
          </CardTitle>
        </CardHeader>
        <CardBody>
          <FormGroup label="Configuration File" fieldId="config-select">
            <Flex>
              <FlexItem grow={{ default: 'grow' }}>
                <FormSelect
                  id="config-select"
                  value={selectedConfig}
                  onChange={(_event, value) => setSelectedConfig(value)}
                  aria-label="Select configuration file"
                >
                  <FormSelectOption key="" value="" label="Select a configuration file..." isPlaceholder />
                  {availableConfigs.map(config => (
                    <FormSelectOption
                      key={config.name}
                      value={config.name}
                      label={`${config.name} (${config.size})`}
                    />
                  ))}
                </FormSelect>
              </FlexItem>
              {selectedConfig && (
                <FlexItem>
                  <Button
                    variant="danger"
                    icon={<TrashAltIcon />}
                    onClick={() => deleteConfiguration(selectedConfig)}
                  >
                    Delete
                  </Button>
                </FlexItem>
              )}
            </Flex>
          </FormGroup>

          <Flex alignItems={{ default: 'alignItemsFlexEnd' }} style={{ marginTop: '1rem' }}>
            <FlexItem>
              <FormGroup
                label={
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.125rem',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.375rem',
                      }}
                    >
                      <FolderIcon />
                      <span>Mirror Destination Subdirectory</span>
                    </span>
                    <Popover
                      bodyContent="Mirror files are saved to data/mirrors/<subdirectory>. Leave empty for &quot;default&quot;. The subdirectory is created automatically with correct permissions."
                    >
                      <Button
                        variant="plain"
                        aria-label="More info"
                        hasNoPadding
                        type="button"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: 'auto',
                          height: '1.25rem',
                          lineHeight: 1,
                          position: 'relative',
                          top: '1px',
                          color: 'var(--pf-t--global--text--color--regular, #151515)',
                        }}
                      >
                        <InfoCircleIcon style={{ fontSize: '0.875rem' }} />
                      </Button>
                    </Popover>
                  </span>
                }
                fieldId="mirror-subdir"
              >
                <TextInput
                  id="mirror-subdir"
                  value={mirrorDestinationSubdir}
                  onChange={(_event, value) => setMirrorDestinationSubdir(value)}
                  placeholder="default"
                  style={{ width: '250px' }}
                />
              </FormGroup>
            </FlexItem>
            <FlexItem>
              <Button
                variant="primary"
                icon={loading ? <Spinner size="md" /> : <PlayIcon />}
                onClick={startOperation}
                isDisabled={!selectedConfig || loading}
              >
                Start Operation
              </Button>
            </FlexItem>
          </Flex>

          {runningOperation && (
            <Alert
              variant="info"
              isInline
              title={
                <Flex alignItems={{ default: 'alignItemsCenter' }}>
                  <FlexItem>
                    <SyncAltIcon /> Operation in progress: {runningOperation.name}
                  </FlexItem>
                  <FlexItem>
                    <Button
                      variant="danger"
                      icon={<StopIcon />}
                      onClick={() => stopOperation(runningOperation.id)}
                      size="sm"
                    >
                      Stop Operation
                    </Button>
                  </FlexItem>
                </Flex>
              }
              style={{ marginTop: '1rem' }}
            />
          )}
        </CardBody>
      </Card>

      <Card style={{ marginTop: '1rem' }}>
        <CardHeader>
          <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>
              <CardTitle>
                <Title headingLevel="h3">
                  <ListIcon /> Operation History
                </Title>
              </CardTitle>
            </FlexItem>
            <FlexItem>
              <Button
                variant="secondary"
                icon={showLogs ? <EyeSlashIcon /> : <EyeIcon />}
                onClick={() => setShowLogs(!showLogs)}
              >
                {showLogs ? 'Hide Logs' : 'Show Logs'}
              </Button>
            </FlexItem>
          </Flex>
        </CardHeader>
        <CardBody>
          {operations.length === 0 ? (
            <EmptyState>
              <EmptyStateBody>No operations found.</EmptyStateBody>
            </EmptyState>
          ) : (
            <Table aria-label="Operation history" variant="compact">
              <Thead>
                <Tr>
                  <Th>Operation</Th>
                  <Th>Status</Th>
                  <Th>Started</Th>
                  <Th>Duration</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {operations.map((op) => (
                  <Tr key={op.id}>
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
                    <Td dataLabel="Actions">
                      <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                        {op.status === 'running' && (
                          <FlexItem>
                            <Button variant="danger" icon={<StopIcon />} size="sm" onClick={() => stopOperation(op.id)}>
                              Stop
                            </Button>
                          </FlexItem>
                        )}
                        {op.status === 'success' && op.mirrorDestination && (
                          <FlexItem>
                            <Button
                              variant="secondary"
                              icon={<FolderIcon />}
                              size="sm"
                              onClick={() =>
                                setShowMirrorLocation(prev => ({
                                  ...prev,
                                  [op.id]: !prev[op.id],
                                }))
                              }
                            >
                              {showMirrorLocation[op.id] ? 'Hide Location' : 'Location'}
                            </Button>
                          </FlexItem>
                        )}
                        <FlexItem>
                          <Button
                            variant="secondary"
                            icon={<ListIcon />}
                            size="sm"
                            onClick={() => {
                              setSelectedConfig(op.configFile);
                              fetchLogs(op.id);
                              setShowLogs(true);
                            }}
                          >
                            Logs
                          </Button>
                        </FlexItem>
                        <FlexItem>
                          <Button variant="danger" icon={<TrashAltIcon />} size="sm" onClick={() => promptDeleteOperation(op.id)}>
                            Delete
                          </Button>
                        </FlexItem>
                      </Flex>
                      {op.status === 'success' && op.mirrorDestination && showMirrorLocation[op.id] && (
                        <div style={{ marginTop: '0.75rem' }}>
                          <Alert variant="success" isInline isPlain title="Mirror Files Location">
                            <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                              <FlexItem>
                                <code>{getMirrorFullPath(op.mirrorDestination)}</code>
                              </FlexItem>
                              <FlexItem>
                                <Button
                                  variant="plain"
                                  icon={<CopyIcon />}
                                  onClick={() => copyMirrorPath(op.mirrorDestination!)}
                                  aria-label="Copy path"
                                />
                              </FlexItem>
                            </Flex>
                            <span style={{ fontSize: '0.85rem', color: 'var(--pf-v6-global--Color--200)' }}><CheckCircleIcon /> Files persist across container restarts</span>
                          </Alert>
                        </div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {showLogs && (
        <Card style={{ marginTop: '1rem' }}>
          <CardHeader>
            <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
              <FlexItem>
                <CardTitle>
                  <Title headingLevel="h4">
                    <ListIcon /> Operation Logs
                  </Title>
                </CardTitle>
              </FlexItem>
              <FlexItem>
                <Button variant="secondary" icon={<TrashAltIcon />} onClick={clearLogs}>
                  Clear Logs
                </Button>
              </FlexItem>
            </Flex>
          </CardHeader>
          <CardBody>
            <div id="log-container" style={{ maxHeight: '400px', overflow: 'auto' }}>
              <CodeBlock>
                <CodeBlockCode>{logs || 'No logs available'}</CodeBlockCode>
              </CodeBlock>
            </div>
          </CardBody>
        </Card>
      )}

      {runningOperation && (
        <Alert variant="info" isInline title="Operation in progress" style={{ marginTop: '1rem' }}>
          <DescriptionList isHorizontal isCompact>
            <DescriptionListGroup>
              <DescriptionListTerm>Operation</DescriptionListTerm>
              <DescriptionListDescription>{runningOperation.name}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Started</DescriptionListTerm>
              <DescriptionListDescription>{new Date(runningOperation.startedAt).toLocaleString()}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Duration</DescriptionListTerm>
              <DescriptionListDescription>{formatDuration(runningOperation.duration)}</DescriptionListDescription>
            </DescriptionListGroup>
          </DescriptionList>
        </Alert>
      )}

      <Modal
        variant={ModalVariant.small}
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteFilename('');
          setDeleteOperationId(null);
        }}
        aria-label="Delete confirmation"
      >
        <ModalHeader title={isDeleteConfig ? 'Delete Configuration' : 'Delete Operation'} />
        <ModalBody>
          {isDeleteConfig ? (
            <>
              <p>
                Are you sure you want to delete configuration <span style={{ fontWeight: 600 }}>&quot;{deleteFilename}&quot;</span>?
              </p>
              <br />
              <Alert variant="warning" isInline isPlain title="This action cannot be undone." />
            </>
          ) : (
            <>
              <p>Are you sure you want to delete this operation?</p>
              <br />
              <Alert variant="warning" isInline isPlain title="This action cannot be undone." />
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="danger"
            onClick={isDeleteConfig ? confirmDeleteConfig : confirmDeleteOperation}
          >
            Delete
          </Button>
          <Button
            variant="link"
            onClick={() => {
              setShowDeleteModal(false);
              setDeleteFilename('');
              setDeleteOperationId(null);
            }}
          >
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};

export default MirrorOperations;
