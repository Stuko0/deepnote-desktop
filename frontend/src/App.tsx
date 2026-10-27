import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Code,
  HStack,
  IconButton,
  Spacer,
  Stack,
  Tag,
  Text,
  Tooltip,
  VStack,
} from '@chakra-ui/react';
import { useEffect } from 'react';

import { BlockView } from './components/BlockView';
import { useAppStore } from './store';

const KERNEL_LABEL: Record<string, { color: string; text: string }> = {
  stopped: { color: 'gray', text: 'Kernel stopped' },
  starting: { color: 'orange', text: 'Starting kernel' },
  ready: { color: 'green', text: 'Ready' },
  running: { color: 'blue', text: 'Running' },
  error: { color: 'red', text: 'Kernel error' },
};

function sidecarTarget(): { url: string; token: string } {
  const params = new URLSearchParams(window.location.search);
  const url = params.get('sidecar') ?? 'http://127.0.0.1:8791';
  const token = params.get('token') ?? '';
  return { url, token };
}

export function App() {
  const {
    connection,
    project,
    selectedNotebookId,
    kernelState,
    kernelDetail,
    blockState,
    lastSummary,
    error,
    init,
    openProject,
    runNotebook,
    stopRun,
    restartKernel,
    selectNotebook,
  } = useAppStore();

  useEffect(() => {
    const { url, token } = sidecarTarget();
    init(url, token);
    const params = new URLSearchParams(window.location.search);
    const projectPath = params.get('project');
    if (projectPath) openProject(projectPath);
  }, [init, openProject]);

  const notebook =
    project?.notebooks.find((nb) => nb.id === selectedNotebookId) ?? project?.notebooks[0];
  const kernel = KERNEL_LABEL[kernelState] ?? KERNEL_LABEL.stopped;
  const isRunning = kernelState === 'running';

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
            <Code fontSize="xs" px={2} bg="gray.100">
              {project.path}
            </Code>
          </>
        ) : (
          <Text color="gray.500">No project open</Text>
        )}
        <Spacer />
        <Tooltip label={kernelDetail ?? `Python: ${project?.python.path ?? 'unknown'}`}>
          <Tag colorScheme={kernel.color} size="sm">
            {kernel.text}
          </Tag>
        </Tooltip>
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
          icon={<Text fontSize="lg">{'\u21BB'}</Text>}
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
              {project.snapshotPath && (
                <Text mt={2} noOfLines={1}>
                  snapshot: {project.snapshotPath.split('/').pop()}
                </Text>
              )}
            </Box>
          )}
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

          <Stack spacing={3}>
            {notebook?.blocks.map((block) => (
              <BlockView key={block.id} block={block} state={blockState[block.id]} />
            ))}
          </Stack>
        </Box>
      </HStack>
    </Box>
  );
}
