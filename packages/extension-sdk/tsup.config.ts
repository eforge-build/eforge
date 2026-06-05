import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/project-storage.ts', 'src/project-paths.ts'],
  format: ['esm'],
  dts: true,
  target: 'node22',
  clean: true,
});
