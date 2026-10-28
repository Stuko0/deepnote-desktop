/** Project list views: tabs, sortable table, cloud/local sources. */

import {
  Badge,
  Box,
  Button,
  HStack,
  Select,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from '@chakra-ui/react';
import { useEffect, useMemo, useState } from 'react';

import { useAppStore } from '../store';

type SortKey = 'lastOpened' | 'nameAsc' | 'nameDesc' | 'newest' | 'oldest';

const TAB_TITLES = {
  recent: 'Recent projects',
  private: 'Private projects',
  shared: 'Shared with me',
  all: 'All projects',
} as const;

interface ProjectRow {
  path: string;
  name: string;
  location: 'local' | 'cloud';
  openedAt?: number;
}

export function ProjectsView({ tab }: { tab: 'recent' | 'private' | 'shared' | 'all' }) {
  const { recentProjects, openProject, cloud, cloudStatus, navigate, project } = useAppStore();
  const [sort, setSort] = useState<SortKey>('lastOpened');
  const [cloudRows, setCloudRows] = useState<ProjectRow[]>([]);

  useEffect(() => {
    if (cloud.configured === undefined) cloudStatus();
  }, [cloud.configured, cloudStatus]);

  useEffect(() => {
    if (cloud.configured !== true || cloud.error) return;
    let cancelled = false;
    void (async () => {
      try {
        const { listAllProjects } = await import('@deepnote/cloud');
        const token = await (await import('../wailsSecrets')).keyringGet('DEEPNOTE_TOKEN');
        if (!token || cancelled) return;
        const projects = await listAllProjects(cloud.baseUrl || 'https://deepnote.com', token);
        if (cancelled) return;
        setCloudRows(
          projects.map((p: { id?: string; name?: string }) => ({
            path: String(p.id ?? ''),
            name: p.name ?? '(untitled)',
            location: 'cloud' as const,
          })),
        );
      } catch {
        if (!cancelled) setCloudRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cloud.configured, cloud.error, cloud.baseUrl]);

  const localRows: ProjectRow[] = useMemo(
    () =>
      recentProjects.map((path, index) => ({
        path,
        name: path.split('/').pop() ?? path,
        location: 'local' as const,
        // The recents list is ordered by last open: index doubles as recency.
        openedAt: -index,
      })),
    [recentProjects],
  );

  const rows = useMemo(() => {
    const base =
      tab === 'recent'
        ? localRows
        : tab === 'private'
          ? localRows
          : tab === 'shared'
            ? cloudRows
            : [...localRows, ...cloudRows];
    const sorted = [...base];
    if (sort === 'lastOpened') sorted.sort((a, b) => (a.openedAt ?? 0) - (b.openedAt ?? 0));
    if (sort === 'nameAsc') sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'nameDesc') sorted.sort((a, b) => b.name.localeCompare(a.name));
    if (sort === 'newest') sorted.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
    if (sort === 'oldest') sorted.sort((a, b) => (a.openedAt ?? 0) - (b.openedAt ?? 0));
    return sorted;
  }, [tab, localRows, cloudRows, sort]);

  const emptyCopy: Record<typeof tab, string> = {
    recent: 'No recent projects. Projects you open appear here.',
    private: 'No private projects yet. Every .deepnote file you open is private to this machine.',
    shared:
      cloud.configured === true
        ? 'Nothing shared with you yet in the connected workspace.'
        : 'Shared projects come from Deepnote Cloud. Connect a token from Integrations to list them.',
    all: 'No projects yet. Create one from the + menu in the sidebar.',
  };

  return (
    <VStack align="stretch" spacing={4}>
      <HStack justify="space-between">
        <Text fontSize="lg" fontWeight="semibold" color="gray.800">
          {TAB_TITLES[tab]}
        </Text>
        <HStack spacing={2}>
          <Select
            size="sm"
            maxW="260px"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort projects"
          >
            <option value="lastOpened">Last opened by me</option>
            <option value="nameAsc">Name ascending</option>
            <option value="nameDesc">Name descending</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </Select>
          <Button
            size="sm"
            colorScheme="brand"
            onClick={() => {
              const target = window.prompt('Path for the new .deepnote project:');
              if (target) useAppStore.getState().createProject(target);
            }}
          >
            Create new
          </Button>
        </HStack>
      </HStack>

      {rows.length === 0 ? (
        <Box borderWidth="1px" borderRadius="lg" p={6} textAlign="center">
          <Text fontSize="sm" color="gray.500">
            {emptyCopy[tab]}
          </Text>
        </Box>
      ) : (
        <Table size="sm" variant="simple">
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Location</Th>
              <Th>Sharing</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={`${row.location}:${row.path}`} _hover={{ bg: 'gray.50' }}>
                <Td>
                  <Text fontSize="sm" fontWeight="medium">
                    {row.name}
                  </Text>
                  <Text fontSize="2xs" color="gray.400" noOfLines={1}>
                    {row.path}
                  </Text>
                </Td>
                <Td>
                  <Badge
                    colorScheme={row.location === 'cloud' ? 'purple' : 'gray'}
                    fontSize="0.65rem"
                  >
                    {row.location === 'cloud' ? 'Deepnote Cloud' : 'Local'}
                  </Badge>
                </Td>
                <Td>
                  <Text fontSize="xs" color="gray.600">
                    {row.location === 'local' ? 'Private' : 'Workspace'}
                  </Text>
                </Td>
                <Td>
                  {row.location === 'local' ? (
                    <HStack spacing={1}>
                      <Button size="xs" variant="outline" onClick={() => openProject(row.path)}>
                        Open
                      </Button>
                      {project?.path === row.path && (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => navigate({ kind: 'project' })}
                        >
                          In editor
                        </Button>
                      )}
                    </HStack>
                  ) : (
                    <Text fontSize="xs" color="gray.400">
                      Cloud project
                    </Text>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {tab === 'all' && (
        <Box>
          <Text
            fontSize="xs"
            fontWeight="semibold"
            color="gray.500"
            textTransform="uppercase"
            mb={1}
          >
            Types
          </Text>
          <HStack spacing={2} fontSize="xs" color="gray.500">
            {['Explorations', 'Apps', 'Agents', 'Data pipelines'].map((t) => (
              <Badge key={t} variant="outline" colorScheme="gray">
                {t}
              </Badge>
            ))}
            <Text>
              are Deepnote Cloud project types; they appear here when a cloud token is connected.
            </Text>
          </HStack>
        </Box>
      )}
      <Button
        size="xs"
        variant="link"
        alignSelf="flex-start"
        colorScheme="brand"
        onClick={() => navigate({ kind: 'home' })}
      >
        ← Back to Home
      </Button>
    </VStack>
  );
}
