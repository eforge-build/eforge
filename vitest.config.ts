import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    server: {
      deps: {
        inline: [/^@eforge-build\//],
        moduleDirectories: ['node_modules', 'packages/engine/node_modules'],
      },
    },
  },
  resolve: {
    alias: [
      { find: /^@eforge-build\/engine\/(.*)$/, replacement: resolve(root, 'packages/engine/src/$1') },
      { find: /^@eforge-build\/monitor\/(.*)$/, replacement: resolve(root, 'packages/monitor/src/$1') },
      { find: '@eforge-build/monitor', replacement: resolve(root, 'packages/monitor/src/index.ts') },
      { find: /^@eforge-build\/monitor-ui\/(.*)$/, replacement: resolve(root, 'packages/monitor-ui/src/$1') },
      { find: '@eforge-build/client', replacement: resolve(root, 'packages/client/src/index.ts') },
    ],
  },
});
