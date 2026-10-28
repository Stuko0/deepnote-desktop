/** Types mirroring the sidecar protocol v1 (sidecar/src/core/protocol.ts). */

export interface IOutput {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error';
  name?: 'stdout' | 'stderr';
  text?: string;
  data?: Record<string, unknown>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

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

export type KernelState = 'stopped' | 'starting' | 'ready' | 'running' | 'error';

export interface ExecutionSummary {
  totalBlocks: number;
  executedBlocks: number;
  failedBlocks: number;
  totalDurationMs: number;
  failureCategory?: string;
}

export type ExecutionMode = 'block' | 'downstream';

export type NewBlockKind =
  | 'code'
  | 'sql'
  | 'agent'
  | 'markdown'
  | 'input-text'
  | 'input-textarea'
  | 'input-checkbox'
  | 'input-select'
  | 'input-slider'
  | 'input-date'
  | 'input-date-range'
  | 'input-file';

export interface DagModel {
  edges: Array<{ from: string; to: string }>;
  upstream: Record<string, string[]>;
  downstream: Record<string, string[]>;
}

export interface FileEntryModel {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

export interface IntegrationStatusModel {
  id: string;
  name: string;
  type: string;
  envVar: string;
  configured: boolean;
}

export type ServerMessage =
  | { v: 1; id?: string; type: 'project:data'; payload: { project: ProjectModel | null } }
  | { v: 1; id?: string; type: 'project:updated'; payload: { project: ProjectModel } }
  | {
      v: 1;
      id?: string;
      type: 'dag:data';
      payload: { notebookId: string; dag: DagModel | null; error?: string };
    }
  | { v: 1; id?: string; type: 'fs:data'; payload: { subpath: string; entries: FileEntryModel[] } }
  | {
      v: 1;
      id?: string;
      type: 'integrations:data';
      payload: { integrations: IntegrationStatusModel[] };
    }
  | { v: 1; id?: string; type: 'terminals:data'; payload: { terminals: string[] } }
  | {
      v: 1;
      id?: string;
      type: 'cloud:data';
      payload: {
        kind: 'status' | 'run';
        configured?: boolean;
        baseUrl?: string;
        workspace?: { name: string; slug?: string };
        error?: string;
        run?: {
          runId: string;
          status: string;
          success: boolean;
          error?: string;
          snapshotSaved?: boolean;
        };
        log?: string;
      };
    }
  | { v: 1; id?: string; type: 'project:error'; payload: { message: string; kind?: string } }
  | { v: 1; id?: string; type: 'ack'; payload: { for: string; ok: true } }
  | { v: 1; type: 'kernel:state'; payload: { state: KernelState; detail?: string } }
  | { v: 1; type: 'exec:started'; payload: { totalBlocks: number } }
  | { v: 1; type: 'exec:block-start'; payload: { blockId: string; index: number; total: number } }
  | { v: 1; type: 'exec:output'; payload: { blockId: string; output: IOutput } }
  | {
      v: 1;
      type: 'exec:block-done';
      payload: {
        blockId: string;
        success: boolean;
        executionCount: number | null;
        durationMs: number;
      };
    }
  | { v: 1; type: 'exec:done'; payload: { summary: ExecutionSummary; snapshotPath?: string } }
  | { v: 1; type: 'exec:error'; payload: { message: string; category?: string } }
  | {
      v: 1;
      type: 'agent:event';
      payload: {
        event:
          | { type: 'text_delta'; text: string }
          | { type: 'reasoning_delta'; text: string }
          | { type: 'tool_called'; toolName: string }
          | { type: 'tool_output'; toolName: string; output: string };
      };
    }
  | { v: 1; type: 'log'; payload: { level: 'info' | 'warn' | 'error'; message: string } };
