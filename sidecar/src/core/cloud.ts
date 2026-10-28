/**
 * Cloud mode (phase 5): thin wrapper over the official @deepnote/cloud client.
 *
 * The token is never read from disk: it arrives through the secrets path
 * (session memory / OS keychain) or DEEPNOTE_TOKEN in the environment. All
 * network calls go through the injected `fetchFn`, which is what the unit
 * tests stub — no test ever touches the real API.
 */

import {
  describeRunError,
  getWorkspace,
  isSuccessStatus,
  pollRunUntilComplete,
  triggerNotebookRun,
  waitForRunSnapshot,
} from '@deepnote/cloud';

export const CLOUD_TOKEN_ENV = 'DEEPNOTE_TOKEN';
export const DEFAULT_CLOUD_URL = 'https://deepnote.com';

export interface CloudStatus {
  configured: boolean;
  baseUrl: string;
  workspace?: { name: string; slug?: string };
  error?: string;
}

export interface CloudRunResult {
  runId: string;
  status: string;
  success: boolean;
  error?: string;
  snapshotSaved?: boolean;
}

type FetchFn = typeof fetch;

/** Run `fn` with an optional fetch override installed (unit tests stub it). */
async function withFetch<T>(fetchFn: FetchFn | undefined, fn: () => Promise<T>): Promise<T> {
  if (!fetchFn) return fn();
  const original = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

export function cloudBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env.DEEPNOTE_CLOUD_URL || DEFAULT_CLOUD_URL;
}

export function cloudToken(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env[CLOUD_TOKEN_ENV] || undefined;
}

/** Verify the token by resolving the current workspace. */
export async function fetchCloudStatus(options?: {
  env?: Record<string, string | undefined>;
  fetchFn?: FetchFn;
}): Promise<CloudStatus> {
  const env = options?.env ?? process.env;
  const baseUrl = cloudBaseUrl(env);
  const token = cloudToken(env);
  if (!token) return { configured: false, baseUrl };
  try {
    const workspace = await withFetch(options?.fetchFn, () =>
      getWorkspace(baseUrl, token, { requestTimeoutMs: 15_000 }),
    );
    if (!workspace)
      return { configured: true, baseUrl, error: 'workspace not found for this token' };
    return {
      configured: true,
      baseUrl,
      workspace: {
        name: workspace.name ?? '(unnamed workspace)',
        slug: workspace.slug ?? undefined,
      },
    };
  } catch (error) {
    return {
      configured: true,
      baseUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Trigger a cloud run of one notebook and wait for its terminal state. */
export async function runNotebookInCloud(
  notebookId: string,
  options?: {
    env?: Record<string, string | undefined>;
    fetchFn?: FetchFn;
    onStatus?: (status: string) => void;
    /** Poll cadence; tests use a short interval. */
    pollIntervalMs?: number;
  },
): Promise<CloudRunResult> {
  const env = options?.env ?? process.env;
  const baseUrl = cloudBaseUrl(env);
  const token = cloudToken(env);
  if (!token) {
    return {
      runId: '',
      status: 'unconfigured',
      success: false,
      error: `missing ${CLOUD_TOKEN_ENV}`,
    };
  }

  try {
    const run = await withFetch(options?.fetchFn, () =>
      triggerNotebookRun(baseUrl, token, { notebookId }),
    );
    options?.onStatus?.(run.status ?? 'pending');
    const settled = await withFetch(options?.fetchFn, () =>
      pollRunUntilComplete(baseUrl, token, run.runId, {
        timeoutMs: 5 * 60_000,
        intervalMs: options?.pollIntervalMs ?? 2_000,
      } as never),
    );
    options?.onStatus?.(settled.status);
    let snapshotSaved = false;
    if (isSuccessStatus(settled.status)) {
      try {
        const snapshot = await withFetch(options?.fetchFn, () =>
          waitForRunSnapshot(baseUrl, token, settled, {
            attempts: 3,
            intervalMs: options?.pollIntervalMs ?? 1_000,
          } as never),
        );
        snapshotSaved = snapshot !== null;
      } catch {
        snapshotSaved = false;
      }
    }
    const success = isSuccessStatus(settled.status);
    return {
      runId: settled.runId,
      status: settled.status,
      success,
      error: success ? undefined : describeRunError(settled),
      snapshotSaved,
    };
  } catch (error) {
    return {
      runId: '',
      status: 'error',
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // withFetch restores any override per call; nothing to undo here.
  }
}
