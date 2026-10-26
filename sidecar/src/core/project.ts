/**
 * Project loading: `.deepnote` YAML -> client model.
 *
 * Uses @deepnote/blocks for parsing and @deepnote/convert for snapshot loading,
 * so the on-disk format stays byte-compatible with upstream tooling.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { deserializeDeepnoteFile } from '@deepnote/blocks';
import type { DeepnoteFile } from '@deepnote/blocks';
import { loadLatestSnapshot, mergeSnapshotIntoSource } from '@deepnote/convert';
import {
  executableBlockTypeSet,
  hasDeepnoteToolkit,
  resolveProjectPython,
} from '@deepnote/runtime-core';
import type { ResolvedProjectPython } from '@deepnote/runtime-core';

import type { BlockModel, NotebookModel, ProjectModel } from './protocol.js';

export interface LoadedProject {
  filePath: string;
  workingDirectory: string;
  /** Source file with the latest snapshot outputs merged in (read-only view). */
  file: DeepnoteFile;
  /** Snapshot outputs keyed by block id, for restoring last run state. */
  snapshotPath: string | null;
  model: ProjectModel;
}

function toBlockModel(
  block: DeepnoteFile['project']['notebooks'][number]['blocks'][number],
): BlockModel {
  const meta = (block.metadata ?? {}) as Record<string, unknown>;
  const outputs = 'outputs' in block ? (block.outputs ?? []) : [];
  const executionCount = 'executionCount' in block ? (block.executionCount ?? null) : null;
  return {
    id: block.id,
    type: block.type,
    content: block.content ?? '',
    sortingKey: block.sortingKey,
    blockGroup: block.blockGroup,
    variableName:
      typeof meta.deepnote_variable_name === 'string' ? meta.deepnote_variable_name : undefined,
    metadata: meta,
    outputs: outputs as BlockModel['outputs'],
    executionCount,
    isExecutable: executableBlockTypeSet.has(block.type),
  };
}

function toNotebookModel(notebook: DeepnoteFile['project']['notebooks'][number]): NotebookModel {
  return {
    id: notebook.id,
    name: notebook.name,
    executionMode: notebook.executionMode ?? 'block',
    blocks: notebook.blocks.map(toBlockModel),
  };
}

/** Read, parse, and enrich a `.deepnote` file with the latest snapshot outputs. */
export async function loadProject(filePath: string): Promise<LoadedProject> {
  const absolute = path.resolve(filePath);
  const raw = await fs.readFile(absolute, 'utf8');
  const parsed = deserializeDeepnoteFile(raw);

  const workingDirectory = path.dirname(absolute);

  let merged = parsed;
  let snapshotPath: string | null = null;
  const snapshot = await loadLatestSnapshot(absolute, parsed.project.id).catch(() => null);
  if (snapshot) {
    merged = mergeSnapshotIntoSource(parsed, snapshot);
    snapshotPath = (snapshot as { snapshotPath?: string }).snapshotPath ?? absolute;
  }

  const python = await resolveProjectPython({
    projectId: parsed.project.id,
    searchDirs: [workingDirectory],
  }).catch(
    (error: unknown): ResolvedProjectPython => ({
      pythonPath: process.env.DEEPNOTE_PYTHON ?? 'python3',
      source: 'default' as const,
      warnings: [
        `python resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }),
  );

  let toolkitInstalled = false;
  try {
    toolkitInstalled = await hasDeepnoteToolkit(python.pythonPath);
  } catch {
    toolkitInstalled = false;
  }

  const model: ProjectModel = {
    path: absolute,
    id: parsed.project.id,
    name: parsed.project.name,
    notebooks: parsed.project.notebooks.map(toNotebookModel),
    snapshotPath,
    python: {
      path: python.pythonPath,
      source: python.source,
      warnings: [...python.warnings, ...(python.hint ? [python.hint] : [])],
      toolkitInstalled,
    },
  };

  return {
    filePath: absolute,
    workingDirectory,
    file: merged,
    snapshotPath,
    model,
  };
}
