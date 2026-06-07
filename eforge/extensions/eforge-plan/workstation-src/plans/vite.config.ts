import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

const daemonUrl = process.env.VITE_EFORGE_DAEMON_URL?.replace(/\/$/, '');
const daemonProxy: Record<string, ProxyOptions> | undefined = daemonUrl
  ? {
      '/api': {
        target: daemonUrl,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
        },
      },
    }
  : undefined;

export default defineConfig({
  plugins: [react()],
  server: daemonProxy ? { proxy: daemonProxy } : undefined,
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
