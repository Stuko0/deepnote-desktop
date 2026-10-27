import { RepeatIcon } from '@chakra-ui/icons';
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Code,
  HStack,
  IconButton,
  Select,
  Stack,
  Tag,
  Text,
  Tooltip,
  VStack,
} from '@chakra-ui/react';
import { useEffect, useMemo } from 'react';

import { Modal, ModalBody, ModalContent, ModalHeader, ModalOverlay } from '@chakra-ui/react';

import { type BlockHandlers, BlockView } from './components/BlockView';
import { type Command, CommandPalette } from './components/CommandPalette';
import { DagGraph } from './components/DagPanel';
import { FilesPanel, IntegrationsPanel } from './components/SidePanels';
import { TerminalPanel } from './components/TerminalPanel';
import { useAppStore } from './store';
import './monaco';

const KERNEL_LABEL: Record<string, { color: string; text: string }> = {
  stopped: { color: 'gray', text: 'Kernel stopped' },
  starting: { color: 'orange', text: 'Starting kernel' },
  ready: { color: 'green', text: 'Ready' },
  running: { color: 'blue', text: 'Running' },
  error: { color: 'red', text: 'Kernel error' },
};

function sidecarTarget(): { url: string; token: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    url: params.get('sidecar') ?? 'http://127.0.0.1:8791',
    token: params.get('token') ?? '',
  };
}

export function App() {
  const store = useAppStore();
  const {
    connection,
    project,
    selectedNotebookId,
    selectedBlockId,
    kernelState,
    kernelDetail,
    blockState,
    lastSummary,
    error,
    execMode,
    dag,
    fs,
    integrations,
    paletteOpen,
    saveState,
    init,
    openProject,
    runNotebook,
    runBlocks,
    stopRun,
    restartKernel,
    selectNotebook,
    selectBlock,
    setExecMode,
    setPaletteOpen,
    editBlock,
    updateBlockMetadata,
    createBlock,
    deleteBlock,
    moveBlock,
    refreshDag,
    refreshFs,
    refreshIntegrations,
    refreshTerminals,
    setSecret,
    dagOpen,
    terminals,
  } = store;

  useEffect(() => {
    const { url, token } = sidecarTarget();
    init(url, token);
    const params = new URLSearchParams(window.location.search);
    const projectPath = params.get('project');
    if (projectPath) openProject(projectPath);
  }, [init, openProject]);

  // Terminals are owned by the toolkit kernel: refresh the list when it comes up.
  useEffect(() => {
    if (kernelState === 'ready' || kernelState === 'running') refreshTerminals();
  }, [kernelState, refreshTerminals]);

  const notebook =
    project?.notebooks.find((nb) => nb.id === selectedNotebookId) ?? project?.notebooks[0];
  const kernel = KERNEL_LABEL[kernelState] ?? KERNEL_LABEL.stopped;
  const isRunning = kernelState === 'running';

  const handlers: BlockHandlers = useMemo(
    () => ({
      onEdit: editBlock,
      onUpdateMetadata: updateBlockMetadata,
      onRun: (blockId) => runBlocks([blockId]),
      onMove: moveBlock,
      onDelete: deleteBlock,
      onSelect: selectBlock,
      onCreateAfter: createBlock,
    }),
    [editBlock, updateBlockMetadata, runBlocks, moveBlock, deleteBlock, selectBlock, createBlock],
  );

  const commands: Command[] = useMemo(
    () => [
      { id: 'run-notebook', title: 'Run notebook', run: () => runNotebook(notebook?.id) },
      {
        id: 'run-block',
        title: 'Run selected block',
        shortcut: 'ctrl+Enter',
        run: () => selectedBlockId && runBlocks([selectedBlockId]),
      },
      {
        id: 'run-downstream',
        title: 'Run selected block and dependent blocks',
        run: () => selectedBlockId && runBlocks([selectedBlockId]),
      },
      { id: 'new-code', title: 'New code block', run: () => createBlock(selectedBlockId, 'code') },
      { id: 'new-sql', title: 'New SQL block', run: () => createBlock(selectedBlockId, 'sql') },
      {
        id: 'new-text',
        title: 'New text block',
        run: () => createBlock(selectedBlockId, 'markdown'),
      },
      {
        id: 'new-input',
        title: 'New input block (text)',
        run: () => createBlock(selectedBlockId, 'input-text'),
      },
      {
        id: 'delete-block',
        title: 'Delete selected block',
        run: () => selectedBlockId && deleteBlock(selectedBlockId),
      },
      { id: 'restart-kernel', title: 'Restart kernel', run: restartKernel },
      { id: 'stop-run', title: 'Stop run', run: stopRun },
      {
        id: 'refresh-dag',
        title: 'Open dependency graph',
        run: () => {
          refreshDag();
          useAppStore.setState({ dagOpen: true });
        },
      },
      {
        id: 'open-project',
        title: 'Open project...',
        run: () => openProject(window.prompt('Path to .deepnote file:') ?? ''),
      },
    ],
    [
      runNotebook,
      runBlocks,
      createBlock,
      deleteBlock,
      restartKernel,
      stopRun,
      refreshDag,
      openProject,
      notebook,
      selectedBlockId,
    ],
  );

  // Global shortcuts: ctrl+P palette, ctrl+Enter run selected block.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && selectedBlockId) {
        e.preventDefault();
        runBlocks([selectedBlockId]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen, runBlocks, selectedBlockId]);

  const selectedDagInfo =
    dag && selectedBlockId
      ? {
          upstream: dag.upstream[selectedBlockId] ?? [],
          downstream: dag.downstream[selectedBlockId] ?? [],
        }
      : undefined;

  return (
    <Box minH="100vh" bg="gray.50">
      <HStack
        as="header"
        h={12}
        px={4}
        bg="white"
        borderBottomWidth="1px"
        borderBottomColor="gray.200"
        spacing={3}
      >
        <Text fontWeight="bold" color="brand.600">
          deepnote-desktop
        </Text>
        {project ? (
          <>
            <Text color="gray.400">/</Text>
            <Text fontWeight="semibold">{project.name}</Text>
            <Text fontSize="xs" color="gray.400">
              {saveState === 'saving' ? 'saving...' : 'saved'}
            </Text>
          </>
        ) : (
          <Text color="gray.500">No project open</Text>
        )}
        <SpacerFlex />
        <Tooltip label={kernelDetail ?? `Python: ${project?.python.path ?? 'unknown'}`}>
          <Tag colorScheme={kernel.color} size="sm">
            {kernel.text}
          </Tag>
        </Tooltip>
        <Select
          size="sm"
          maxW={230}
          value={execMode}
          onChange={(e) => setExecMode(e.target.value as 'block' | 'downstream')}
          title="Execution mode"
        >
          <option value="block">Block (run selected block)</option>
          <option value="downstream">Block and dependent blocks</option>
        </Select>
        {connection !== 'online' && (
          <Tag colorScheme="red" size="sm">
            {connection}
          </Tag>
        )}
        {isRunning ? (
          <Button size="sm" colorScheme="red" onClick={stopRun}>
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            colorScheme="accent"
            onClick={() => runNotebook(notebook?.id)}
            isDisabled={!project}
          >
            Run notebook
          </Button>
        )}
        <IconButton
          aria-label="Restart kernel"
          icon={<RepeatIcon />}
          size="sm"
          variant="ghost"
          onClick={restartKernel}
          isDisabled={!project}
        />
      </HStack>

      <HStack align="stretch" spacing={0}>
        <Box
          w="260px"
          bg="white"
          borderRightWidth="1px"
          borderRightColor="gray.200"
          minH="calc(100vh - 48px)"
          p={3}
        >
          <Text
            fontSize="xs"
            fontWeight="semibold"
            textTransform="uppercase"
            color="gray.500"
            mb={2}
          >
            Notebooks
          </Text>
          <VStack align="stretch" spacing={1}>
            {project?.notebooks.map((nb) => (
              <Button
                key={nb.id}
                justifyContent="flex-start"
                size="sm"
                variant={nb.id === notebook?.id ? 'solid' : 'ghost'}
                colorScheme={nb.id === notebook?.id ? 'accent' : 'gray'}
                onClick={() => selectNotebook(nb.id)}
              >
                {nb.name}
              </Button>
            ))}
          </VStack>

          <Button
            mt={4}
            size="sm"
            width="100%"
            onClick={() => openProject(window.prompt('Path to .deepnote file:') ?? '')}
          >
            Open project...
          </Button>

          {project && (
            <Box mt={4} fontSize="xs" color="gray.500">
              <Text fontWeight="semibold" mb={1}>
                Runtime
              </Text>
              <Text noOfLines={1}>{project.python.path}</Text>
              <HStack mt={1}>
                <Badge colorScheme={project.python.toolkitInstalled ? 'green' : 'red'} size="sm">
                  toolkit {project.python.toolkitInstalled ? 'installed' : 'missing'}
                </Badge>
              </HStack>
              {!project.python.toolkitInstalled && (
                <Code fontSize="2xs" display="block" mt={2} p={2} borderRadius="md" bg="gray.50">
                  pip install &quot;deepnote-toolkit[server]&quot;
                </Code>
              )}
              {project.snapshotPath && (
                <Text mt={2} noOfLines={1}>
                  snapshot: {project.snapshotPath.split('/').pop()}
                </Text>
              )}
            </Box>
          )}

          <TerminalPanel />

          <Box mt={4}>
            <FilesPanel fs={fs} onNavigate={refreshFs} />
          </Box>
          <IntegrationsPanel
            integrations={integrations}
            onRefresh={refreshIntegrations}
            onSetSecret={setSecret}
          />
        </Box>

        <Box flex={1} p={6} maxW="980px" mx="auto" w="100%">
          {error && (
            <Alert status="error" mb={4} borderRadius="md">
              <AlertIcon />
              {error}
            </Alert>
          )}
          {lastSummary && !isRunning && (
            <Text mb={4} fontSize="sm" color="gray.500">
              Last run: {lastSummary}
            </Text>
          )}

          {!project && (
            <VStack spacing={4} mt={20}>
              <Text color="gray.500">Open a .deepnote project to get started.</Text>
              <Button
                colorScheme="accent"
                onClick={() => openProject(window.prompt('Path to .deepnote file:') ?? '')}
              >
                Open project
              </Button>
            </VStack>
          )}

          {selectedDagInfo &&
            (selectedDagInfo.upstream.length > 0 || selectedDagInfo.downstream.length > 0) && (
              <HStack mb={3} fontSize="xs" color="gray.500" spacing={3}>
                <Text>
                  Selected block depends on {selectedDagInfo.upstream.length} and feeds{' '}
                  {selectedDagInfo.downstream.length}
                </Text>
                {selectedDagInfo.downstream.length > 0 && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => selectedBlockId && runBlocks([selectedBlockId])}
                  >
                    Run block and dependents
                  </Button>
                )}
              </HStack>
            )}

          <Stack spacing={3}>
            {notebook?.blocks.map((block) => (
              <BlockView
                key={block.id}
                block={block}
                state={blockState[block.id]}
                handlers={handlers}
                dagInfo={
                  dag
                    ? {
                        upstream: dag.upstream[block.id] ?? [],
                        downstream: dag.downstream[block.id] ?? [],
                      }
                    : undefined
                }
              />
            ))}
          </Stack>

          {notebook && (
            <Button mt={4} size="sm" variant="outline" onClick={() => createBlock(null, 'code')}>
              Add block at the end
            </Button>
          )}
        </Box>
      </HStack>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />

      <Modal isOpen={dagOpen} onClose={() => useAppStore.setState({ dagOpen: false })} size="4xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader fontSize="md">Dependency graph</ModalHeader>
          <ModalBody pb={4}>
            {dag && notebook ? (
              <DagGraph
                notebook={notebook}
                dag={dag}
                selectedBlockId={selectedBlockId}
                onSelect={(blockId) => {
                  selectBlock(blockId);
                  useAppStore.setState({ dagOpen: false });
                }}
              />
            ) : (
              <Text color="gray.500" fontSize="sm">
                Loading dependencies (this analyzes the Python AST of every block)...
              </Text>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Panels load their data when a project is open */}
      <PanelLoader
        projectPath={project?.path ?? null}
        refreshFs={refreshFs}
        refreshIntegrations={refreshIntegrations}
      />
    </Box>
  );
}

function SpacerFlex() {
  return <Box flex={1} />;
}

function PanelLoader({
  projectPath,
  refreshFs,
  refreshIntegrations,
}: {
  projectPath: string | null;
  refreshFs: (subpath?: string) => void;
  refreshIntegrations: () => void;
}) {
  useEffect(() => {
    if (projectPath) {
      refreshFs();
      refreshIntegrations();
    }
  }, [projectPath, refreshFs, refreshIntegrations]);
  return null;
}
