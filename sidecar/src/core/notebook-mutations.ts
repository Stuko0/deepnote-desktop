/**
 * Pure notebook mutations (Fase 2): update, create, delete, move blocks.
 *
 * No IO here: these operate on the parsed DeepnoteFile and return the new
 * file, so they are unit-testable without a filesystem. Sorting keys are
 * re-indexed through upstream's generateSortingKey to keep YAML diffs
 * minimal and stable.
 */

import crypto from 'node:crypto';
import { generateSortingKey } from '@deepnote/blocks';
import type { DeepnoteFile } from '@deepnote/blocks';

export type NewBlockType =
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

export const NEW_BLOCK_TYPES: readonly NewBlockType[] = [
  'code',
  'sql',
  'agent',
  'markdown',
  'input-text',
  'input-textarea',
  'input-checkbox',
  'input-select',
  'input-slider',
  'input-date',
  'input-date-range',
  'input-file',
];

type Notebook = DeepnoteFile['project']['notebooks'][number];
type Block = Notebook['blocks'][number];

/** 32-char hex id, same shape as the ones used by the SaaS. */
export function newBlockId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

function reindex(notebook: Notebook): Notebook {
  notebook.blocks.forEach((block, index) => {
    block.sortingKey = generateSortingKey(index);
  });
  return notebook;
}

function findNotebook(file: DeepnoteFile, notebookId: string): Notebook {
  const notebook = file.project.notebooks.find((n) => n.id === notebookId);
  if (!notebook) throw new Error(`notebook ${notebookId} not found`);
  return notebook;
}

function findBlockContext(
  file: DeepnoteFile,
  blockId: string,
): { notebook: Notebook; index: number } {
  for (const notebook of file.project.notebooks) {
    const index = notebook.blocks.findIndex((b) => b.id === blockId);
    if (index >= 0) return { notebook, index };
  }
  throw new Error(`block ${blockId} not found`);
}

export function updateBlockContent(
  file: DeepnoteFile,
  blockId: string,
  content: string,
): DeepnoteFile {
  const { notebook, index } = findBlockContext(file, blockId);
  notebook.blocks[index].content = content;
  return file;
}

export function createBlockAfter(
  file: DeepnoteFile,
  notebookId: string,
  afterBlockId: string | null,
  type: NewBlockType,
): { file: DeepnoteFile; blockId: string } {
  const notebook = findNotebook(file, notebookId);
  const insertAt = afterBlockId
    ? (() => {
        const i = notebook.blocks.findIndex((b) => b.id === afterBlockId);
        if (i < 0) throw new Error(`block ${afterBlockId} not found`);
        return i + 1;
      })()
    : notebook.blocks.length;

  const blockId = newBlockId();
  const block = {
    id: blockId,
    type,
    content: '',
    sortingKey: 'placeholder',
    blockGroup: newBlockId(),
    metadata: {},
  } as unknown as Block;
  notebook.blocks.splice(insertAt, 0, block);
  reindex(notebook);
  return { file, blockId };
}

export function deleteBlock(file: DeepnoteFile, blockId: string): DeepnoteFile {
  const { notebook, index } = findBlockContext(file, blockId);
  notebook.blocks.splice(index, 1);
  reindex(notebook);
  return file;
}

export function moveBlock(
  file: DeepnoteFile,
  blockId: string,
  direction: 'up' | 'down',
): DeepnoteFile {
  const { notebook, index } = findBlockContext(file, blockId);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= notebook.blocks.length) return file;
  const [block] = notebook.blocks.splice(index, 1);
  notebook.blocks.splice(target, 0, block);
  reindex(notebook);
  return file;
}

/** Default content for a freshly created block of each type. */
export function defaultContentFor(type: NewBlockType): string {
  switch (type) {
    case 'markdown':
      return 'New text';
    case 'agent':
      return 'Describe the task for the agent';
    case 'input-text':
    case 'input-textarea':
      return 'label';
    case 'input-checkbox':
      return 'flag';
    case 'input-select':
      return 'choice';
    case 'input-slider':
      return 'value';
    case 'input-date':
      return 'day';
    case 'input-date-range':
      return 'range';
    case 'input-file':
      return 'upload';
    default:
      return '';
  }
}
