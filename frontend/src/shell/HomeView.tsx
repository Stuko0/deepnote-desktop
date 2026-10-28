/** Home dashboard: greeting, recently visited, runs state, getting-started checklist. */

import {
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  Grid,
  HStack,
  Link,
  Spinner,
  Stack,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useEffect, useState } from 'react';

import { useAppStore } from '../store';
import { hasKeyring, keyringGet } from '../wailsSecrets';

function ChecklistItem({
  done,
  label,
  action,
}: { done: boolean; label: string; action?: { label: string; run: () => void } }) {
  return (
    <HStack
      justify="space-between"
      px={3}
      py={2}
      bg={done ? 'green.50' : 'white'}
      borderRadius="md"
      borderWidth="1px"
      borderColor={done ? 'green.100' : 'gray.200'}
    >
      <HStack spacing={2}>
        <Text
          fontSize="sm"
          color={done ? 'green.700' : 'gray.600'}
          textDecoration={done ? 'line-through' : 'none'}
        >
          {done ? '✓' : '○'} {label}
        </Text>
      </HStack>
      {action && !done ? (
        <Button size="xs" variant="ghost" colorScheme="brand" onClick={action.run}>
          {action.label}
        </Button>
      ) : null}
    </HStack>
  );
}

export function HomeView() {
  const { recentProjects, openProject, createProject, lastSummary, cloud, cloudStatus, navigate } =
    useAppStore();
  const [hasAiKey, setHasKey] = useState<boolean | null>(null);
  const firstName = cloud.workspace?.name?.split(' ')[0] || null;

  useEffect(() => {
    if (cloud.configured === undefined) cloudStatus();
    if (!hasKeyring()) {
      setHasKey(false);
      return;
    }
    void (async () => {
      const openai = await keyringGet('OPENAI_API_KEY');
      const anthropic = await keyringGet('ANTHROPIC_API_KEY');
      setHasKey(Boolean(openai || anthropic));
    })();
  }, [cloud.configured, cloudStatus]);

  const completed = [
    recentProjects.length > 0,
    Boolean(lastSummary),
    hasAiKey === true,
    cloud.configured === true,
    Boolean(lastSummary && cloud.run?.success),
  ].filter(Boolean).length;

  return (
    <Stack spacing={6} maxW="960px">
      <Box>
        <Text fontSize="2xl" fontWeight="bold" color="gray.800">
          Hey{firstName ? `, ${firstName}` : ' there'}.
        </Text>
        <Text fontSize="lg" color="gray.500">
          What should we build next?
        </Text>
      </Box>

      <Box>
        <HStack justify="space-between" mb={2}>
          <Text fontSize="sm" fontWeight="semibold" color="gray.700">
            Recently visited
          </Text>
          {recentProjects.length > 0 && (
            <Button
              size="xs"
              variant="link"
              colorScheme="brand"
              onClick={() => navigate({ kind: 'projects', tab: 'recent' })}
            >
              See more…
            </Button>
          )}
        </HStack>
        {recentProjects.length === 0 ? (
          <Card variant="outline">
            <CardBody>
              <Text fontSize="sm" color="gray.500">
                No recent projects yet. Open a .deepnote file or create a new project to get
                started.
              </Text>
              <HStack mt={3}>
                <Button
                  size="sm"
                  colorScheme="brand"
                  onClick={() => {
                    const target = window.prompt('Path for the new .deepnote project:');
                    if (target) createProject(target);
                  }}
                >
                  New project
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openProject(window.prompt('Path to .deepnote file:') ?? '')}
                >
                  Open project…
                </Button>
              </HStack>
            </CardBody>
          </Card>
        ) : (
          <Grid templateColumns={{ base: '1fr', md: 'repeat(3, 1fr)' }} gap={3}>
            {recentProjects.slice(0, 6).map((path) => (
              <Card
                key={path}
                variant="outline"
                cursor="pointer"
                _hover={{ borderColor: 'brand.300' }}
                onClick={() => openProject(path)}
              >
                <CardBody py={3}>
                  <Text fontSize="sm" fontWeight="medium" noOfLines={1}>
                    {path.split('/').pop()}
                  </Text>
                  <Text fontSize="2xs" color="gray.400" noOfLines={1}>
                    {path}
                  </Text>
                </CardBody>
              </Card>
            ))}
          </Grid>
        )}
      </Box>

      <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={4}>
        <Box borderWidth="1px" borderRadius="lg" p={4} bg="gray.50">
          <HStack justify="space-between" mb={2}>
            <Text fontSize="sm" fontWeight="semibold" color="gray.700">
              Runs
            </Text>
            <Text fontSize="xs" color="gray.400">
              last 30 days
            </Text>
          </HStack>
          <Text fontSize="sm" color="gray.500">
            {lastSummary ? `Last run: ${lastSummary}` : 'No runs in the last 30 days.'}
          </Text>
          <Text fontSize="2xs" color="gray.400" mt={2}>
            Run history is per session in the desktop app; snapshots of each run are saved next to
            your project.
          </Text>
        </Box>

        <Box borderWidth="1px" borderRadius="lg" p={4} bg="gray.50">
          <HStack mb={2}>
            <Text fontSize="sm" fontWeight="semibold" color="gray.700">
              Getting started
            </Text>
            <Badge colorScheme="brand" fontSize="0.65rem">
              {completed} / 5 completed
            </Badge>
          </HStack>
          <VStack align="stretch" spacing={1}>
            <ChecklistItem done={recentProjects.length > 0} label="Open your first project" />
            <ChecklistItem done={Boolean(lastSummary)} label="Run a notebook" />
            <ChecklistItem
              done={hasAiKey === true}
              label="Configure an AI provider key"
              action={{ label: 'Set up', run: () => navigate({ kind: 'integrations' }) }}
            />
            <ChecklistItem
              done={cloud.configured === true}
              label="Connect Deepnote Cloud"
              action={{ label: 'Connect', run: () => navigate({ kind: 'integrations' }) }}
            />
            <ChecklistItem
              done={Boolean(lastSummary && cloud.run?.success)}
              label="Run a notebook in the cloud"
            />
          </VStack>
        </Box>
      </Grid>

      <Box>
        <Text fontSize="sm" fontWeight="semibold" color="gray.700" mb={2}>
          Other resources
        </Text>
        <HStack spacing={4} fontSize="sm">
          <Link
            href="https://github.com/Stuko0/deepnote-desktop#readme"
            isExternal
            color="brand.600"
          >
            Documentation
          </Link>
          <Link
            href="https://github.com/Stuko0/deepnote-desktop/issues"
            isExternal
            color="brand.600"
          >
            Contact support
          </Link>
          <HStack spacing={1}>
            <Text fontSize="sm" color="gray.600">
              Shortcuts:
            </Text>
            <Text fontSize="sm" color="gray.800" fontFamily="mono">
              ctrl + P
            </Text>
            <Text fontSize="xs" color="gray.400">
              opens the command palette
            </Text>
          </HStack>
          {hasAiKey === null && <Spinner size="xs" />}
        </HStack>
      </Box>
    </Stack>
  );
}
