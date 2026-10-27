/**
 * Session manager: owns the open project and the execution engine.
 *
 * The engine (and with it the Jupyter server + kernel) is started on first
 * use and kept warm across runs, unlike upstream `runWithInputs` which
 * starts and kills the server per run. Notebook mutations (Fase 2) are
 * applied to the parsed file and persisted to disk immediately; the UI
 * debounces its own edits, the sidecar is the single writer of the file.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { serializeDeepnoteFile } from '@deepnote/blocks';
import type { DeepnoteFile } from '@deepnote/blocks';
import { saveExecutionSnapshot } from '@deepnote/convert';
import type { BlockExecutionOutput } from '@deepnote/convert';
import { getDagForBlocks } from '@deepnote/reactivity';
import {
  ExecutionEngine,
  TOOLKIT_INSTALL_HINT,
  failureCategoryOf,
  hasDeepnoteToolkit,
  isRuntimeError,
  resolveProjectPython,
} from '@deepnote/runtime-core';

import {
  type NewBlockType,
  createBlockAfter,
  defaultContentFor,
  deleteBlock,
  moveBlock,
  updateBlockContent,
} from './notebook-mutations.js';
import { type LoadedProject, loadProject } from './project.js';
import type {
  DagModel,
  ExecutionMode,
  FileEntryModel,
  IntegrationStatusModel,
  KernelState,
  ServerMessage,
} from './protocol.js';

export type Emit = (message: ServerMessage) => void;

export interface RunOptions {
  notebookId?: string;
  blockIds?: string[];
  mode?: ExecutionMode;
  inputs?: Record<string, unknown>;
}

export class SessionManager {
  private project: LoadedProject | null = null;
  private engine: ExecutionEngine | null = null;
  private kernelState: KernelState = 'stopped';
  private running = false;
  private abort: AbortController | null = null;
  /** Integration secrets (env vars) held in memory for the next engine start. */
  private secrets = new Map<string, string>();

  /** Environment for cloud calls: session secrets take precedence over process env. */
  cloudEnv(): Record<string, string | undefined> {
    return { ...process.env, ...Object.fromEntries(this.secrets) };
  }

  constructor(private readonly emit: Emit) {}

  get isOpen(): boolean {
    return this.project !== null;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get state(): KernelState {
    return this.kernelState;
  }

  private setKernelState(state: KernelState, detail?: string): void {
    this.kernelState = state;
    this.emit({ v: 1, type: 'kernel:state', payload: { state, detail } });
  }

  private currentFile(): DeepnoteFile {
    if (!this.project) throw new Error('no project is open');
    return this.project.file;
  }

  async open(filePath: string): Promise<void> {
    const absolute = path.resolve(filePath);
    // Re-opening the current project must not blank the session: any command
    // arriving during a reload would otherwise fail with "no project is open".
    if (this.project?.filePath === absolute) {
      this.emit({ v: 1, type: 'project:data', payload: { project: this.project.model } });
      return;
    }
    // Load the incoming project first; only then swap and stop the engine.
    const loaded = await loadProject(absolute);
    await this.stopEngine('project switched');
    this.project = loaded;
    this.emit({ v: 1, type: 'project:data', payload: { project: this.project.model } });
    // Warm the DAG cache in the background: the analyzer spawns python per
    // call, so opening the graph later should be a cache hit.
    void this.prewarmDag();
  }

  /** Best-effort background DAG analysis for every notebook of the open project. */
  private prewarmDag(): void {
    const project = this.project;
    if (!project) return;
    for (const notebook of project.file.project.notebooks) {
      void this.getDag(notebook.id).catch((error: unknown) => {
        this.emit({
          v: 1,
          type: 'log',
          payload: {
            level: 'warn',
            message: `dag prewarm failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        });
      });
    }
  }

  currentProject(): LoadedProject | null {
    return this.project;
  }

  /** Serialize the in-memory file to disk and push the refreshed model. */
  private async persist(): Promise<void> {
    const project = this.currentProject();
    if (!project) throw new Error('no project is open');
    const yaml = serializeDeepnoteFile(project.file);
    await fs.writeFile(project.filePath, yaml, 'utf8');
    // Reload so the client model reflects schema-normalized state.
    const reloaded = await loadProject(project.filePath);
    this.project = { ...reloaded, file: project.file };
    this.emit({ v: 1, type: 'project:updated', payload: { project: this.project.model } });
  }

  async save(): Promise<void> {
    await this.persist();
  }

  /** Set (or clear, with null) an integration secret; restarts a warm kernel so it applies. */
  async setSecret(envVar: string, value: string | null): Promise<void> {
    if (!/^[A-Z][A-Z0-9_]*$/.test(envVar)) throw new Error(`invalid env var name: ${envVar}`);
    const previous = this.secrets.get(envVar);
    if (value === null) this.secrets.delete(envVar);
    else this.secrets.set(envVar, value);
    if (this.engine && previous !== value) {
      await this.restartKernel();
      this.emit({
        v: 1,
        type: 'log',
        payload: { level: 'info', message: 'kernel restarted to apply integration secrets' },
      });
    }
  }

  async updateBlock(
    blockId: string,
    content: string | undefined,
    metadata: Record<string, unknown> | undefined,
  ): Promise<void> {
    const file = this.currentFile();
    if (content !== undefined) updateBlockContent(file, blockId, content);
    if (metadata) {
      const notebook = file.project.notebooks.find((n) => n.blocks.some((b) => b.id === blockId));
      const block = notebook?.blocks.find((b) => b.id === blockId);
      if (!block) throw new Error(`block ${blockId} not found`);
      block.metadata = { ...block.metadata, ...metadata } as typeof block.metadata;
    }
    await this.persist();
  }

  async createBlock(
    notebookId: string,
    afterBlockId: string | null,
    blockType: NewBlockType,
  ): Promise<void> {
    const { file } = createBlockAfter(this.currentFile(), notebookId, afterBlockId, blockType);
    const notebook = file.project.notebooks.find((n) => n.id === notebookId);
    const created = notebook?.blocks.at(-1) ?? notebook?.blocks.at(0);
    if (created && defaultContentFor(blockType)) {
      created.content = defaultContentFor(blockType);
    }
    await this.persist();
  }

  async deleteBlock(blockId: string): Promise<void> {
    deleteBlock(this.currentFile(), blockId);
    await this.persist();
  }

  async moveBlock(blockId: string, direction: 'up' | 'down'): Promise<void> {
    moveBlock(this.currentFile(), blockId, direction);
    await this.persist();
  }

  /** Cached DAG per notebook, keyed by the block contents it was computed from. */
  private dagCache = new Map<string, { key: string; dag: DagModel }>();

  /** Upstream/downstream map for a notebook, via the open reactivity DAG. */
  async getDag(notebookId: string): Promise<DagModel> {
    const project = this.currentProject();
    if (!project) throw new Error('no project is open');
    const notebook = project.file.project.notebooks.find((n) => n.id === notebookId);
    if (!notebook) throw new Error(`notebook ${notebookId} not found`);

    // The analyzer spawns python per call; hash the contents so repeated
    // opens of the graph do not re-analyze (or re-hit a hung analyzer).
    const contentsKey = JSON.stringify(notebook.blocks.map((b) => [b.id, b.content]));
    const cached = this.dagCache.get(notebookId);
    if (cached?.key === contentsKey) return cached.dag;

    const { dag } = await Promise.race([
      getDagForBlocks(notebook.blocks),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('dag analysis timed out')), 20_000),
      ),
    ]);
    const upstream: Record<string, string[]> = {};
    const downstream: Record<string, string[]> = {};
    for (const node of dag.nodes) {
      upstream[node.id] = [];
      downstream[node.id] = [];
    }
    for (const edge of dag.edges) {
      upstream[edge.to]?.push(edge.from);
      downstream[edge.from]?.push(edge.to);
    }
    const model: DagModel = {
      edges: dag.edges.map((edge: { from: string; to: string }) => ({
        from: edge.from,
        to: edge.to,
      })),
      upstream,
      downstream,
    };
    this.dagCache.set(notebookId, { key: contentsKey, dag: model });
    return model;
  }

  /** List files in the project working directory (no traversal outside it). */
  async listFiles(subpath = ''): Promise<{ subpath: string; entries: FileEntryModel[] }> {
    const project = this.currentProject();
    if (!project) throw new Error('no project is open');
    const base = path.resolve(project.workingDirectory);
    const target = path.resolve(base, subpath);
    const realBase = await fs.realpath(base).catch(() => base);
    const realTarget = await fs.realpath(target).catch(() => target);
    if (realTarget !== realBase && !realTarget.startsWith(realBase + path.sep)) {
      throw new Error('path escapes the project directory');
    }
    const dirents = await fs.readdir(target, { withFileTypes: true });
    const entries = await Promise.all(
      dirents
        .filter((d) => !d.name.startsWith('.'))
        .map(async (d) => {
          let size = 0;
          if (!d.isDirectory()) {
            size = await fs
              .stat(path.join(target, d.name))
              .then((s) => s.size)
              .catch(() => 0);
          }
          return {
            name: d.name,
            path: path.posix.join(subpath.replaceAll(path.sep, '/'), d.name),
            isDirectory: d.isDirectory(),
            size,
          };
        }),
    );
    entries.sort(
      (a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name),
    );
    return { subpath, entries };
  }

  /** Base URL of the toolkit's Jupyter server (available once the engine runs). */
  toolkitUrl(): string {
    if (!this.engine?.serverPort) throw new Error('kernel is not running yet');
    return `http://127.0.0.1:${this.engine.serverPort}`;
  }

  async listTerminals(): Promise<string[]> {
    const res = await fetch(`${this.toolkitUrl()}/api/terminals`);
    if (!res.ok) throw new Error(`terminals API returned ${res.status}`);
    const body = (await res.json()) as Array<{ name: string }>;
    return body.map((t) => t.name);
  }

  async createTerminal(): Promise<string> {
    const res = await fetch(`${this.toolkitUrl()}/api/terminals`, { method: 'POST' });
    if (!res.ok) throw new Error(`terminal create returned ${res.status}`);
    const body = (await res.json()) as { name: string };
    return body.name;
  }

  /** Project integrations and whether their env vars are present. */
  getIntegrations(): IntegrationStatusModel[] {
    const project = this.currentProject();
    if (!project) throw new Error('no project is open');
    const integrations = (project.file.project.integrations ?? []) as Array<{
      id: string;
      name: string;
      type: string;
    }>;
    return integrations.map((integration) => {
      const envVar = `DEEPNOTE_SQL_CONN_${integration.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
      return {
        id: integration.id,
        name: integration.name,
        type: integration.type,
        envVar,
        configured: Boolean(process.env[envVar]),
      };
    });
  }

  /** Start (or reuse) the engine for the open project. Throws with a clear hint when the toolkit is missing. */
  private async ensureEngine(): Promise<ExecutionEngine> {
    if (this.engine) return this.engine;
    const project = this.currentProject();
    if (!project) throw new Error('no project is open');

    const resolved = await resolveProjectPython({
      projectId: project.model.id,
      searchDirs: [project.workingDirectory],
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
      workingDirectory: project.workingDirectory,
      env: {
        DEEPNOTE_RUNTIME__RUNNING_IN_DETACHED_MODE: 'true',
        ...Object.fromEntries(this.secrets),
      },
    });
    await engine.start();
    this.engine = engine;
    this.setKernelState('ready');
    return engine;
  }

  /**
   * Run the open project (optionally a single notebook / block set, with the
   * reactive "block and dependent blocks" expansion). Events are streamed
   * through `emit`; a snapshot with outputs is saved at the end.
   */
  async run(options: RunOptions = {}): Promise<void> {
    const project = this.currentProject();
    if (!project) throw new Error('no project is open');
    if (this.running) throw new Error('a run is already in progress');

    const engine = await this.ensureEngine();
    const notebookName = options.notebookId
      ? project.file.project.notebooks.find((n) => n.id === options.notebookId)?.name
      : undefined;
    if (options.notebookId && !notebookName) {
      throw new Error(`notebook ${options.notebookId} not found in project`);
    }

    let blockIds = options.blockIds;
    if (blockIds && options.mode === 'downstream') {
      try {
        const notebook =
          project.file.project.notebooks.find((n) => n.id === options.notebookId) ??
          project.file.project.notebooks[0];
        const { dag } = await getDagForBlocks(notebook.blocks);
        // downstream expansion (one hop per known edge; selection grows until stable)
        const expanded = new Set(blockIds);
        let grew = true;
        while (grew) {
          grew = false;
          for (const edge of dag.edges as Array<{ from: string; to: string }>) {
            if (expanded.has(edge.from) && !expanded.has(edge.to)) {
              expanded.add(edge.to);
              grew = true;
            }
          }
        }
        blockIds = [...expanded];
      } catch (error) {
        this.emit({
          v: 1,
          type: 'log',
          payload: {
            level: 'warn',
            message: `reactive expansion unavailable, running selection only: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        });
      }
    }

    this.running = true;
    this.abort = new AbortController();
    const startedAt = new Date().toISOString();
    const collected = new Map<string, BlockExecutionOutput>();

    try {
      this.setKernelState('running');
      const summary = await engine.runProject(project.file, {
        notebookName,
        blockIds,
        inputs: options.inputs,
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
        onAgentEvent: (event) => {
          this.emit({ v: 1, type: 'agent:event', payload: { event } });
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
