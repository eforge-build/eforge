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
  esbuildOptions(options) {
    // The runtime bundle inlines a few CommonJS dependencies (notably yaml).
    // When Node imports the ESM bundle from an ESM host, there is no ambient
    // `require`, so esbuild's CommonJS helper cannot load built-ins such as
    // `process` or `buffer` unless we provide one explicitly.
    options.banner = {
      js: "import { createRequire as __eforgeCreateRequire } from 'node:module';\nconst require = __eforgeCreateRequire(import.meta.url);",
    };
  },
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
