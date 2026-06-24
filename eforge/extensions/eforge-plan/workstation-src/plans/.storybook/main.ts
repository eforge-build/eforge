import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  previewHead: (head) => `${head}<style>body { min-height: 100%; overflow: auto !important; }</style>`,
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: (cfg) => mergeConfig(cfg, {
    resolve: {
      alias: {
        '@': srcDir,
      },
    },
  }),
};

export default config;
