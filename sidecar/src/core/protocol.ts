/**
 * Versioned local protocol (v1) between the UI and the sidecar.
 *
 * Transport: WebSocket at /ws (token required). Every message carries `v`
 * (protocol version). Client messages carry an `id` used to correlate replies.
 */

import type { ExecutionSummary, IOutput } from '@deepnote/runtime-core';

export const PROTOCOL_VERSION = 1 as const;

export type KernelState = 'stopped' | 'starting' | 'ready' | 'running' | 'error';

export interface BlockModel {
  id: string;
  type: string;
  content: string;
  sortingKey: string;
  blockGroup?: string;
  variableName?: string;
  metadata: Record<string, unknown>;
  outputs: IOutput[];
  executionCount: number | null;
  isExecutable: boolean;
}

export interface NotebookModel {
  id: string;
  name: string;
  executionMode: 'block' | 'downstream';
  blocks: BlockModel[];
}

export interface ProjectModel {
  path: string;
  id: string;
  name: string;
  notebooks: NotebookModel[];
  snapshotPath: string | null;
  python: { path: string; source: string; warnings: string[]; toolkitInstalled: boolean };
}

export type ClientMessage =
  | { v: typeof PROTOCOL_VERSION; id: string; type: 'project:open'; payload: { path: string } }
  | { v: typeof PROTOCOL_VERSION; id: string; type: 'project:close' }
  | {
      v: typeof PROTOCOL_VERSION;
      id: string;
      type: 'exec:run';
      payload: { notebookId?: string; blockIds?: string[] };
    }
  | { v: typeof PROTOCOL_VERSION; id: string; type: 'exec:stop' }
  | { v: typeof PROTOCOL_VERSION; id: string; type: 'kernel:restart' }
  | { v: typeof PROTOCOL_VERSION; id: string; type: 'project:get' };

export type ServerMessage =
  | {
      v: typeof PROTOCOL_VERSION;
      id?: string;
      type: 'project:data';
      payload: { project: ProjectModel | null };
    }
  | {
      v: typeof PROTOCOL_VERSION;
      id?: string;
      type: 'project:error';
      payload: { message: string; kind?: string };
    }
  | { v: typeof PROTOCOL_VERSION; id?: string; type: 'ack'; payload: { for: string; ok: true } }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'kernel:state';
      payload: { state: KernelState; detail?: string };
    }
  | { v: typeof PROTOCOL_VERSION; type: 'exec:started'; payload: { totalBlocks: number } }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'exec:block-start';
      payload: { blockId: string; index: number; total: number };
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'exec:output';
      payload: { blockId: string; output: IOutput };
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'exec:block-done';
      payload: {
        blockId: string;
        success: boolean;
        executionCount: number | null;
        durationMs: number;
      };
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'exec:done';
      payload: { summary: ExecutionSummary; snapshotPath?: string };
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'exec:error';
      payload: { message: string; category?: string };
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'log';
      payload: { level: 'info' | 'warn' | 'error'; message: string };
    };

const CLIENT_TYPES = new Set([
  'project:open',
  'project:close',
  'project:get',
  'exec:run',
  'exec:stop',
  'kernel:restart',
]);

/** Parse and validate a raw client frame. Returns null when the frame is invalid. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const msg = parsed as Record<string, unknown>;
  if (msg.v !== PROTOCOL_VERSION) return null;
  if (typeof msg.type !== 'string' || !CLIENT_TYPES.has(msg.type)) return null;
  if (typeof msg.id !== 'string' || msg.id.length === 0) return null;
  if (msg.payload !== undefined && typeof msg.payload !== 'object') return null;
  return msg as unknown as ClientMessage;
}
