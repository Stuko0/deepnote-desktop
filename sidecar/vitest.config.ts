import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // loadProject resolves the Python interpreter and probes for the toolkit
    // (process spawns): comfortably over vitest's 5s default on busy machines.
    testTimeout: 30_000,
  },
});
