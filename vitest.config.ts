import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      // Main project: engine, client, monitor, and web tests
      './vitest.main.config.ts',
      // Console UI: run-state, pipeline component, and related tests
      './packages/console-ui/vitest.config.ts',
      // eforge-plan workstation: extension-owned frame source tests
      './eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts',
    ],
  },
});
