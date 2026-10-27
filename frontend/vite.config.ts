import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // monaco-editor's exports map does not cooperate with Vite's `?worker`
      // suffix; pointing at the package directory directly does.
      'monaco-editor': path.resolve(dirname, 'node_modules/monaco-editor'),
    },
  },
});
