import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  // globals.css pins the app shell body to height:100vh; overflow:hidden. That
  // is correct for the real dashboard but clips tall stories in the Storybook
  // canvas, so allow the canvas body to grow and scroll.
  previewHead: (head) =>
    `${head}<style>body { height: auto !important; overflow: auto !important; }</style>`,
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: (cfg) =>
    mergeConfig(cfg, {
      // The app's vite.config sets base: '/console/' for production hosting;
      // Storybook serves from root, so override it back. The '@' alias is
      // re-declared here so stories resolve '@/...' imports identically to the
      // app even if Storybook loads its own Vite config.
      base: '/',
      resolve: {
        alias: {
          '@': srcDir,
        },
      },
    }),
};

export default config;
