import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 180_000,
    // The toolkit server is heavy: one suite at a time.
    fileParallelism: false,
  },
});
