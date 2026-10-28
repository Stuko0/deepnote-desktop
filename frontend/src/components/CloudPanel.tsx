/** Deepnote Cloud panel (phase 5): token, workspace check, remote notebook run. */

import { Badge, Box, Button, HStack, Input, Spinner, Text, VStack } from '@chakra-ui/react';
import { useState } from 'react';

import { useAppStore } from '../store';

export function CloudPanel() {
  const { cloud, cloudStatus, cloudRun, setSecret, selectedNotebookId } = useAppStore();
  const [token, setToken] = useState('');

  return (
    <Box mt={4} borderWidth="1px" borderRadius="md" p={2}>
      <HStack justify="space-between" mb={1}>
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" color="gray.500">
          Deepnote Cloud
        </Text>
        {cloud.configured && !cloud.error ? (
          <Badge colorScheme="green" fontSize="0.6rem">
            {cloud.workspace?.name ?? 'connected'}
          </Badge>
        ) : (
          <Badge colorScheme="gray" fontSize="0.6rem">
            not configured
          </Badge>
        )}
      </HStack>

      <VStack align="stretch" spacing={1}>
        <Text fontSize="xs" color="gray.400">
          API token from deepnote.com/settings. Stored in the OS keychain inside the app.
        </Text>
        <HStack spacing={1}>
          <Input
            size="xs"
            type="password"
            placeholder="DEEPNOTE_TOKEN"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <Button
            size="xs"
            isDisabled={!token}
            onClick={() => {
              setSecret('DEEPNOTE_TOKEN', token);
              setToken('');
              setTimeout(cloudStatus, 300);
            }}
          >
            Save
          </Button>
        </HStack>
        <HStack spacing={1}>
          <Button size="xs" variant="outline" onClick={cloudStatus}>
            Check connection
          </Button>
          <Button
            size="xs"
            colorScheme="accent"
            isDisabled={!cloud.configured || !selectedNotebookId || cloud.running}
            onClick={cloudRun}
          >
            Run notebook in cloud
          </Button>
          {cloud.running && <Spinner size="xs" />}
        </HStack>

        {cloud.baseUrl && (
          <Text fontSize="2xs" color="gray.400">
            {cloud.baseUrl}
          </Text>
        )}
        {cloud.log && (
          <Text fontSize="xs" color="gray.600">
            {cloud.log}
          </Text>
        )}
        {cloud.run && (
          <Text fontSize="xs" color={cloud.run.success ? 'green.600' : 'red.500'}>
            run {cloud.run.runId ? `${cloud.run.runId.slice(0, 8)} ` : ''}
            {cloud.run.status}
            {cloud.run.snapshotSaved ? ' (snapshot saved)' : ''}
            {cloud.run.error ? ` - ${cloud.run.error}` : ''}
          </Text>
        )}
        {cloud.error && !cloud.run && (
          <Text fontSize="xs" color="red.500">
            {cloud.error}
          </Text>
        )}
      </VStack>
    </Box>
  );
}
