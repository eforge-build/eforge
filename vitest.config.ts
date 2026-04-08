import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
  resolve: {
    alias: {
      '@eforge-build/client': resolve(__dirname, 'packages/client/src/index.ts'),
      '@eforge-build/engine/': resolve(__dirname, 'packages/engine/src/'),
      '@eforge-build/monitor-ui/': resolve(__dirname, 'packages/monitor-ui/src/'),
      '@eforge-build/monitor': resolve(__dirname, 'packages/monitor/src/index.ts'),
      '@eforge-build/monitor/': resolve(__dirname, 'packages/monitor/src/'),
    },
  },
});
