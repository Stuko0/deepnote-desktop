/**
 * Local server: HTTP (health + project snapshot) and WebSocket (/ws) speaking
 * protocol v1. Binds to loopback only and requires a session token.
 */

import fs from 'node:fs';
import http from 'node:http';
import { parse as parseUrl } from 'node:url';
import { WebSocketServer } from 'ws';

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
  let closeAll: () => Promise<void> = async () => {};

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
  const managers = new Map<string, SessionManager>();

  server.on('upgrade', (req, socket, head) => {
    const parsed = parseUrl(req.url ?? '/', true);
    if (parsed.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const token = parsed.query.token;
    if (token !== options.token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    const send = (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };

    // One manager per connection keeps notebook sessions isolated per client.
    const manager = new SessionManager(send);
    managers.set(String(Date.now() + Math.random()), manager);

    send({ v: PROTOCOL_VERSION, type: 'log', payload: { level: 'info', message: 'connected' } });

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
        send({
          v: PROTOCOL_VERSION,
          id: message.id,
          type: 'project:error',
          payload: {
            message: error instanceof Error ? error.message : String(error),
            kind:
              error instanceof Error && 'name' in error
                ? String((error as { name: string }).name)
                : undefined,
          },
        });
      }
    });

    ws.on('close', () => {
      void manager.close();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      closeAll = async () => {
        for (const manager of managers.values()) await manager.close();
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
    case 'integrations:get': {
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'integrations:data',
        payload: { integrations: manager.getIntegrations() },
      });
      return;
    }
    case 'exec:stop': {
      await manager.stop();
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'ack',
        payload: { for: 'exec:stop', ok: true },
      });
      return;
    }
    case 'kernel:restart': {
      await manager.restartKernel();
      send({
        v: PROTOCOL_VERSION,
        id: message.id,
        type: 'ack',
        payload: { for: 'kernel:restart', ok: true },
      });
      return;
    }
    default: {
      const exhaustive: never = message;
      void exhaustive;
    }
  }
}

/** Convenience for tests: unused by the CLI entrypoint. */
export function isReadableFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
