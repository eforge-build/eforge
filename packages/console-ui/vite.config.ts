import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/console/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // App and vendor chunks are well under 500 kB after the manualChunks split
    // below (index ~190 kB, charts ~420 kB, react-vendor ~180 kB). The only
    // larger chunks are individual Shiki syntax-highlighting language grammars
    // (e.g. cpp, emacs-lisp, the oniguruma wasm), which are pre-bundled,
    // single-module, and lazy-loaded only when that language is highlighted —
    // not splittable further. Raise the warning ceiling above the largest
    // grammar so it still flags genuine app-code bloat.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Split heavy vendors out of the main app chunk so the dashboard shell
        // stays small and each library caches independently.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('victory-vendor') || /\/d3-[^/]+\//.test(id)) {
            return 'charts';
          }
          if (id.includes('@xyflow') || id.includes('dagre')) return 'graph';
          if (
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4567',
        changeOrigin: true,
      },
    },
  },
});
