/** Sidebar panels: project files explorer and integrations status. */

import { ArrowBackIcon, ChevronRightIcon, DownloadIcon } from '@chakra-ui/icons';
import {
  Box,
  Button,
  Code,
  HStack,
  IconButton,
  Input,
  Select,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useState } from 'react';

import type { FileEntryModel, IntegrationStatusModel } from '../protocol';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesPanel({
  fs,
  onNavigate,
}: {
  fs: { subpath: string; entries: FileEntryModel[] } | null;
  onNavigate: (subpath: string) => void;
}) {
  return (
    <Box>
      <HStack justify="space-between" mb={1}>
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" color="gray.500">
          Files
        </Text>
        {fs && fs.subpath !== '' && (
          <IconButton
            aria-label="Back to project root"
            icon={<ArrowBackIcon />}
            size="xs"
            variant="ghost"
            onClick={() => {
              const parts = fs.subpath.split('/').filter(Boolean);
              parts.pop();
              onNavigate(parts.join('/'));
            }}
          />
        )}
      </HStack>
      <VStack align="stretch" spacing={0} fontSize="sm">
        {fs?.entries.map((entry) => (
          <HStack
            key={entry.path}
            spacing={2}
            px={1}
            py={0.5}
            borderRadius="md"
            _hover={{ bg: 'gray.50' }}
            cursor={entry.isDirectory ? 'pointer' : 'default'}
            onClick={() => entry.isDirectory && onNavigate(entry.path)}
          >
            {entry.isDirectory ? (
              <>
                <ChevronRightIcon color="accent.500" />
                <Text noOfLines={1}>{entry.name}</Text>
              </>
            ) : (
              <>
                <DownloadIcon color="gray.400" boxSize={3} />
                <Text noOfLines={1} color="gray.600">
                  {entry.name}
                </Text>
                <Box flex={1} />
                <Text fontSize="xs" color="gray.400">
                  {humanSize(entry.size)}
                </Text>
              </>
            )}
          </HStack>
        ))}
        {fs && fs.entries.length === 0 && (
          <Text fontSize="xs" color="gray.400" px={1}>
            Empty folder
          </Text>
        )}
        {!fs && (
          <Text fontSize="xs" color="gray.400" px={1}>
            Open a project to browse its files
          </Text>
        )}
      </VStack>
    </Box>
  );
}

export function IntegrationsPanel({
  integrations,
  onRefresh,
  onSetSecret,
}: {
  integrations: IntegrationStatusModel[];
  onRefresh: () => void;
  onSetSecret: (envVar: string, value: string | null) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [aiKey, setAiKey] = useState('');
  return (
    <Box mt={4}>
      <HStack justify="space-between" mb={1}>
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" color="gray.500">
          Integrations
        </Text>
        <Button size="xs" variant="ghost" onClick={onRefresh}>
          Refresh
        </Button>
      </HStack>
      <VStack align="stretch" spacing={1} fontSize="sm">
        {integrations.length === 0 && (
          <Text fontSize="xs" color="gray.400">
            No integrations declared in this project
          </Text>
        )}
        {integrations.map((integration) => (
          <Box key={integration.id} borderWidth="1px" borderRadius="md" p={2}>
            <HStack spacing={2}>
              <Text fontWeight="medium" noOfLines={1}>
                {integration.name}
              </Text>
              <Text fontSize="xs" color="gray.400">
                {integration.type}
              </Text>
            </HStack>
            <Code fontSize="2xs" mt={1} display="block" noOfLines={1}>
              {integration.envVar}
            </Code>
            <Text fontSize="xs" mt={1} color={integration.configured ? 'green.600' : 'red.500'}>
              {integration.configured
                ? 'configured for this session'
                : 'missing: set it below or export it before launching'}
            </Text>
            <HStack mt={1} spacing={1}>
              <Input
                size="xs"
                type="password"
                placeholder="value (held in memory for this session)"
                value={drafts[integration.envVar] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [integration.envVar]: e.target.value }))}
              />
              <Button
                size="xs"
                isDisabled={!drafts[integration.envVar]}
                onClick={() => {
                  const value = drafts[integration.envVar];
                  if (value) {
                    onSetSecret(integration.envVar, value);
                    setDrafts((d) => ({ ...d, [integration.envVar]: '' }));
                  }
                }}
              >
                Set
              </Button>
            </HStack>
          </Box>
        ))}
      </VStack>

      <Box mt={4}>
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" color="gray.500" mb={1}>
          AI provider (agent blocks)
        </Text>
        <Text fontSize="xs" color="gray.400" mb={1}>
          Keys are held for this session and persisted to the OS keychain inside the app.
        </Text>
        <VStack align="stretch" spacing={1}>
          <Select
            size="xs"
            value={provider}
            onChange={(e) => setProvider(e.target.value as 'openai' | 'anthropic')}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </Select>
          <HStack spacing={1}>
            <Input
              size="xs"
              type="password"
              placeholder={provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'}
              value={aiKey}
              onChange={(e) => setAiKey(e.target.value)}
            />
            <Button
              size="xs"
              isDisabled={!aiKey}
              onClick={() => {
                onSetSecret(provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY', aiKey);
                setAiKey('');
              }}
            >
              Set
            </Button>
          </HStack>
        </VStack>
      </Box>
    </Box>
  );
}
