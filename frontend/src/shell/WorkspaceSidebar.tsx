/**
 * Workspace navigation: the sidebar shared by every non-editor view,
 * replicating the SaaS workspace chrome (spec section: sidebar nav, tabs and
 * the creation menu). Sections render only data the desktop app can serve:
 * local recents, project-local integrations, and cloud lists when a token is
 * configured - nothing is hardcoded.
 */

import {
  Box,
  Button,
  Divider,
  HStack,
  IconButton,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useEffect, useState } from 'react';

import { useAppStore } from '../store';
import { keyringGet } from '../wailsSecrets';

function NavItem({
  label,
  active,
  onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Box
      as="button"
      onClick={onClick}
      w="100%"
      textAlign="left"
      px={2}
      py={1}
      borderRadius="md"
      bg={active ? 'brand.50' : 'transparent'}
      color={active ? 'brand.700' : 'gray.600'}
      fontWeight={active ? 'semibold' : 'normal'}
      fontSize="sm"
      _hover={{ bg: active ? 'brand.50' : 'gray.100' }}
    >
      {label}
    </Box>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      fontSize="2xs"
      fontWeight="semibold"
      textTransform="uppercase"
      color="gray.400"
      px={2}
      mt={3}
      mb={1}
    >
      {children}
    </Text>
  );
}

export function WorkspaceSidebar({ onOpenProject }: { onOpenProject: () => void }) {
  const { view, navigate, recentProjects, project, createProject, cloud, cloudStatus } =
    useAppStore();
  const [cloudProjects, setCloudProjects] = useState<Array<{ name: string }>>([]);

  // Cloud project lists are endpoint-driven: only fetched when a token exists.
  useEffect(() => {
    if (!cloud.configured || cloud.error) return;
    let cancelled = false;
    void (async () => {
      try {
        const { listAllProjects } = await import('@deepnote/cloud');
        const token = await keyringGet('DEEPNOTE_TOKEN');
        if (!token || cancelled) return;
        const baseUrl = cloud.baseUrl || 'https://deepnote.com';
        const projects = await listAllProjects(baseUrl, token);
        if (!cancelled)
          setCloudProjects(
            projects.map((p: { name?: string }) => ({ name: p.name ?? '(untitled)' })),
          );
      } catch {
        if (!cancelled) setCloudProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cloud.configured, cloud.error, cloud.baseUrl]);

  useEffect(() => {
    if (cloud.configured === undefined) cloudStatus();
  }, [cloud.configured, cloudStatus]);

  const isProjectsTab = view.kind === 'projects';
  const tab = view.kind === 'projects' ? view.tab : null;

  return (
    <Box
      w="240px"
      flexShrink={0}
      borderRightWidth="1px"
      borderColor="gray.200"
      bg="gray.50"
      display="flex"
      flexDirection="column"
      overflowY="auto"
      p={2}
    >
      {/* Workspace switcher */}
      <HStack spacing={2} px={1} py={1} borderRadius="md" mb={1}>
        <Box
          w={6}
          h={6}
          borderRadius="sm"
          bg="brand.500"
          color="white"
          fontSize="xs"
          fontWeight="bold"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          L
        </Box>
        <Box flex="1">
          <Text fontSize="sm" fontWeight="semibold" lineHeight="1.1">
            Local workspace
          </Text>
          <Text fontSize="2xs" color="gray.500">
            deepnote-desktop
          </Text>
        </Box>
      </HStack>

      <NavItem
        label="Home"
        active={view.kind === 'home'}
        onClick={() => navigate({ kind: 'home' })}
      />
      <NavItem
        label="Integrations"
        active={view.kind === 'integrations'}
        onClick={() => navigate({ kind: 'integrations' })}
      />
      <NavItem
        label="Settings & members"
        active={view.kind === 'settings'}
        onClick={() => navigate({ kind: 'settings', tab: 'members' })}
      />

      <Divider my={2} />

      <SectionLabel>Recent projects</SectionLabel>
      {recentProjects.length === 0 ? (
        <Text fontSize="xs" color="gray.400" px={2}>
          No recent projects
        </Text>
      ) : (
        recentProjects
          .slice(0, 8)
          .map((path) => (
            <NavItem
              key={path}
              label={path.split('/').pop() ?? path}
              active={view.kind === 'project' && project?.path === path}
              onClick={() => useAppStore.getState().openProject(path)}
            />
          ))
      )}

      <SectionLabel>Private projects</SectionLabel>
      {project ? (
        <NavItem
          label={project.name}
          active={false}
          onClick={() => navigate({ kind: 'project' })}
        />
      ) : (
        <Text fontSize="xs" color="gray.400" px={2}>
          Open a project to see it here
        </Text>
      )}
      {cloudProjects.length > 0 && (
        <>
          <SectionLabel>Cloud projects</SectionLabel>
          {cloudProjects.slice(0, 6).map((p) => (
            <Text key={p.name} fontSize="xs" color="gray.600" px={2} noOfLines={1}>
              {p.name}
            </Text>
          ))}
        </>
      )}

      <HStack spacing={1} mt={2} px={1}>
        <Menu>
          <MenuButton
            as={IconButton}
            aria-label="Create new"
            size="sm"
            variant="outline"
            title="Create new"
            icon={<Text>+</Text>}
          />
          <MenuList fontSize="sm">
            <MenuItem
              onClick={() => {
                const target = window.prompt('Path for the new .deepnote project:');
                if (target) createProject(target);
              }}
            >
              New project
            </MenuItem>
            <MenuItem onClick={onOpenProject}>Open project...</MenuItem>
            <MenuItem isDisabled={!project} onClick={() => navigate({ kind: 'project' })}>
              Open editor
            </MenuItem>
          </MenuList>
        </Menu>
        <Button size="sm" variant="ghost" fontSize="xs" onClick={onOpenProject}>
          Open project...
        </Button>
      </HStack>

      <SectionLabel>Projects</SectionLabel>
      <NavItem
        label="Recent"
        active={tab === 'recent'}
        onClick={() => navigate({ kind: 'projects', tab: 'recent' })}
      />
      <NavItem
        label="Private"
        active={tab === 'private'}
        onClick={() => navigate({ kind: 'projects', tab: 'private' })}
      />
      <NavItem
        label="Shared with me"
        active={tab === 'shared'}
        onClick={() => navigate({ kind: 'projects', tab: 'shared' })}
      />
      <NavItem
        label="All projects"
        active={tab === 'all'}
        onClick={() => navigate({ kind: 'projects', tab: 'all' })}
      />

      <SectionLabel>Workspace</SectionLabel>
      <NavItem
        label="Trash"
        active={view.kind === 'trash'}
        onClick={() => navigate({ kind: 'trash' })}
      />
    </Box>
  );
}
