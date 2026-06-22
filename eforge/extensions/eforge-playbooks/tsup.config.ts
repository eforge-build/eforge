import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'index.ts' },
  format: ['esm'],
  target: 'node22',
  clean: true,
  dts: true,
  splitting: false,
  minify: true,
  esbuildOptions(options) {
    options.banner = {
      js: "import { createRequire as __eforgeCreateRequire } from 'node:module';\nconst require = __eforgeCreateRequire(import.meta.url);",
    };
  },
  skipNodeModulesBundle: false,
  noExternal: [
    '@eforge-build/extension-sdk',
    '@eforge-build/input',
    '@eforge-build/scopes',
    '@sinclair/typebox',
    'yaml',
    'zod',
  ],
  external: [/^node:/],
});
