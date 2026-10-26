import { create } from 'zustand';

import type { BlockModel, IOutput, KernelState, ProjectModel } from './protocol';
import type { ServerMessage } from './protocol';
import { type SidecarConnection, connectSidecar } from './ws';

export interface BlockRuntimeState {
  running: boolean;
  queued?: boolean;
  success?: boolean;
  durationMs?: number;
  outputs: IOutput[];
}

interface AppState {
  connection: 'connecting' | 'online' | 'offline';
  project: ProjectModel | null;
  selectedNotebookId: string | null;
  kernelState: KernelState;
  kernelDetail?: string;
  blockState: Record<string, BlockRuntimeState>;
  lastSummary: string | null;
  error: string | null;

  init: (url: string, token: string) => void;
  openProject: (path: string) => void;
  runNotebook: (notebookId?: string) => void;
  stopRun: () => void;
  restartKernel: () => void;
  selectNotebook: (id: string) => void;
}

let connection: SidecarConnection | null = null;

function reduceMessage(state: AppState, message: ServerMessage): Partial<AppState> | null {
  switch (message.type) {
    case 'project:data':
      return {
        project: message.payload.project,
        selectedNotebookId: message.payload.project?.notebooks[0]?.id ?? null,
        blockState: Object.fromEntries(
          (message.payload.project?.notebooks ?? []).flatMap((nb) =>
            nb.blocks.map((b: BlockModel): [string, BlockRuntimeState] => [
              b.id,
              { running: false, outputs: b.outputs },
            ]),
          ),
        ),
      };
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
      const s = message.payload.summary;
      return {
        lastSummary: `${s.executedBlocks}/${s.totalBlocks} blocks, ${s.failedBlocks} failed, ${s.totalDurationMs} ms`,
      };
    }
    case 'exec:error':
      return { error: message.payload.message };
    default:
      return null;
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  connection: 'connecting',
  project: null,
  selectedNotebookId: null,
  kernelState: 'stopped',
  blockState: {},
  lastSummary: null,
  error: null,

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
    connection?.send('exec:run', notebookId ? { notebookId } : {});
  },

  stopRun(): void {
    connection?.send('exec:stop');
  },

  restartKernel(): void {
    connection?.send('kernel:restart');
  },

  selectNotebook(id: string): void {
    set({ selectedNotebookId: id });
  },
}));
