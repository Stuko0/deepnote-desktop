/**
 * Session manager: owns the open project and the execution engine.
 *
 * The engine (and with it the Jupyter server + kernel) is started on first use
 * and kept warm across runs, unlike upstream `runWithInputs` which starts and
 * kills the server per run. This is what makes sub-second re-runs possible.
 */

import { saveExecutionSnapshot } from '@deepnote/convert';
import type { BlockExecutionOutput } from '@deepnote/convert';
import {
  ExecutionEngine,
  TOOLKIT_INSTALL_HINT,
  failureCategoryOf,
  hasDeepnoteToolkit,
  isRuntimeError,
  resolveProjectPython,
} from '@deepnote/runtime-core';

import { type LoadedProject, loadProject } from './project.js';
import type { KernelState, ServerMessage } from './protocol.js';

export type Emit = (message: ServerMessage) => void;

export class SessionManager {
  private project: LoadedProject | null = null;
  private engine: ExecutionEngine | null = null;
  private kernelState: KernelState = 'stopped';
  private running = false;
  private abort: AbortController | null = null;

  constructor(private readonly emit: Emit) {}

  get isOpen(): boolean {
    return this.project !== null;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private setKernelState(state: KernelState, detail?: string): void {
    this.kernelState = state;
    this.emit({ v: 1, type: 'kernel:state', payload: { state, detail } });
  }

  async open(filePath: string): Promise<void> {
    await this.close();
    this.project = await loadProject(filePath);
    this.emit({ v: 1, type: 'project:data', payload: { project: this.project.model } });
  }

  currentProject(): LoadedProject | null {
    return this.project;
  }

  /** Start (or reuse) the engine for the open project. Throws with a clear hint when the toolkit is missing. */
  private async ensureEngine(): Promise<ExecutionEngine> {
    if (this.engine) return this.engine;
    if (!this.project) throw new Error('no project is open');

    const resolved = await resolveProjectPython({
      projectId: this.project.model.id,
      searchDirs: [this.project.workingDirectory],
    });

    const toolkitInstalled = await hasDeepnoteToolkit(resolved.pythonPath).catch(() => false);
    if (!toolkitInstalled) {
      const detail = `${resolved.pythonPath} has no deepnote-toolkit server. ${TOOLKIT_INSTALL_HINT}`;
      this.setKernelState('error', detail);
      throw new Error(detail);
    }

    this.setKernelState('starting');
    const engine = new ExecutionEngine({
      pythonEnv: resolved.pythonPath,
      workingDirectory: this.project.workingDirectory,
      env: { DEEPNOTE_RUNTIME__RUNNING_IN_DETACHED_MODE: 'true' },
    });
    await engine.start();
    this.engine = engine;
    this.setKernelState('ready');
    return engine;
  }

  /**
   * Run the open project (optionally a single notebook / block set).
   * Events are streamed through `emit`; a snapshot with outputs is saved at the end.
   */
  async run(options: { notebookId?: string; blockIds?: string[] } = {}): Promise<void> {
    if (!this.project) throw new Error('no project is open');
    if (this.running) throw new Error('a run is already in progress');

    const engine = await this.ensureEngine();
    const project = this.project;
    const notebookName = options.notebookId
      ? project.file.project.notebooks.find((n) => n.id === options.notebookId)?.name
      : undefined;
    if (options.notebookId && !notebookName) {
      throw new Error(`notebook ${options.notebookId} not found in project`);
    }

    this.running = true;
    this.abort = new AbortController();
    const startedAt = new Date().toISOString();
    const collected = new Map<string, BlockExecutionOutput>();

    try {
      this.setKernelState('running');
      const summary = await engine.runProject(project.file, {
        notebookName,
        blockIds: options.blockIds,
        signal: this.abort.signal,
        onServerStarting: () => this.setKernelState('starting'),
        onServerReady: () => this.setKernelState('running'),
        onBlockStart: (block, index, total) => {
          this.emit({
            v: 1,
            type: 'exec:block-start',
            payload: { blockId: block.id, index, total },
          });
          this.emit({ v: 1, type: 'exec:started', payload: { totalBlocks: total } });
        },
        onOutput: (blockId, output) => {
          this.emit({ v: 1, type: 'exec:output', payload: { blockId, output } });
        },
        onBlockDone: (result) => {
          const existing = collected.get(result.blockId);
          const outputs = existing ? [...existing.outputs, ...result.outputs] : [...result.outputs];
          collected.set(result.blockId, {
            id: result.blockId,
            outputs,
            executionCount: result.executionCount,
          });
          this.emit({
            v: 1,
            type: 'exec:block-done',
            payload: {
              blockId: result.blockId,
              success: result.success,
              executionCount: result.executionCount,
              durationMs: result.durationMs,
            },
          });
        },
      });

      const finishedAt = new Date().toISOString();
      let snapshotPath: string | undefined;
      if (collected.size > 0) {
        try {
          const saved = await saveExecutionSnapshot(
            project.filePath,
            project.file,
            [...collected.values()],
            {
              startedAt,
              finishedAt,
            },
          );
          snapshotPath = saved.snapshotPath;
        } catch (error) {
          this.emit({
            v: 1,
            type: 'log',
            payload: {
              level: 'warn',
              message: `snapshot could not be saved: ${error instanceof Error ? error.message : String(error)}`,
            },
          });
        }
      }

      this.emit({ v: 1, type: 'exec:done', payload: { summary, snapshotPath } });
      this.setKernelState('ready');
    } catch (error) {
      const category = failureCategoryOf(error);
      this.emit({
        v: 1,
        type: 'exec:error',
        payload: {
          message: error instanceof Error ? error.message : String(error),
          category,
        },
      });
      this.setKernelState(isRuntimeError(error) ? 'error' : 'ready');
    } finally {
      this.running = false;
      this.abort = null;
    }
  }

  /** Abort the current run and stop the kernel. The next run restarts the engine. */
  async stop(): Promise<void> {
    this.abort?.abort();
    await this.stopEngine('stopped by user');
  }

  async restartKernel(): Promise<void> {
    await this.stopEngine('restarting kernel');
    if (this.project) await this.ensureEngine();
  }

  private async stopEngine(detail: string): Promise<void> {
    this.abort?.abort();
    const engine = this.engine;
    this.engine = null;
    this.running = false;
    if (engine) {
      await engine.stop().catch(() => undefined);
    }
    this.setKernelState('stopped', detail);
  }

  async close(): Promise<void> {
    await this.stopEngine('project closed');
    this.project = null;
  }
}
