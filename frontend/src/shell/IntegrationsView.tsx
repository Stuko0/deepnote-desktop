/** Integrations view: workspace integrations table + type catalog with filters. */

import {
  Badge,
  Box,
  Button,
  Divider,
  HStack,
  Input,
  SimpleGrid,
  Stack,
  Tag,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useEffect, useMemo, useState } from 'react';

import { useAppStore } from '../store';

/** Catalog groups from the SaaS catalog (product surface, not account data). */
const CATALOG: Array<{ group: string; items: string[] }> = [
  {
    group: 'Data warehouses & lakes',
    items: [
      'Snowflake',
      'Google BigQuery',
      'Amazon Redshift',
      'Databricks',
      'ClickHouse',
      'Amazon Athena',
      'Dremio',
      'Trino',
      'Presto',
    ],
  },
  {
    group: 'Databases',
    items: [
      'PostgreSQL',
      'MySQL',
      'MariaDB',
      'MongoDB',
      'Microsoft SQL Server',
      'Supabase',
      'Amazon DynamoDB',
    ],
  },
  {
    group: 'Files',
    items: [
      'Amazon S3',
      'Google Drive',
      'Google Cloud Storage',
      'Dropbox',
      'Box',
      'Microsoft OneDrive',
      'Google Sheets',
    ],
  },
  {
    group: 'Machine learning',
    items: ['Snowpark', 'Great Expectations', 'Apache Spark', 'Google Dataproc'],
  },
  { group: 'Version control', items: ['GitHub', 'GitLab', 'Amazon ECR', 'Docker Hub'] },
  { group: 'Collaboration', items: ['Slack', 'Notion', 'Airtable', 'Telegram'] },
  { group: 'Other', items: ['Environment variables', 'Code templates', 'MCP tools', 'Public API'] },
];

const FILTERS = [
  'All',
  'Data warehouses & lakes',
  'Databases',
  'Files',
  'Machine learning',
  'Version control',
  'Collaboration',
  'Other',
] as const;

export function IntegrationsView() {
  const { integrations, refreshIntegrations, cloud, cloudStatus, navigate } = useAppStore();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (cloud.configured === undefined) cloudStatus();
  }, [cloud.configured, cloudStatus]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATALOG.filter((g) => (filter === 'All' ? true : g.group === filter))
      .map((g) => ({ ...g, items: g.items.filter((i) => !q || i.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [filter, query]);

  return (
    <Stack spacing={5} maxW="1040px">
      <HStack justify="space-between">
        <Text fontSize="lg" fontWeight="semibold" color="gray.800">
          Integrations
        </Text>
        <HStack spacing={2}>
          <Button size="sm" variant="outline" onClick={refreshIntegrations}>
            Refresh project integrations
          </Button>
          <Button
            size="xs"
            variant="link"
            colorScheme="brand"
            onClick={() => navigate({ kind: 'home' })}
          >
            ← Home
          </Button>
        </HStack>
      </HStack>

      <Box>
        <Text fontSize="sm" fontWeight="semibold" color="gray.700" mb={1}>
          Workspace integrations
        </Text>
        <Text fontSize="xs" color="gray.500" mb={2}>
          Add an integration or data source to make it available to all projects in this workspace.
        </Text>
        {cloud.configured === true && !cloud.error ? (
          <HStack borderWidth="1px" borderRadius="md" p={3} bg="gray.50">
            <Badge colorScheme="purple">Deepnote Cloud</Badge>
            <Text fontSize="sm">{cloud.workspace?.name ?? 'workspace'}</Text>
            <Text fontSize="xs" color="gray.500">
              {cloud.baseUrl}
            </Text>
          </HStack>
        ) : (
          <Box borderWidth="1px" borderRadius="md" p={3} bg="gray.50">
            <Text fontSize="sm" color="gray.600">
              Connect Deepnote Cloud (token from your account settings) to use workspace
              integrations stored there.
            </Text>
            <Text fontSize="2xs" color="gray.400" mt={1}>
              The token is kept in the OS keychain and only used against the API you configure.
            </Text>
          </Box>
        )}
      </Box>

      <Divider />

      <Box>
        <Text fontSize="sm" fontWeight="semibold" color="gray.700" mb={2}>
          {integrations.length > 0
            ? 'Integrations in the open project'
            : 'No integrations declared in this project'}
        </Text>
        {integrations.length > 0 && (
          <VStack align="stretch" spacing={1}>
            {integrations.map((integration) => (
              <HStack key={integration.name} borderWidth="1px" borderRadius="md" px={3} py={2}>
                <Tag size="sm" colorScheme="brand">
                  {integration.type}
                </Tag>
                <Text fontSize="sm" fontWeight="medium">
                  {integration.name}
                </Text>
                <Text fontSize="xs" color="gray.500" fontFamily="mono">
                  {integration.envVar}
                </Text>
                <Tag size="sm" colorScheme={integration.configured ? 'green' : 'gray'} ml="auto">
                  {integration.configured ? 'configured' : 'missing'}
                </Tag>
              </HStack>
            ))}
          </VStack>
        )}
      </Box>

      <Divider />

      <Box>
        <HStack justify="space-between" mb={2}>
          <Text fontSize="sm" fontWeight="semibold" color="gray.700">
            Catalog
          </Text>
          <Input
            size="sm"
            maxW="220px"
            placeholder="Search integrations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </HStack>
        <HStack spacing={1} mb={3} flexWrap="wrap">
          {FILTERS.map((f) => (
            <Tag
              key={f}
              size="sm"
              cursor="pointer"
              colorScheme={filter === f ? 'brand' : 'gray'}
              onClick={() => setFilter(f)}
            >
              {f}
            </Tag>
          ))}
        </HStack>
        <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={3}>
          {groups.map((g) => (
            <Box key={g.group} borderWidth="1px" borderRadius="md" p={3}>
              <Text
                fontSize="xs"
                fontWeight="semibold"
                color="gray.500"
                textTransform="uppercase"
                mb={1}
              >
                {g.group}
              </Text>
              <VStack align="stretch" spacing={0}>
                {g.items.map((item) => (
                  <HStack key={item} justify="space-between" py={0.5}>
                    <Text fontSize="sm" color="gray.700">
                      {item}
                    </Text>
                    <Badge fontSize="0.6rem" colorScheme="gray" variant="outline">
                      Cloud
                    </Badge>
                  </HStack>
                ))}
              </VStack>
            </Box>
          ))}
        </SimpleGrid>
      </Box>
    </Stack>
  );
}
