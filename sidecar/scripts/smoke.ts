/**
 * End-to-end smoke test against a running sidecar.
 *
 * Usage: SIDCAR_URL=http://127.0.0.1:PORT SIDCAR_TOKEN=... PROJECT=... npx tsx scripts/smoke.ts
 *
 * Opens the project over WebSocket, runs the whole notebook, and asserts that
 * streamed outputs arrive and that a run summary is produced.
 */

import WebSocket from 'ws';

const url = process.env.SIDCAR_URL ?? 'http://127.0.0.1:8791';
const token = process.env.SIDCAR_TOKEN ?? 'devtoken';
const project =
  process.env.PROJECT ??
  new URL('../../test-fixtures/hello-world.deepnote', import.meta.url).pathname;

const wsUrl = `${url.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`;
const ws = new WebSocket(wsUrl);

const outputs: string[] = [];
let done = false;
let failed = false;

const timeout = setTimeout(() => {
  console.error('SMOKE FAIL: timed out waiting for exec:done');
  process.exit(1);
}, 240_000);

function finish(): void {
  clearTimeout(timeout);
  const joined = outputs.join('\n');
  if (failed) {
    console.error('SMOKE FAIL: run reported an error');
    process.exit(1);
  }
  if (!joined.includes('hello from deepnote-desktop')) {
    console.error(`SMOKE FAIL: expected streamed output not found. Got:\n${joined}`);
    process.exit(1);
  }
  if (!joined.includes('42')) {
    console.error(`SMOKE FAIL: expected second block output (42). Got:\n${joined}`);
    process.exit(1);
  }
  console.log('SMOKE PASS');
  ws.close();
  process.exit(0);
}

ws.on('open', () => {
  ws.send(JSON.stringify({ v: 1, id: 'open-1', type: 'project:open', payload: { path: project } }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  switch (msg.type) {
    case 'project:data': {
      const model = msg.payload?.project;
      if (!model) {
        console.error('SMOKE FAIL: project payload is null');
        process.exit(1);
      }
      console.log(
        `opened: ${model.name} (${model.notebooks.length} notebook(s), python ${model.python.path}, toolkit=${model.python.toolkitInstalled})`,
      );
      ws.send(JSON.stringify({ v: 1, id: 'run-1', type: 'exec:run', payload: {} }));
      break;
    }
    case 'exec:block-start':
      console.log(
        `block start: ${msg.payload.blockId} (${msg.payload.index + 1}/${msg.payload.total})`,
      );
      break;
    case 'exec:output': {
      const o = msg.payload.output;
      const text = o.text ?? o.data?.['text/plain'] ?? '';
      if (text) outputs.push(String(text).trim());
      console.log(`output [${msg.payload.blockId}]: ${o.output_type} ${String(text).slice(0, 60)}`);
      break;
    }
    case 'exec:block-done':
      console.log(
        `block done: ${msg.payload.blockId} success=${msg.payload.success} ${msg.payload.durationMs}ms`,
      );
      break;
    case 'exec:done': {
      const s = msg.payload.summary;
      console.log(
        `run done: ${s.executedBlocks}/${s.totalBlocks} blocks, ${s.failedBlocks} failed, ${s.totalDurationMs}ms, snapshot=${msg.payload.snapshotPath ?? 'none'}`,
      );
      done = true;
      finish();
      break;
    }
    case 'exec:error':
      console.error(`exec error: ${msg.payload.message} (${msg.payload.category ?? 'unknown'})`);
      failed = true;
      done = true;
      break;
    case 'project:error':
      console.error(`project error: ${msg.payload.message}`);
      process.exit(1);
      break;
    default:
      break;
  }
});

ws.on('close', () => {
  clearTimeout(timeout);
  if (!done) {
    console.error('SMOKE FAIL: connection closed before run finished');
    process.exit(1);
  }
  const joined = outputs.join('\n');
  if (failed) {
    console.error('SMOKE FAIL: run reported an error');
    process.exit(1);
  }
  if (!joined.includes('hello from deepnote-desktop')) {
    console.error(`SMOKE FAIL: expected streamed output not found. Got:\n${joined}`);
    process.exit(1);
  }
  if (!joined.includes('42')) {
    console.error(`SMOKE FAIL: expected second block output (42). Got:\n${joined}`);
    process.exit(1);
  }
  console.log('SMOKE PASS');
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('SMOKE FAIL: websocket error', error.message);
  process.exit(1);
});
