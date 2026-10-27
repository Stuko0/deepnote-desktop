import { create } from 'zustand';

import type {
  DagModel,
  ExecutionMode,
  ExecutionSummary,
  FileEntryModel,
  IOutput,
  IntegrationStatusModel,
  KernelState,
  NewBlockKind,
  ProjectModel,
  ServerMessage,
} from './protocol';
import { type SidecarConnection, connectSidecar } from './ws';

export interface BlockRuntimeState {
  running: boolean;
  success?: boolean;
  durationMs?: number;
  outputs: IOutput[];
}

interface AppState {
  connection: 'connecting' | 'online' | 'offline';
  project: ProjectModel | null;
  selectedNotebookId: string | null;
  selectedBlockId: string | null;
  kernelState: KernelState;
  kernelDetail?: string;
  blockState: Record<string, BlockRuntimeState>;
  lastSummary: string | null;
  error: string | null;
  execMode: ExecutionMode;
  dag: DagModel | null;
  fs: { subpath: string; entries: FileEntryModel[] } | null;
  integrations: IntegrationStatusModel[];
  paletteOpen: boolean;
  saveState: 'saved' | 'saving' | 'error';

  init: (url: string, token: string) => void;
  openProject: (path: string) => void;
  runNotebook: (notebookId?: string) => void;
  runBlocks: (blockIds: string[]) => void;
  stopRun: () => void;
  restartKernel: () => void;
  selectNotebook: (id: string) => void;
  selectBlock: (id: string | null) => void;
  setExecMode: (mode: ExecutionMode) => void;
  setPaletteOpen: (open: boolean) => void;

  editBlock: (blockId: string, content: string) => void;
  updateBlockMetadata: (blockId: string, metadata: Record<string, unknown>) => void;
  createBlock: (afterBlockId: string | null, blockType: NewBlockKind) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;

  refreshDag: () => void;
  refreshFs: (subpath?: string) => void;
  refreshIntegrations: () => void;
}

let connection: SidecarConnection | null = null;

// Pending edits per block, flushed after a debounce (autosave).
const editTimers = new Map<string, ReturnType<typeof setTimeout>>();
const EDIT_DEBOUNCE_MS = 1500;

function reduceMessage(state: AppState, message: ServerMessage): Partial<AppState> | null {
  switch (message.type) {
    case 'project:data':
      return {
        project: message.payload.project,
        selectedNotebookId: message.payload.project?.notebooks[0]?.id ?? null,
        blockState: Object.fromEntries(
          (message.payload.project?.notebooks ?? []).flatMap((nb) =>
            nb.blocks.map((b): [string, BlockRuntimeState] => [
              b.id,
              { running: false, outputs: b.outputs },
            ]),
          ),
        ),
      };
    case 'project:updated': {
      const project = message.payload.project;
      // Keep live outputs for blocks that already ran in this session.
      const blockState = { ...state.blockState };
      for (const nb of project.notebooks) {
        for (const b of nb.blocks) {
          const existing = blockState[b.id];
          if (!existing) blockState[b.id] = { running: false, outputs: b.outputs };
          else if (b.outputs.length > 0 && existing.outputs.length === 0) {
            blockState[b.id] = { ...existing, outputs: b.outputs };
          }
        }
      }
      return { project, blockState };
    }
    case 'project:error':
      return { error: message.payload.message };
    case 'kernel:state':
      return { kernelState: message.payload.state, kernelDetail: message.payload.detail };
    case 'exec:block-start': {
      const { blockId } = message.payload;
      return {
        blockState: {
          ...state.blockState,
          [blockId]: { ...state.blockState[blockId], running: true, outputs: [] },
        },
      };
    }
    case 'exec:output': {
      const { blockId, output } = message.payload;
      const current = state.blockState[blockId] ?? { running: false, outputs: [] };
      return {
        blockState: {
          ...state.blockState,
          [blockId]: { ...current, outputs: [...current.outputs, output] },
        },
      };
    }
    case 'exec:block-done': {
      const { blockId, success, durationMs } = message.payload;
      const current = state.blockState[blockId] ?? { running: false, outputs: [] };
      return {
        blockState: {
          ...state.blockState,
          [blockId]: { ...current, running: false, success, durationMs },
        },
      };
    }
    case 'exec:done': {
      const s: ExecutionSummary = message.payload.summary;
      return {
        lastSummary: `${s.executedBlocks}/${s.totalBlocks} blocks, ${s.failedBlocks} failed, ${s.totalDurationMs} ms`,
      };
    }
    case 'exec:error':
      return { error: message.payload.message };
    case 'dag:data':
      return message.payload.dag
        ? { dag: message.payload.dag }
        : { error: message.payload.error ?? null };
    case 'fs:data':
      return { fs: { subpath: message.payload.subpath, entries: message.payload.entries } };
    case 'integrations:data':
      return { integrations: message.payload.integrations };
    default:
      return null;
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  connection: 'connecting',
  project: null,
  selectedNotebookId: null,
  selectedBlockId: null,
  kernelState: 'stopped',
  blockState: {},
  lastSummary: null,
  error: null,
  execMode: 'block',
  dag: null,
  fs: null,
  integrations: [],
  paletteOpen: false,
  saveState: 'saved',

  init(url: string, token: string): void {
    connection = connectSidecar(url, token);
    connection.onStatus((connected) => set({ connection: connected ? 'online' : 'offline' }));
    connection.onMessage((message) => {
      const patch = reduceMessage(get(), message);
      if (patch) set(patch);
    });
    connection.send('project:get');
  },

  openProject(path: string): void {
    connection?.send('project:open', { path });
  },

  runNotebook(notebookId?: string): void {
    set({ error: null });
    connection?.send('exec:run', {
      notebookId,
      mode: get().execMode,
      inputs: collectInputs(get().project),
    });
  },

  runBlocks(blockIds: string[]): void {
    set({ error: null });
    connection?.send('exec:run', {
      notebookId: get().selectedNotebookId ?? undefined,
      blockIds,
      mode: get().execMode,
      inputs: collectInputs(get().project),
    });
  },

  stopRun(): void {
    connection?.send('exec:stop');
  },

  restartKernel(): void {
    connection?.send('kernel:restart');
  },

  selectNotebook(id: string): void {
    set({ selectedNotebookId: id, dag: null });
  },

  selectBlock(id: string | null): void {
    set({ selectedBlockId: id });
    if (id) get().refreshDag();
  },

  setExecMode(mode: ExecutionMode): void {
    set({ execMode: mode });
  },

  setPaletteOpen(open: boolean): void {
    set({ paletteOpen: open });
  },

  editBlock(blockId: string, content: string): void {
    // Optimistic local update; the sidecar is the single writer of the file.
    const project = get().project;
    if (!project) return;
    const notebooks = project.notebooks.map((nb) => ({
      ...nb,
      blocks: nb.blocks.map((b) => (b.id === blockId ? { ...b, content } : b)),
    }));
    set({ project: { ...project, notebooks }, saveState: 'saving' });

    const pending = editTimers.get(blockId);
    if (pending) clearTimeout(pending);
    editTimers.set(
      blockId,
      setTimeout(() => {
        editTimers.delete(blockId);
        connection?.send('block:update', { blockId, content });
        set({ saveState: 'saved' });
      }, EDIT_DEBOUNCE_MS),
    );
  },

  updateBlockMetadata(blockId: string, metadata: Record<string, unknown>): void {
    const project = get().project;
    if (!project) return;
    const notebooks = project.notebooks.map((nb) => ({
      ...nb,
      blocks: nb.blocks.map((b) =>
        b.id === blockId ? { ...b, metadata: { ...b.metadata, ...metadata } } : b,
      ),
    }));
    set({ project: { ...project, notebooks } });
    connection?.send('block:update', { blockId, metadata });
  },

  createBlock(afterBlockId: string | null, blockType: NewBlockKind): void {
    const notebookId = get().selectedNotebookId;
    if (!notebookId) return;
    connection?.send('block:create', { notebookId, afterBlockId, blockType });
  },

  deleteBlock(blockId: string): void {
    connection?.send('block:delete', { blockId });
  },

  moveBlock(blockId: string, direction: 'up' | 'down'): void {
    connection?.send('block:move', { blockId, direction });
  },

  refreshDag(): void {
    const notebookId = get().selectedNotebookId;
    if (!notebookId) return;
    connection?.send('dag:get', { notebookId });
  },

  refreshFs(subpath?: string): void {
    connection?.send('fs:list', { subpath: subpath ?? '' });
  },

  refreshIntegrations(): void {
    connection?.send('integrations:get');
  },
}));

/** Values collected from input-* blocks, sent with every run. */
export function collectInputs(project: ProjectModel | null): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (!project) return values;
  for (const nb of project.notebooks) {
    for (const block of nb.blocks) {
      if (block.type.startsWith('input-') && block.variableName) {
        values[block.variableName] = inputBlockValue(block);
      }
    }
  }
  return values;
}

export function inputBlockValue(block: {
  type: string;
  content: string;
  metadata: Record<string, unknown>;
}): unknown {
  const meta = block.metadata as { deepnote_variable_value?: unknown };
  return meta.deepnote_variable_value ?? defaultValueFor(block.type, block.content);
}

function defaultValueFor(type: string, content: string): unknown {
  switch (type) {
    case 'input-checkbox':
      return false;
    case 'input-slider':
      return 0;
    case 'input-select':
      return content.split(',')[0]?.trim();
    case 'input-date-range':
      return { start: null, end: null };
    default:
      return '';
  }
}
