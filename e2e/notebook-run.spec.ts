/**
 * End-to-end test: real sidecar, real Jupyter kernel, real UI.
 *
 * Starts the compiled sidecar and a static server for the built frontend,
 * then drives the UI with Playwright: open the fixture project, run the
 * notebook, and assert the streamed outputs render.
 *
 * Requires: sidecar/dist built, frontend/dist built, and a Python with
 * `deepnote-toolkit[server]` (point DEEPNOTE_PYTHON at it).
 */

import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURE = path.join(ROOT, 'test-fixtures', 'hello-world.deepnote');
const FRONTEND_DIST = path.join(ROOT, 'frontend', 'dist');
const SIDECAR_DIST = path.join(ROOT, 'sidecar', 'dist', 'index.js');
const TOKEN = 'e2e-token';
const UI_PORT = 1480;

let sidecar: ChildProcess | null = null;
let sidecarPort = 0;
let staticServer: http.Server | null = null;

function mimeFor(file: string): string {
  if (file.endsWith('.html')) return 'text/html';
  if (file.endsWith('.js')) return 'text/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.woff2')) return 'font/woff2';
  if (file.endsWith('.woff')) return 'font/woff';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

test.beforeAll(async () => {
  expect(fs.existsSync(SIDECAR_DIST), 'sidecar/dist missing: run pnpm build:sidecar').toBeTruthy();
  expect(
    fs.existsSync(FRONTEND_DIST),
    'frontend/dist missing: run pnpm build:frontend',
  ).toBeTruthy();

  // 1) sidecar
  sidecar = spawn('node', [SIDECAR_DIST], {
    env: { ...process.env, SIDCAR_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  sidecarPort = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sidecar ready timeout')), 30_000);
    sidecar?.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        try {
          const parsed = JSON.parse(line) as { event: string; port: number };
          if (parsed.event === 'ready') {
            clearTimeout(timer);
            resolve(parsed.port);
          }
        } catch {
          // non-json output
        }
      }
    });
    sidecar?.on('exit', (code) => reject(new Error(`sidecar exited early with code ${code}`)));
  });

  // 2) static server for the built frontend
  staticServer = http.createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    const filePath = path.join(FRONTEND_DIST, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(FRONTEND_DIST) || !fs.existsSync(filePath)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': mimeFor(filePath) });
    res.end(fs.readFileSync(filePath));
  });
  await new Promise<void>((resolve) => staticServer?.listen(UI_PORT, '127.0.0.1', resolve));
});

test('edits a block in Monaco, autosaves, and runs the edited code', async ({ page }) => {
  // Use a copy of the fixture so the shared one stays untouched.
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-e2e-'));
  const copyPath = path.join(dir, 'copy.deepnote');
  fs.copyFileSync(FIXTURE, copyPath);

  const url = `http://127.0.0.1:${UI_PORT}/?sidecar=http://127.0.0.1:${sidecarPort}&token=${TOKEN}&project=${encodeURIComponent(copyPath)}`;
  await page.goto(url);
  await expect(page.getByText('Hello World')).toBeVisible({ timeout: 30_000 });

  // The second code block renders Monaco; replace its content.
  const editors = page.locator('.monaco-editor');
  await expect(editors.first()).toBeVisible({ timeout: 30_000 });
  await editors.nth(1).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('print("edited in e2e")');

  // The sidecar persists the edit (debounced) and pushes project:updated;
  // the header goes back to "saved" and the file on disk changes.
  await expect(page.getByText('saved')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => fs.readFileSync(copyPath, 'utf8'), { timeout: 30_000 })
    .toContain('edited in e2e');

  // Run only the edited block via its toolbar button.
  await page.getByRole('button', { name: 'Run block' }).nth(1).click();
  await expect(page.getByText('edited in e2e').last()).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/Last run: 1\/1 blocks, 0 failed/)).toBeVisible({ timeout: 60_000 });

  fs.rmSync(dir, { recursive: true, force: true });
});

test('opens the command palette with ctrl+P', async ({ page }) => {
  const url = `http://127.0.0.1:${UI_PORT}/?sidecar=http://127.0.0.1:${sidecarPort}&token=${TOKEN}&project=${encodeURIComponent(FIXTURE)}`;
  await page.goto(url);
  await expect(page.getByText('Hello World')).toBeVisible({ timeout: 30_000 });

  await page.keyboard.press('Control+p');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText('Run notebook')).toBeVisible();
  await expect(dialog.getByText('New code block')).toBeVisible();
  await page.keyboard.press('Escape');
});

test.afterAll(async () => {
  staticServer?.close();
  sidecar?.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  sidecar?.kill('SIGKILL');
});

test('opens a project and runs the notebook with streamed outputs', async ({ page }) => {
  const url = `http://127.0.0.1:${UI_PORT}/?sidecar=http://127.0.0.1:${sidecarPort}&token=${TOKEN}&project=${encodeURIComponent(FIXTURE)}`;
  await page.goto(url);

  await expect(page.getByText('Hello World')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('hello from deepnote-desktop')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Run notebook' }).click();

  await expect(page.getByText('42')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/Last run: 2\/2 blocks, 0 failed/)).toBeVisible({ timeout: 60_000 });

  const summary = page.getByText(/Last run: 2\/2 blocks, 0 failed/);
  await expect(summary).toBeVisible();
});
