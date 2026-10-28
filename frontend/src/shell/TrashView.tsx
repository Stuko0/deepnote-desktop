/** Trash: deleted projects are kept for 30 days (empty state today). */

import { Box, Button, Stack, Text } from '@chakra-ui/react';

import { useAppStore } from '../store';

export function TrashView() {
  return (
    <Stack spacing={4} maxW="720px">
      <Box>
        <Text fontSize="lg" fontWeight="semibold" color="gray.800">
          Trash
        </Text>
        <Text fontSize="sm" color="gray.500">
          Deleted projects are kept for 30 days before being permanently removed.
        </Text>
      </Box>
      <Box borderWidth="1px" borderRadius="lg" p={8} textAlign="center" bg="gray.50">
        <Text fontSize="sm" color="gray.500" mb={1}>
          No deleted projects
        </Text>
        <Text fontSize="xs" color="gray.400">
          Deleted projects will appear here for 30 days before being permanently removed. Local
          deletion moves the file to the system trash when the shell supports it.
        </Text>
      </Box>
      <Button
        size="xs"
        variant="link"
        alignSelf="flex-start"
        colorScheme="brand"
        onClick={() => useAppStore.getState().navigate({ kind: 'home' })}
      >
        ← Back to Home
      </Button>
    </Stack>
  );
}
