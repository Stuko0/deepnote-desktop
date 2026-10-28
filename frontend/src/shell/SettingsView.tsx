/** Workspace settings & members with the SaaS tab set. */

import {
  Badge,
  Box,
  Button,
  Divider,
  HStack,
  Input,
  Select,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useEffect, useState } from 'react';

import { type WorkspaceView, useAppStore } from '../store';
import { hasKeyring, keyringGet } from '../wailsSecrets';

const ROLE_HELP: Array<[string, string]> = [
  ['Restricted user', 'Can only see projects they are explicitly invited to.'],
  ['Viewer', 'View all projects, members, and run apps.'],
  ['Editor', "Create and edit projects in a workspace. Can't add or edit integrations."],
  ['Admin', 'All previous rights and ability to manage workspace integrations and members.'],
  ['Owner', 'Full control of the workspace, billing, and member management.'],
];

const TAB_IDS = [
  'members',
  'groups',
  'workspace',
  'security',
  'ai',
  'project-settings',
  'billing',
] as const;
const TAB_LABELS: Record<(typeof TAB_IDS)[number], string> = {
  members: 'Members',
  groups: 'Groups',
  workspace: 'Workspace',
  security: 'Security',
  ai: 'AI',
  'project-settings': 'Project settings',
  billing: 'Billing & usage',
};

function CloudOnly({ what }: { what: string }) {
  const { cloud, cloudStatus } = useAppStore();
  useEffect(() => {
    if (cloud.configured === undefined) cloudStatus();
  }, [cloud.configured, cloudStatus]);
  if (cloud.configured === true && !cloud.error) {
    return (
      <Text fontSize="sm" color="gray.500">
        {what} is managed in your Deepnote Cloud workspace.
      </Text>
    );
  }
  return (
    <Box borderWidth="1px" borderRadius="md" p={4} bg="gray.50">
      <Text fontSize="sm" color="gray.600">
        {what} is a Deepnote Cloud setting. Connect a token in Integrations to manage it here.
      </Text>
    </Box>
  );
}

export function SettingsView({
  tab,
}: { tab: Extract<WorkspaceView, { kind: 'settings' }>['tab'] }) {
  const { navigate, project, cloud, cloudStatus } = useAppStore();
  const [me, setMe] = useState<string | null>(null);

  const tabIndex = Math.max(0, TAB_IDS.indexOf(tab));

  useEffect(() => {
    if (cloud.configured === undefined) cloudStatus();
    void (async () => {
      // The signed-in account name comes from the cloud API when connected.
      if (cloud.configured !== true) return;
      try {
        const { getWorkspace } = await import('@deepnote/cloud');
        const token = await keyringGet('DEEPNOTE_TOKEN');
        if (!token) return;
        const workspace = await getWorkspace(cloud.baseUrl || 'https://deepnote.com', token);
        setMe(workspace?.name ?? null);
      } catch {
        setMe(null);
      }
    })();
  }, [cloud.configured, cloud.baseUrl, cloudStatus]);

  return (
    <Stack spacing={4} maxW="960px">
      <HStack justify="space-between">
        <Text fontSize="lg" fontWeight="semibold" color="gray.800">
          Settings
        </Text>
        <Button
          size="xs"
          variant="link"
          colorScheme="brand"
          onClick={() => navigate({ kind: 'home' })}
        >
          ← Home
        </Button>
      </HStack>

      <Tabs
        index={tabIndex}
        onChange={(index) => navigate({ kind: 'settings', tab: TAB_IDS[index] })}
      >
        <TabList overflowX="auto">
          {TAB_IDS.map((id) => (
            <Tab key={id} whiteSpace="nowrap">
              {TAB_LABELS[id]}
            </Tab>
          ))}
        </TabList>
        <TabPanels>
          <TabPanel>
            {/* Members */}
            <VStack align="stretch" spacing={4}>
              <Box>
                <Text fontSize="sm" fontWeight="semibold" color="gray.700" mb={1}>
                  Invite members
                </Text>
                <HStack>
                  <Input
                    size="sm"
                    placeholder="Enter email addresses to invite members."
                    isDisabled={!hasKeyring()}
                  />
                  <Select size="sm" maxW="140px" defaultValue="Viewer" aria-label="Workspace role">
                    <option value="Viewer">Viewer</option>
                    <option value="Editor">Editor</option>
                    <option value="Admin">Admin</option>
                  </Select>
                  <Button size="sm" colorScheme="brand" isDisabled>
                    Add
                  </Button>
                </HStack>
                <Text fontSize="2xs" color="gray.400" mt={1}>
                  Invitations are sent by Deepnote Cloud; connect a token to enable them.
                </Text>
              </Box>

              <Box>
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  color="gray.500"
                  textTransform="uppercase"
                  mb={1}
                >
                  Members
                </Text>
                <HStack justify="space-between" borderWidth="1px" borderRadius="md" px={3} py={2}>
                  <HStack>
                    <Text fontSize="sm" fontWeight="medium">
                      {me ?? 'You'}
                    </Text>
                    <Text fontSize="xs" color="gray.400">
                      {cloud.configured === true && !cloud.error
                        ? 'connected workspace'
                        : 'this machine'}
                    </Text>
                  </HStack>
                  <Badge colorScheme="brand">Owner</Badge>
                </HStack>
              </Box>

              <Box>
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  color="gray.500"
                  textTransform="uppercase"
                  mb={1}
                >
                  Workspace roles
                </Text>
                <VStack align="stretch" spacing={1}>
                  {ROLE_HELP.map(([role, help]) => (
                    <HStack key={role} align="start" fontSize="xs">
                      <Badge w="120px" colorScheme="gray" justifyContent="center">
                        {role}
                      </Badge>
                      <Text color="gray.600">{help}</Text>
                    </HStack>
                  ))}
                </VStack>
              </Box>
            </VStack>
          </TabPanel>

          <TabPanel>
            <CloudOnly what="Groups" />
          </TabPanel>

          <TabPanel>
            <VStack align="stretch" spacing={3}>
              <Box borderWidth="1px" borderRadius="md" p={4}>
                <Text fontSize="sm" fontWeight="semibold" color="gray.700" mb={2}>
                  Workspace
                </Text>
                <VStack align="stretch" spacing={1} fontSize="sm">
                  <HStack justify="space-between">
                    <Text color="gray.500">Name</Text>
                    <Text>Local workspace</Text>
                  </HStack>
                  <HStack justify="space-between">
                    <Text color="gray.500">Type</Text>
                    <Text>Desktop (local-first)</Text>
                  </HStack>
                  <HStack justify="space-between">
                    <Text color="gray.500">Open project</Text>
                    <Text noOfLines={1} maxW="60%">
                      {project?.path ?? 'none'}
                    </Text>
                  </HStack>
                </VStack>
              </Box>
            </VStack>
          </TabPanel>

          <TabPanel>
            <CloudOnly what="Security policies" />
          </TabPanel>

          <TabPanel>
            <Box borderWidth="1px" borderRadius="md" p={4}>
              <Text fontSize="sm" fontWeight="semibold" color="gray.700" mb={2}>
                AI
              </Text>
              <Text fontSize="sm" color="gray.600" mb={2}>
                Agent blocks run locally with your own provider keys (OpenAI or Anthropic), held in
                the OS keychain.
              </Text>
              <HStack>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate({ kind: 'integrations' })}
                >
                  Configure provider keys
                </Button>
              </HStack>
            </Box>
          </TabPanel>

          <TabPanel>
            <Box borderWidth="1px" borderRadius="md" p={4}>
              <Text fontSize="sm" fontWeight="semibold" color="gray.700" mb={2}>
                Project settings
              </Text>
              {project ? (
                <VStack align="stretch" spacing={1} fontSize="sm">
                  <HStack justify="space-between">
                    <Text color="gray.500">Project</Text>
                    <Text>{project.name}</Text>
                  </HStack>
                  <HStack justify="space-between">
                    <Text color="gray.500">Path</Text>
                    <Text noOfLines={1} maxW="65%">
                      {project.path}
                    </Text>
                  </HStack>
                  <HStack justify="space-between">
                    <Text color="gray.500">Notebooks</Text>
                    <Text>{project.notebooks.length}</Text>
                  </HStack>
                </VStack>
              ) : (
                <Text fontSize="sm" color="gray.500">
                  Open a project to see its settings.
                </Text>
              )}
            </Box>
          </TabPanel>

          <TabPanel>
            <CloudOnly what="Billing & usage" />
          </TabPanel>
        </TabPanels>
      </Tabs>
      <Divider />
    </Stack>
  );
}
