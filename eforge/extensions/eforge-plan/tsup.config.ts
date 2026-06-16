// --- eforge:region plan-01-package-foundation ---
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'index.ts',
    'backlog-curation-source-provider': 'backlog-curation-source-provider.ts',
  },
  format: ['esm'],
  target: 'node22',
  clean: true,
  dts: true,
  splitting: false,
  minify: true,
  skipNodeModulesBundle: false,
  noExternal: [
    '@eforge-build/client',
    '@eforge-build/extension-sdk',
    '@eforge-build/input',
    '@eforge-build/scopes',
    '@sinclair/typebox',
    'yaml',
    'zod',
  ],
  external: [/^node:/],
});
// --- eforge:endregion plan-01-package-foundation ---
