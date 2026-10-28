/** Unit tests for the cloud wrapper: fetch is stubbed, no real network. */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CLOUD_TOKEN_ENV,
  cloudToken,
  fetchCloudStatus,
  runNotebookInCloud,
} from '../core/cloud.js';

const TOKEN = 'test-token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloud wrapper', () => {
  it('reports unconfigured when no token is available', async () => {
    const status = await fetchCloudStatus({ env: {} });
    expect(status.configured).toBe(false);
    expect(status.workspace).toBeUndefined();
  });

  it('reads the token from the environment (keychain hydration path)', () => {
    expect(cloudToken({ [CLOUD_TOKEN_ENV]: 'abc' })).toBe('abc');
    expect(cloudToken({})).toBeUndefined();
  });

  it('resolves the workspace with a valid token', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ workspace: { id: 't1', name: 'Stuko', slug: 'stuko-2212' } }),
    );
    const status = await fetchCloudStatus({
      env: { [CLOUD_TOKEN_ENV]: TOKEN },
      fetchFn: fetchFn as never,
    });
    expect(status.configured).toBe(true);
    expect(status.workspace?.name).toBe('Stuko');
  });

  it('surfaces auth failures without throwing', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ message: 'Bad credentials' }, 401));
    vi.stubGlobal('fetch', fetchFn);
    const status = await fetchCloudStatus({ env: { [CLOUD_TOKEN_ENV]: TOKEN } });
    expect(status.configured).toBe(true);
    expect(status.error).toBeTruthy();
  });

  it('triggers a run, polls to success, and fetches the snapshot', async () => {
    const calls: string[] = [];
    let runGets = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'POST' && url.endsWith('/v2/runs')) {
        return jsonResponse({ id: 'run-1', status: 'pending' });
      }
      if (url.includes('/v2/runs/run-1')) {
        runGets += 1;
        // First poll still running, second one terminal.
        return jsonResponse({ id: 'run-1', status: runGets === 1 ? 'running' : 'success' });
      }
      if (url.includes('/snapshot')) return jsonResponse({ ok: true });
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchFn);

    const result = await runNotebookInCloud('nb-1', {
      env: { [CLOUD_TOKEN_ENV]: TOKEN },
      pollIntervalMs: 20,
    });
    expect(result.runId).toBe('run-1');
    expect(result.success).toBe(true);
    expect(calls.some((c) => c.startsWith('POST') && c.includes('/v2/runs'))).toBe(true);
  });

  it('fails cleanly without a token', async () => {
    const result = await runNotebookInCloud('nb-1', { env: {} });
    expect(result.success).toBe(false);
    expect(result.status).toBe('unconfigured');
    expect(result.error).toContain(CLOUD_TOKEN_ENV);
  });
});
