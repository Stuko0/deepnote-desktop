/**
 * Monaco, self-hosted: bundled from npm with Vite workers, no CDN, so the
 * desktop app works fully offline. Loaded lazily by @monaco-editor/react.
 */

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker.js?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker: (workerId: string, label: string) => Worker };
  }
}

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

// Exposed for E2E tests and diagnostics: lets tests drive the same model the
// components bind to instead of depending on hidden-input keyboard focus.
(window as unknown as { monaco: typeof monaco }).monaco = monaco;

export { loader };
