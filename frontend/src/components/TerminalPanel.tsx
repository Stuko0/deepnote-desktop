/**
 * Terminal panel: xterm.js bridged through the sidecar's /terminal proxy to
 * the toolkit's Jupyter terminals (real PTYs on the local machine).
 */

import { Box, Button, HStack, Select, Text } from '@chakra-ui/react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';

import { useSidecarTarget } from '../sidecarTarget';
import { useAppStore } from '../store';

/** Mounts xterm exactly when its container exists (rendered only with a kernel). */
function TerminalScreen({
  active,
  token,
  sidecarUrl,
}: { active: string; token: string; sidecarUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;
    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'Roboto Mono, ui-monospace, monospace',
      convertEol: true,
      cursorBlink: true,
      theme: { background: '#1a202c' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(['set_size', term.rows, term.cols]));
        }
      } catch {
        // container may be hidden
      }
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !active || !token) return;

    socketRef.current?.close();
    const wsUrl = `${sidecarUrl.replace(/^http/, 'ws')}/terminal?token=${encodeURIComponent(token)}&name=${encodeURIComponent(active)}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      // Jupyter terminal wire format: JSON arrays, not objects.
      socket.send(JSON.stringify(['set_size', term.rows, term.cols]));
    };
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as unknown[];
        if (msg[0] === 'stdout' && typeof msg[1] === 'string') term.write(msg[1]);
      } catch {
        term.write(String(event.data));
      }
    };
    socket.onclose = () => term.write('\r\n[terminal closed]\r\n');

    const disposable = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(['stdin', data]));
      }
    });

    return () => {
      disposable.dispose();
      socket.close();
    };
  }, [active, token, sidecarUrl]);

  return (
    <Box
      ref={containerRef}
      h="240px"
      borderRadius="md"
      overflow="hidden"
      borderWidth="1px"
      borderColor="gray.700"
      bg="#1a202c"
      p={1}
    />
  );
}

export function TerminalPanel() {
  const { terminals, refreshTerminals, createTerminal, kernelState } = useAppStore();
  const target = useSidecarTarget();
  const [active, setActive] = useState<string>('');

  // terminals:data arrives after the create call resolves on the server, so
  // derive the active terminal from the list instead of from the click.
  useEffect(() => {
    if (terminals.length > 0 && (!active || !terminals.includes(active))) {
      setActive(terminals[terminals.length - 1]);
    } else if (terminals.length === 0 && active) {
      setActive('');
    }
  }, [terminals, active]);

  // Terminals need a running kernel (the toolkit owns them).
  const needsKernel = kernelState !== 'ready' && kernelState !== 'running';

  return (
    <Box mt={4}>
      <HStack justify="space-between" mb={1}>
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" color="gray.500">
          Terminal
        </Text>
        <Button
          size="xs"
          variant="ghost"
          isDisabled={needsKernel}
          onClick={() => {
            void createTerminal();
          }}
        >
          New
        </Button>
      </HStack>
      {needsKernel ? (
        <Text fontSize="xs" color="gray.400">
          Start the kernel (run any block) to open a terminal
        </Text>
      ) : (
        <>
          {terminals.length > 0 && (
            <Select size="sm" mb={1} value={active} onChange={(e) => setActive(e.target.value)}>
              {terminals.map((name) => (
                <option key={name} value={name}>
                  terminal {name}
                </option>
              ))}
            </Select>
          )}
          <TerminalScreen active={active} token={target.token} sidecarUrl={target.url} />
        </>
      )}
    </Box>
  );
}
