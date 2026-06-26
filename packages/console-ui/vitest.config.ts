import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: [
      // Package-local @/ alias — maps to Console source files.
      { find: /^@\/(.*)$/, replacement: resolve(root, 'src/$1') },
      // Resolve workspace client package from source for tests.
      {
        find: '@eforge-build/client/browser',
        replacement: resolve(root, '../client/src/browser.ts'),
      },
      {
        find: '@eforge-build/client',
        replacement: resolve(root, '../client/src/index.ts'),
      },
    ],
  },
});
