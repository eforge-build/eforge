import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

const rootAliases = [
  { find: /^@eforge-build\/engine\/(.*)$/, replacement: resolve(root, 'packages/engine/src/$1') },
  { find: /^@eforge-build\/monitor\/(.*)$/, replacement: resolve(root, 'packages/monitor/src/$1') },
  { find: '@eforge-build/monitor', replacement: resolve(root, 'packages/monitor/src/index.ts') },
  { find: /^@eforge-build\/monitor-ui\/(.*)$/, replacement: resolve(root, 'packages/monitor-ui/src/$1') },
  { find: '@eforge-build/client/browser', replacement: resolve(root, 'packages/client/src/browser.ts') },
  { find: '@eforge-build/client', replacement: resolve(root, 'packages/client/src/index.ts') },
  { find: /^@eforge-build\/scopes\/(.*)$/, replacement: resolve(root, 'packages/scopes/src/$1') },
  { find: '@eforge-build/scopes', replacement: resolve(root, 'packages/scopes/src/index.ts') },
  { find: /^@eforge-build\/extension-sdk\/(.*)$/, replacement: resolve(root, 'packages/extension-sdk/src/$1') },
  { find: '@eforge-build/extension-sdk', replacement: resolve(root, 'packages/extension-sdk/src/index.ts') },
  { find: /^@eforge-build\/input\/(.*)$/, replacement: resolve(root, 'packages/input/src/$1') },
  { find: '@eforge-build/input', replacement: resolve(root, 'packages/input/src/index.ts') },
  // --- eforge:region plan-04-monitor-ui ---
  // @/ alias for monitor-ui src root — used by monitor-ui component test files.
  { find: /^@\/(.*)$/, replacement: resolve(root, 'packages/monitor-ui/src/$1') },
  // --- eforge:endregion plan-04-monitor-ui ---
  // @modelcontextprotocol/sdk is installed in packages/eforge/node_modules only; map sub-paths
  // to the ESM dist so test files can import from it directly.
  {
    find: /^@modelcontextprotocol\/sdk\/(.+)$/,
    replacement: resolve(root, 'packages/eforge/node_modules/@modelcontextprotocol/sdk/dist/esm/$1'),
  },
  {
    find: '@modelcontextprotocol/sdk',
    replacement: resolve(root, 'packages/eforge/node_modules/@modelcontextprotocol/sdk/dist/esm/index.js'),
  },
  // docs-gen package source aliases
  { find: '@eforge-build/eforge/cli', replacement: resolve(root, 'packages/eforge/src/cli/index.ts') },
  { find: /^@eforge-build\/docs-gen\/(.*)$/, replacement: resolve(root, 'packages/docs-gen/src/$1') },
];

export default defineConfig({
  define: {
    // Stub the baked-in CLI version constant for test environments
    EFORGE_VERSION: JSON.stringify('test'),
  },
  test: {
    projects: [
      {
        // Root project: engine, web, monitor-ui, client, monitor tests
        define: { EFORGE_VERSION: JSON.stringify('test') },
        test: {
          setupFiles: [resolve(root, 'test/setup-test-env.ts')],
          include: [
            resolve(root, 'test/**/*.test.ts'),
            resolve(root, 'packages/engine/test/**/*.test.ts'),
            // --- eforge:region plan-02-web-site ---
            resolve(root, 'web/__tests__/**/*.test.ts'),
            // --- eforge:endregion plan-02-web-site ---
            // --- eforge:region plan-04-monitor-ui ---
            resolve(root, 'packages/monitor-ui/src/**/*.test.tsx'),
            resolve(root, 'packages/monitor-ui/src/**/*.test.ts'),
            resolve(root, 'packages/monitor-ui/test/**/*.test.ts'),
            // --- eforge:endregion plan-04-monitor-ui ---
            // --- eforge:region plan-04-daemon-events-server ---
            resolve(root, 'packages/client/src/__tests__/**/*.test.ts'),
            // --- eforge:endregion plan-04-daemon-events-server ---
            // --- eforge:region plan-01-types-and-daemon-emission ---
            resolve(root, 'packages/monitor/src/__tests__/**/*.test.ts'),
            // --- eforge:endregion plan-01-types-and-daemon-emission ---
          ],
          server: {
            deps: {
              inline: [/^@eforge-build\//, /^@modelcontextprotocol\//],
              moduleDirectories: [
                'node_modules',
                'packages/engine/node_modules',
                'packages/eforge/node_modules',
              ],
            },
          },
        },
        resolve: { alias: rootAliases },
      },
      // --- eforge:region plan-console-ui ---
      // Console-UI project: uses its own vitest.config.ts with jsdom environment and
      // the correct @/ alias pointing to packages/console-ui/src.
      resolve(root, 'packages/console-ui'),
      // --- eforge:endregion plan-console-ui ---
    ],
  },
});
