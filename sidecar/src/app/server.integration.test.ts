/**
 * Integration test against a real deepnote-toolkit server (Linux CI).
 *
 * Skipped automatically when the toolkit is not installed for the Python in
 * DEEPNOTE_PYTHON. Run with: pnpm test:integration
 */

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { hasDeepnoteToolkit } from '@deepnote/runtime-core';
import { type RunningSidecar, startSidecar } from '../app/server.js';

const FIXTURE = path.join(import.meta.dirname, '../../../test-fixtures/hello-world.deepnote');
const TOKEN = 'integration-token';

const toolkitInstalled = await hasDeepnoteToolkit(process.env.DEEPNOTE_PYTHON ?? 'python3').catch(
  () => false,
);

describe.skipIf(!toolkitInstalled)('sidecar end to end (real kernel)', () => {
  let sidecar: RunningSidecar;

  beforeAll(async () => {
    sidecar = await startSidecar({ token: TOKEN });
  });

  afterAll(async () => {
    await sidecar.close();
  });

  it('responds to health checks', async () => {
    const res = await fetch(`${sidecar.url}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; protocol: number };
    expect(body.ok).toBe(true);
    expect(body.protocol).toBe(1);
  });

  it('rejects websocket connections without the session token', async () => {
    const ws = new WebSocket(`${sidecar.url.replace('http', 'ws')}/ws?token=wrong`);
    const failed = await new Promise<boolean>((resolve) => {
      ws.on('error', () => resolve(true));
      ws.on('open', () => resolve(false));
    });
    expect(failed).toBe(true);
  }, 15_000);

  it('opens a project and streams notebook outputs', async () => {
    const ws = new WebSocket(`${sidecar.url.replace('http', 'ws')}/ws?token=${TOKEN}`);
    const outputs: string[] = [];
    let opened = false;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('run timed out')), 240_000);
      ws.on('open', () => {
        ws.send(
          JSON.stringify({ v: 1, id: 'open', type: 'project:open', payload: { path: FIXTURE } }),
        );
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          type: string;
          payload: Record<string, unknown>;
        };
        if (msg.type === 'project:data') {
          const project = msg.payload.project as { name: string; notebooks: unknown[] } | null;
          expect(project?.name).toBe('Hello World');
          opened = true;
          ws.send(JSON.stringify({ v: 1, id: 'run', type: 'exec:run', payload: {} }));
        } else if (msg.type === 'exec:output') {
          const output = msg.payload.output as { text?: string };
          if (output.text) outputs.push(output.text);
        } else if (msg.type === 'exec:done') {
          const summary = msg.payload.summary as { executedBlocks: number; failedBlocks: number };
          expect(summary.executedBlocks).toBe(2);
          expect(summary.failedBlocks).toBe(0);
          clearTimeout(timer);
          resolve();
        } else if (msg.type === 'exec:error' || msg.type === 'project:error') {
          clearTimeout(timer);
          reject(new Error(String(msg.payload.message)));
        }
      });
      ws.on('error', reject);
    });

    expect(opened).toBe(true);
    expect(outputs.join('')).toContain('hello from deepnote-desktop');
    expect(outputs.join('')).toContain('42');
    ws.close();
  }, 300_000);
});
