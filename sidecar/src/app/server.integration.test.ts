/**
 * Integration test against a real deepnote-toolkit server (Linux CI).
 *
 * Skipped automatically when the toolkit is not installed for the Python in
 * DEEPNOTE_PYTHON. Run with: pnpm test:integration
 */

import fs from 'node:fs';
import os from 'node:os';
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

  it('edits a block over WS and persists the change to the file', async () => {
    // Work on a copy so the shared fixture stays untouched.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-it-'));
    const copyPath = path.join(dir, 'copy.deepnote');
    fs.copyFileSync(FIXTURE, copyPath);

    const ws = new WebSocket(`${sidecar.url.replace('http', 'ws')}/ws?token=${TOKEN}`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('edit test timed out')), 60_000);
      ws.on('open', () => {
        ws.send(
          JSON.stringify({ v: 1, id: 'open', type: 'project:open', payload: { path: copyPath } }),
        );
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as { type: string; payload: Record<string, unknown> };
        // Ignore the connection replay (project null until our open lands).
        const project = msg.payload?.project as { path?: string } | null | undefined;
        if (msg.type === 'project:data' && project?.path === copyPath) {
          ws.send(
            JSON.stringify({
              v: 1,
              id: 'edit',
              type: 'block:update',
              payload: { blockId: 'block-sum', content: 'print(21 * 2)' },
            }),
          );
        } else if (msg.type === 'project:updated') {
          const onDisk = fs.readFileSync(copyPath, 'utf8');
          expect(onDisk).toContain('print(21 * 2)');
          clearTimeout(timer);
          resolve();
        } else if (msg.type === 'project:error') {
          clearTimeout(timer);
          reject(new Error(String(msg.payload.message)));
        }
      });
      ws.on('error', reject);
    });
    ws.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 90_000);

  it('creates a terminal and proxies input/output through /terminal', async () => {
    const ws = new WebSocket(`${sidecar.url.replace('http', 'ws')}/ws?token=${TOKEN}`);
    let terminalName = '';
    let terminalRunSent = false;

    await new Promise<void>((resolve, reject) => {
      // First run of the suite: the kernel starts from cold here.
      const timer = setTimeout(() => reject(new Error('terminal create timed out')), 240_000);
      ws.on('open', () => {
        // The manager is shared: reopen the durable fixture (the previous
        // test worked on a temp copy it already deleted) and run it, since
        // the toolkit only owns terminals while a kernel is up.
        ws.send(
          JSON.stringify({ v: 1, id: 'open', type: 'project:open', payload: { path: FIXTURE } }),
        );
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as { type: string; payload: Record<string, unknown> };
        const project = msg.payload?.project as { name?: string } | null | undefined;
        // Skip the connection replay (null until our open lands, or a project
        // left by a previous test in this shared sidecar).
        if (msg.type === 'project:data' && project?.path === FIXTURE) {
          if (!terminalRunSent) {
            terminalRunSent = true;
            ws.send(JSON.stringify({ v: 1, id: 'run', type: 'exec:run', payload: {} }));
          }
        } else if (msg.type === 'exec:output') {
          ws.send(JSON.stringify({ v: 1, id: 'term', type: 'terminal:create' }));
        } else if (msg.type === 'terminals:data') {
          const terminals = msg.payload.terminals as string[];
          if (terminals.length > 0) {
            terminalName = terminals[0];
            clearTimeout(timer);
            resolve();
          }
        }
      });
      ws.on('error', reject);
    });
    ws.close();
    expect(terminalName).toBeTruthy();

    // Raw proxy: echo a command and expect its output back.
    const termUrl = `${sidecar.url.replace('http', 'ws')}/terminal?token=${TOKEN}&name=${terminalName}`;
    const term = new WebSocket(termUrl);
    let output = '';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('terminal proxy timed out')), 90_000);
      term.on('open', () => {
        // Jupyter terminal wire format: ["stdin", data]. The shell may still
        // be printing its motd, so resend the command until it answers.
        const command = 'echo dnd-terminal-ok\r';
        term.send(JSON.stringify(['stdin', command]));
        const resend = setInterval(() => {
          if (term.readyState === term.OPEN) term.send(JSON.stringify(['stdin', command]));
          else clearInterval(resend);
        }, 3000);
        setTimeout(() => clearInterval(resend), 80_000);
      });
      term.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as unknown[];
          if (msg[0] === 'stdout' && typeof msg[1] === 'string') output += msg[1];
        } catch {
          output += String(raw);
        }
        if (output.includes('dnd-terminal-ok')) {
          clearTimeout(timer);
          resolve();
        }
      });
      term.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    term.close();
    expect(output).toContain('dnd-terminal-ok');
  }, 300_000);

  it('creates an agent block and runs the notebook with a controlled agent failure', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-agent-'));
    const copyPath = path.join(dir, 'agent.deepnote');
    fs.copyFileSync(FIXTURE, copyPath);

    const ws = new WebSocket(`${sidecar.url.replace('http', 'ws')}/ws?token=${TOKEN}`);
    let agentBlockId = '';
    let agentRunSent = false;

    await new Promise<void>((resolve, reject) => {
      // Suite runs need a cold kernel start after two project switches.
      const timer = setTimeout(() => reject(new Error('agent test timed out')), 240_000);
      ws.on('open', () => {
        ws.send(
          JSON.stringify({ v: 1, id: 'open', type: 'project:open', payload: { path: copyPath } }),
        );
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as { type: string; payload: Record<string, unknown> };
        const project = msg.payload?.project as { path?: string } | null | undefined;
        if (msg.type === 'project:data' && project?.path === copyPath) {
          ws.send(
            JSON.stringify({
              v: 1,
              id: 'create',
              type: 'block:create',
              payload: {
                notebookId: 'notebook-hello',
                afterBlockId: 'block-sum',
                blockType: 'agent',
              },
            }),
          );
        } else if (msg.type === 'project:updated') {
          const updated = msg.payload.project as {
            notebooks: Array<{ blocks: Array<{ id: string; type: string; content: string }> }>;
          };
          const agent = updated.notebooks[0].blocks.find((b) => b.type === 'agent');
          if (agent && !agentBlockId) {
            agentBlockId = agent.id;
            // No API key is configured: the agent must fail as a failed block
            // (not a crash), exercising the full SDK wiring.
            agentRunSent = true;
            ws.send(
              JSON.stringify({
                v: 1,
                id: 'run',
                type: 'exec:run',
                payload: { blockIds: [agent.id] },
              }),
            );
          }
        } else if (
          msg.type === 'exec:block-start' ||
          msg.type === 'exec:block-done' ||
          msg.type === 'log' ||
          msg.type === 'kernel:state' ||
          msg.type === 'project:updated'
        ) {
          console.log('[agent-test]', msg.type, JSON.stringify(msg.payload).slice(0, 140));
        } else if (msg.type === 'exec:done') {
          const summary = msg.payload.summary as { executedBlocks: number; failedBlocks: number };
          // Run results are broadcast to every connection: skip summaries that
          // belong to a previous test's run (ours executes exactly one block).
          if (summary.executedBlocks !== 1) {
            console.log('[agent-test] ignoring residual exec:done', JSON.stringify(summary));
            return;
          }
          expect(summary.failedBlocks).toBeGreaterThanOrEqual(1);
          clearTimeout(timer);
          resolve();
        } else if (msg.type === 'exec:error') {
          const message = String(msg.payload.message);
          console.log('[agent-test] exec:error', message.slice(0, 200));
          // The engine may still be busy with a previous test: retry ours once.
          if (message.includes('already in progress') && agentRunSent) {
            setTimeout(() => {
              ws.send(
                JSON.stringify({
                  v: 1,
                  id: 'run-retry',
                  type: 'exec:run',
                  payload: { blockIds: [agentBlockId] },
                }),
              );
            }, 1500);
            return;
          }
          // A typed run-level error is also an acceptable controlled failure.
          clearTimeout(timer);
          resolve();
        }
      });
      ws.on('error', reject);
    });
    ws.close();
    expect(agentBlockId).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 300_000);

  it('opens a project and streams notebook outputs', async () => {
    const ws = new WebSocket(`${sidecar.url.replace('http', 'ws')}/ws?token=${TOKEN}`);
    const outputs: string[] = [];
    let opened = false;
    let runSent = false;

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
          const project = msg.payload.project as { path?: string } | null;
          // Only our own open of the fixture counts: the replay may carry a
          // project left by a previous test in this shared sidecar.
          if (project?.path !== FIXTURE) return;
          opened = true;
          if (runSent) return;
          runSent = true;
          ws.send(JSON.stringify({ v: 1, id: 'run', type: 'exec:run', payload: {} }));
        } else if (msg.type === 'exec:output') {
          const output = msg.payload.output as { text?: string };
          if (output.text) outputs.push(output.text);
        } else if (msg.type === 'exec:done') {
          const summary = msg.payload.summary as { executedBlocks: number; failedBlocks: number };
          expect(summary.executedBlocks).toBe(3);
          expect(summary.failedBlocks).toBe(0);
          clearTimeout(timer);
          resolve();
        } else if (msg.type === 'exec:error' || msg.type === 'project:error') {
          // Errors are not correlated to requests yet; ignore residuals from a
          // previous test and retry once if our own run found the engine busy.
          if (!runSent) return;
          const message = String(msg.payload.message);
          if (message.includes('already in progress')) {
            setTimeout(() => {
              ws.send(JSON.stringify({ v: 1, id: 'run-retry', type: 'exec:run', payload: {} }));
            }, 1500);
            return;
          }
          clearTimeout(timer);
          reject(new Error(message));
        }
      });
      ws.on('error', reject);
    });

    expect(opened).toBe(true);
    // Outputs are broadcast to every connection without correlation, so with
    // the kernel shared across tests only the tail of a run is guaranteed
    // here (the first block's stdout can be missed when this client connects
    // mid-run). The full output set is asserted by the E2E UI tests.
    expect(outputs.join('')).toContain('42');
    expect(outputs.join('')).toContain('84');
    ws.close();
  }, 300_000);
});
