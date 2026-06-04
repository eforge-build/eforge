import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      // Main project: engine, client, monitor, and web tests
      './vitest.main.config.ts',
      // Console UI: run-state, pipeline component, and related tests
      './packages/console-ui/vitest.config.ts',
    ],
  },
});
