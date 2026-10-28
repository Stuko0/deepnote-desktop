import fs from 'node:fs';
import path from 'node:path';
import { deserializeDeepnoteFile, serializeDeepnoteFile } from '@deepnote/blocks';
import type { DeepnoteFile } from '@deepnote/blocks';
import { describe, expect, it } from 'vitest';

import {
  createBlockAfter,
  defaultContentFor,
  deleteBlock,
  moveBlock,
  newBlockId,
  updateBlockContent,
} from '../core/notebook-mutations.js';

const fixture = fs.readFileSync(
  path.join(import.meta.dirname, '../../../test-fixtures/hello-world.deepnote'),
  'utf8',
);

function freshFile(): DeepnoteFile {
  return deserializeDeepnoteFile(fixture);
}

function blockIds(file: DeepnoteFile): string[] {
  return file.project.notebooks[0].blocks.map((b) => b.id);
}

function blockTypes(file: DeepnoteFile): string[] {
  return file.project.notebooks[0].blocks.map((b) => b.type);
}

describe('notebook mutations', () => {
  it('generates 32-char hex ids like the SaaS', () => {
    const id = newBlockId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('updates block content in place', () => {
    const file = freshFile();
    updateBlockContent(file, 'block-print', 'print("edited")');
    const block = file.project.notebooks[0].blocks.find((b) => b.id === 'block-print');
    expect(block?.content).toBe('print("edited")');
  });

  it('creates a block after a given block and keeps sorted keys', () => {
    const file = freshFile();
    const { blockId } = createBlockAfter(file, 'notebook-hello', 'block-print', 'code');
    const ids = blockIds(file);
    expect(ids).toEqual(['block-intro', 'block-print', blockId, 'block-sum', 'block-double']);
    const keys = file.project.notebooks[0].blocks.map((b) => b.sortingKey);
    expect([...keys].sort()).toEqual(keys);
  });

  it('creates a block at the end when afterBlockId is null', () => {
    const file = freshFile();
    const { blockId } = createBlockAfter(file, 'notebook-hello', null, 'markdown');
    expect(blockIds(file).at(-1)).toBe(blockId);
  });

  it('deletes a block and reindexes', () => {
    const file = freshFile();
    deleteBlock(file, 'block-print');
    expect(blockIds(file)).toEqual(['block-intro', 'block-sum', 'block-double']);
    const keys = file.project.notebooks[0].blocks.map((b) => b.sortingKey);
    expect([...keys].sort()).toEqual(keys);
  });

  it('moves a block up and down within bounds', () => {
    const file = freshFile();
    moveBlock(file, 'block-sum', 'up');
    expect(blockTypes(file)).toEqual(['markdown', 'code', 'code', 'code']);
    expect(blockIds(file)[2]).toBe('block-print');
    moveBlock(file, 'block-sum', 'up');
    expect(blockIds(file)[0]).toBe('block-sum');
    // moving the first block up is a no-op
    moveBlock(file, 'block-sum', 'up');
    expect(blockIds(file)[0]).toBe('block-sum');
  });

  it('round-trips a mutated file through the YAML serializer', () => {
    const file = freshFile();
    updateBlockContent(file, 'block-sum', 'total = 21 * 2\nprint(total)');
    const yaml = serializeDeepnoteFile(file);
    const reparsed = deserializeDeepnoteFile(yaml);
    const block = reparsed.project.notebooks[0].blocks.find((b) => b.id === 'block-sum');
    expect(block?.content).toContain('21 * 2');
  });

  it('provides default content per block type', () => {
    expect(defaultContentFor('markdown')).toBeTruthy();
    expect(defaultContentFor('input-slider')).toBeTruthy();
    expect(defaultContentFor('code')).toBe('');
  });

  it('throws for unknown block or notebook ids', () => {
    const file = freshFile();
    expect(() => updateBlockContent(file, 'nope', 'x')).toThrow(/not found/);
    expect(() => createBlockAfter(file, 'nope', null, 'code')).toThrow(/not found/);
  });
});
