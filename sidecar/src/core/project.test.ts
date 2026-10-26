import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadProject } from '../core/project.js';

const fixture = path.join(import.meta.dirname, '../../../test-fixtures/hello-world.deepnote');

describe('loadProject', () => {
  it('parses a .deepnote file into the client model', async () => {
    const project = await loadProject(fixture);
    expect(project.model.name).toBe('Hello World');
    expect(project.model.notebooks).toHaveLength(1);

    const notebook = project.model.notebooks[0];
    expect(notebook.name).toBe('Hello');
    expect(notebook.blocks.map((b) => b.type)).toEqual(['markdown', 'code', 'code']);

    const codeBlock = notebook.blocks[1];
    expect(codeBlock.isExecutable).toBe(true);
    expect(codeBlock.content).toContain('hello from deepnote-desktop');
    expect(codeBlock.variableName).toBe('df');
  });

  it('marks markdown blocks as non-executable', async () => {
    const project = await loadProject(fixture);
    const markdown = project.model.notebooks[0].blocks[0];
    expect(markdown.isExecutable).toBe(false);
    expect(markdown.outputs).toEqual([]);
  });

  it('reports python resolution even when the toolkit is missing', async () => {
    const project = await loadProject(fixture);
    expect(project.model.python.path).toBeTruthy();
    expect(typeof project.model.python.toolkitInstalled).toBe('boolean');
  });
});
