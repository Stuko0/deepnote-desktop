/**
 * Command palette (ctrl+P): the same command registry feeds the palette and
 * the keyboard shortcuts, so they can never diverge.
 */

import {
  Box,
  Input,
  Kbd,
  Modal,
  ModalBody,
  ModalContent,
  ModalOverlay,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useEffect, useMemo, useState } from 'react';

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return commands;
    return commands.filter((c) => c.title.toLowerCase().includes(q));
  }, [commands, query]);

  const runActive = (): void => {
    const command = filtered[active];
    if (command) {
      onClose();
      command.run();
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} isCentered size="lg">
      <ModalOverlay />
      <ModalContent borderRadius="lg" mt="-10vh">
        <ModalBody p={0}>
          <Input
            placeholder="Type a command..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runActive();
              }
            }}
            borderWidth="0px"
            _focus={{ boxShadow: 'none' }}
            fontSize="md"
            py={4}
          />
          <VStack
            align="stretch"
            maxH="320px"
            overflowY="auto"
            borderTopWidth="1px"
            borderTopColor="gray.100"
          >
            {filtered.map((command, index) => (
              <Box
                key={command.id}
                px={4}
                py={2}
                bg={index === active ? 'accent.50' : 'transparent'}
                cursor="pointer"
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  onClose();
                  command.run();
                }}
              >
                <Text fontSize="sm">{command.title}</Text>
              </Box>
            ))}
            {filtered.length === 0 && (
              <Text px={4} py={3} fontSize="sm" color="gray.500">
                No matching commands
              </Text>
            )}
          </VStack>
          <Box px={4} py={2} borderTopWidth="1px" borderTopColor="gray.100">
            <Text fontSize="xs" color="gray.500">
              <Kbd>ctrl</Kbd> + <Kbd>P</Kbd> opens the palette, <Kbd>ctrl</Kbd> + <Kbd>Enter</Kbd>{' '}
              runs the selected block
            </Text>
          </Box>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
