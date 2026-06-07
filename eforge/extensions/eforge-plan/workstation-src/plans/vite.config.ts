import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    modulePreload: { polyfill: false },
    outDir: '../../workstation-assets/plans',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: 'index.js',
        assetFileNames: (asset) => asset.name?.endsWith('.css') ? 'style.css' : 'asset-[hash][extname]',
      },
    },
  },
});
