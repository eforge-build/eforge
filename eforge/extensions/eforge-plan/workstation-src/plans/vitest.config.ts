import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

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
      { find: /^@\/(.*)$/, replacement: resolve(root, 'src/$1') },
      { find: '@eforge-build/client/browser', replacement: resolve(root, '../../../../../packages/client/src/browser.ts') },
      { find: '@eforge-build/client', replacement: resolve(root, '../../../../../packages/client/src/index.ts') },
    ],
  },
});
