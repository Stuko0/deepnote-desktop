/**
 * Local server: HTTP (health, graceful shutdown) and WebSocket (/ws for the
 * protocol, /terminal for a raw proxy to the toolkit's Jupyter terminals).
 * Binds to loopback only and requires a session token.
 *
 * One SessionManager is shared by every connection of this sidecar: the
 * sidecar represents the desktop user's single notebook session, and
 * terminals/projects must be reachable from any view (main window, future
 * secondary windows).
 */

import http from 'node:http';
import type { Duplex } from 'node:stream';
import { parse as parseUrl } from 'node:url';
import { WebSocketServer, WebSocket as WsClient } from 'ws';

import { fetchCloudStatus, runNotebookInCloud } from '../core/cloud.js';
import { PROTOCOL_VERSION, parseClientMessage } from '../core/protocol.js';
import type { ClientMessage, ServerMessage } from '../core/protocol.js';
import { SessionManager } from '../core/session.js';

export interface SidecarServerOptions {
  token: string;
  port?: number;
  host?: string;
  version?: string;
}

export interface RunningSidecar {
  port: number;
  url: string;
  server: http.Server;
  close: () => Promise<void>;
}

export function startSidecar(options: SidecarServerOptions): Promise<RunningSidecar> {
  const host = options.host ?? '127.0.0.1';
  const version = options.version ?? '0.1.0';
  const clients = new Set<import('ws').WebSocket>();
  let closeAll: () => Promise<void> = async () => {};

  const broadcast = (message: ServerMessage): void => {
    const frame = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(frame);
    }
  };

  const manager = new SessionManager(broadcast);

  const server = http.createServer((req, res) => {
    const parsed = parseUrl(req.url ?? '/', true);

    if (parsed.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version, protocol: PROTOCOL_VERSION }));
      return;
    }

    if (parsed.pathname === '/shutdown' && req.method === 'POST') {
      if (parsed.query.token !== options.token) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      setImmediate(() => void closeAll());
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const parsed = parseUrl(req.url ?? '/', true);
    if (parsed.query.token !== options.token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (parsed.pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }

    if (parsed.pathname === '/terminal' && typeof parsed.query.name === 'string') {
      proxyTerminal(parsed.query.name, req, socket, head, manager, wss);
      return;
    }

    socket.destroy();
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    const send = (message: ServerMessage): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };

    send({ v: PROTOCOL_VERSION, type: 'log', payload: { level: 'info', message: 'connected' } });
    // Replay current session state so reconnecting views do not go blank.
    send({
      v: PROTOCOL_VERSION,
      type: 'project:data',
      payload: { project: manager.currentProject()?.model ?? null },
    });
    send({ v: PROTOCOL_VERSION, type: 'kernel:state', payload: { state: manager.state } });

    ws.on('message', async (data) => {
      const message = parseClientMessage(data.toString());
      if (!message) {
        send({
          v: PROTOCOL_VERSION,
          type: 'log',
          payload: { level: 'warn', message: 'invalid message' },
        });
        return;
      }
      try {
        await handle(message, manager, send);
      } catch (error) {
        console.error(
          `[handler] ${message.type} failed:`,
          error instanceof Error ? (error.stack ?? error.message) : String(error),
        );
        send({
          v: PROTOCOL_VERSION,
          id: message.id,
          type: 'project:error',
          payload: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });

    ws.on('close', () => clients.delete(ws));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      closeAll = async () => {
        await manager.close().catch(() => undefined);
        for (const client of clients) client.close();
        wss.close();
        await new Promise<void>((done) => server.close(() => done()));
      };
      resolve({
        port,
        url: `http://${host}:${port}`,
        server,
        close: () => closeAll(),
      });
    });
  });
}

function proxyTerminal(
  name: string,
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  manager: SessionManager,
  wss: WebSocketServer,
): void {
  let toolkitUrl: string;
  try {
    toolkitUrl = manager.toolkitUrl();
  } catch {
    socket.write('HTTP/1.1 503 Kernel not running\r\n\r\n');
    socket.destroy();
    return;
  }
  // Jupyter Server mounts the terminal WebSocket at /terminals/websocket/{name}
  // (the /api/terminals/{name} REST route answers JSON, not an upgrade).
  const upstreamUrl = `${toolkitUrl.replace('http', 'ws')}/terminals/websocket/${encodeURIComponent(name)}`;
  const upstream = new WsClient(upstreamUrl);

  upstream.on('open', () => {
    // Complete the browser handshake with the real upgrade request, then pipe.
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (data) => {
        if (upstream.readyState === WsClient.OPEN) upstream.send(data.toString());
      });
      upstream.on('message', (data) => {
        if (ws.readyState === ws.OPEN) ws.send(data.toString());
      });
      const closeBoth = (): void => {
        if (upstream.readyState === WsClient.OPEN) upstream.close();
        if (ws.readyState === ws.OPEN) ws.close();
      };
      ws.on('close', closeBoth);
      ws.on('error', closeBoth);
      upstream.on('close', closeBoth);
      upstream.on('error', closeBoth);
    });
  });

  upstream.on('error', (error) => {
    console.error(`[terminal-proxy] upstream ${upstreamUrl} failed: ${error.message}`);
    socket.write('HTTP/1.1 502 Terminal unavailable\r\n\r\n');
    socket.destroy();
  });
  upstream.on('unexpected-response', (_req, res) => {
    console.error(`[terminal-proxy] upstream ${upstreamUrl} answered ${res.statusCode}`);
    socket.write(`HTTP/1.1 502 Terminal unavailable (${res.statusCode})\r\n\r\n`);
    socket.destroy();
  });
}

async function handle(
  message: ClientMessage,
  manager: SessionManager,
  send: (message: ServerMessage) => void,
): Promise<void> {
  switch (message.type) {
    case 'project:get': {
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'project:data',
        payload: { project: manager.currentProject()?.model ?? null },
      });
      return;
    }
    case 'project:open': {
      await manager.open(message.payload.path);
      return;
    }
    case 'project:close': {
      await manager.close();
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'project:data',
        payload: { project: null },
      });
      return;
    }
    case 'exec:run': {
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'ack',
        payload: { for: 'exec:run', ok: true },
      });
      await manager.run(message.payload ?? {});
      return;
    }
    case 'project:save': {
      await manager.save();
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'ack',
        payload: { for: 'project:save', ok: true },
      });
      return;
    }
    case 'block:update': {
      await manager.updateBlock(
        message.payload.blockId,
        message.payload.content,
        message.payload.metadata,
      );
      return;
    }
    case 'block:create': {
      const createPayload = message.payload;
      await manager.createBlock(
        createPayload.notebookId,
        createPayload.afterBlockId,
        createPayload.blockType,
      );
      return;
    }
    case 'block:delete': {
      await manager.deleteBlock(message.payload.blockId);
      return;
    }
    case 'block:move': {
      await manager.moveBlock(message.payload.blockId, message.payload.direction);
      return;
    }
    case 'dag:get': {
      const notebookId = message.payload.notebookId;
      try {
        const dag = await manager.getDag(notebookId);
        send({
          v: PROTOCOL_VERSION,
          id: message.id,
          type: 'dag:data',
          payload: { notebookId, dag },
        });
      } catch (error) {
        send({
          v: PROTOCOL_VERSION,
          id: message.id,
          type: 'dag:data',
          payload: {
            notebookId,
            dag: null,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      return;
    }
    case 'fs:list': {
      const fsResult = await manager.listFiles(message.payload?.subpath ?? '');
      send({ v: PROTOCOL_VERSION, id: message.id, type: 'fs:data', payload: fsResult });
      return;
    }
    case 'integrations:get':
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'integrations:data',
        payload: { integrations: manager.getIntegrations() },
      });
      return;
    case 'cloud:status': {
      const status = await fetchCloudStatus({ env: manager.cloudEnv() });
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'cloud:data',
        payload: { kind: 'status', ...status },
      });
      return;
    }
    case 'cloud:run': {
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'ack',
        payload: { for: 'cloud:run', ok: true },
      });
      const result = await runNotebookInCloud(message.payload.notebookId, {
        env: manager.cloudEnv(),
        onStatus: (status) => {
          send({
            v: PROTOCOL_VERSION,
            id: message.id,
            type: 'cloud:data',
            payload: { kind: 'run', log: status },
          });
        },
      });
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'cloud:data',
        payload: { kind: 'run', configured: true, run: result },
      });
      return;
    }
    case 'terminal:list': {
      const terminals = await manager.listTerminals().catch(() => []);
      send({ v: PROTOCOL_VERSION, id: message.id, type: 'terminals:data', payload: { terminals } });
      return;
    }
    case 'terminal:create': {
      const name = await manager.createTerminal();
      const terminals = await manager.listTerminals().catch(() => [name]);
      send({ v: PROTOCOL_VERSION, id: message.id, type: 'terminals:data', payload: { terminals } });
      return;
    }
    case 'secrets:set':
      await manager.setSecret(message.payload.envVar, message.payload.value);
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'integrations:data',
        payload: { integrations: manager.getIntegrations() },
      });
      return;
    case 'exec:stop':
      await manager.stop();
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'ack',
        payload: { for: 'exec:stop', ok: true },
      });
      return;
    case 'kernel:restart':
      await manager.restartKernel();
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'ack',
        payload: { for: 'kernel:restart', ok: true },
      });
      return;
    default: {
      const exhaustive: never = message;
      void exhaustive;
    }
  }
}
