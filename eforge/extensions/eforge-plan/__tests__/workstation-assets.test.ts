import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ASSET = 'eforge/extensions/eforge-plan/workstation-assets/plans/index.js';
const SRC = 'eforge/extensions/eforge-plan/workstation-src/plans/src';
const BACKLOG_VIEW = `${SRC}/views/backlog-view.tsx`;
const RECOMMENDATIONS_PANEL = `${SRC}/views/backlog/recommendations-panel.tsx`;
const PLAN_WITH_AI_PANEL = `${SRC}/views/backlog/plan-with-ai-panel.tsx`;
const BRIDGE = `${SRC}/bridge.ts`;
const PLAN_DETAIL = `${SRC}/views/plans/plan-detail.tsx`;
const PLAN_SET_DETAIL = `${SRC}/views/plans/plan-set-detail.tsx`;

describe('eforge-plan planning workstation assets', () => {
  it('stays inside extension-owned browser assets without private Console imports', async () => {
    const source = await readFile(ASSET, 'utf-8');

    expect(source).not.toContain('packages/console-ui/src');
    expect(source).not.toMatch(/from\s+['"]@\//);
    expect(source).not.toMatch(/import\s+.*['"](?:\.\.\/)+\.\.\//);
  });

  it('production bundle invokes actions only through the workstation bridge', async () => {
    const source = await readFile(ASSET, 'utf-8');

    expect(source).toContain('window.eforge');
    expect(source).toContain('invokeAction');
    expect(source).toContain('Plan with AI');
    for (const actionId of ['start-planning-agent-task', 'get-planning-agent-task', 'cancel-planning-agent-task', 'apply-planning-agent-task-result']) {
      expect(source).toContain(actionId);
    }
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest/);
  });

  it('invokes planning task actions through the bridge without direct daemon fetches', async () => {
    const source = await readFile(PLAN_WITH_AI_PANEL, 'utf-8');

    for (const actionId of ['start-planning-agent-task', 'get-planning-agent-task', 'cancel-planning-agent-task', 'apply-planning-agent-task-result']) {
      expect(source).toContain(actionId);
    }
    expect(source).toContain('bridge.invokeAction');
    expect(source).not.toMatch(/fetch\s*\(/);
  });

  it('mock bridge supports planning task actions with mock task-shaped responses', async () => {
    const source = await readFile(BRIDGE, 'utf-8');

    for (const actionId of ['start-planning-agent-task', 'get-planning-agent-task', 'cancel-planning-agent-task', 'apply-planning-agent-task-result']) {
      expect(source).toContain(`case '${actionId}'`);
    }
    expect(source).toContain('mockPlanningTask');
    expect(source).toContain("return { task:");
    expect(source).toContain('applied: { recommendations: Boolean(input.applyRecommendations)');
  });

  it('requires explicit in-app confirmation before applying generated planning output', async () => {
    const source = await readFile(PLAN_WITH_AI_PANEL, 'utf-8');

    expect(source).not.toMatch(/window\.confirm\s*\(/);
    expect(source).toContain('confirmingRecommendations ? void apply({ applyRecommendations: true }) : setConfirmingRecommendations(true)');
    expect(source).toContain('Confirm apply recommendations');
    expect(source).toContain('confirmingSessionPlan ? void apply({ applySessionPlanDrafts:');
    expect(source).toContain('Confirm apply session-plan content');
  });

  it('promotes a multi-item selection through the promote-selection action', async () => {
    const source = await readFile(BACKLOG_VIEW, 'utf-8');

    expect(source).toContain("'promote-selection'");
    expect(source).toContain('itemIds: selectedIds');
    expect(source).toContain('Array.from(selected)');
  });

  it('wires recommendation promotion paths through promote-selection refs', async () => {
    const source = await readFile(RECOMMENDATIONS_PANEL, 'utf-8');

    expect(source).toContain('itemIds: [entry.itemId]');
    expect(source).toContain('recommendationRef: entry.ref');
    expect(source).toContain('recommendationRef: group.ref');
  });

  it('requires explicit in-app confirmation before handoff', async () => {
    const source = await readFile(PLAN_DETAIL, 'utf-8');

    expect(source).toContain("'handoff-session-plan'");
    // window.confirm is unusable in the sandboxed (allow-modals-less) iframe, so
    // handoff gates on an in-app confirmation step instead.
    expect(source).not.toMatch(/window\.confirm\s*\(/);
    expect(source).toContain('confirmingHandoff');
  });

  it('turns readiness diagnostics into actionable section and dimension mutations', async () => {
    const source = await readFile(PLAN_DETAIL, 'utf-8');

    expect(source).toContain("'set-session-plan-section'");
    expect(source).toContain("'select-session-plan-dimensions'");
    expect(source).toContain("'update-session-plan-metadata'");
  });

  it('renders plan-set children by relationship strategy with validation', async () => {
    const source = await readFile(PLAN_SET_DETAIL, 'utf-8');

    expect(source).toContain("strategy === 'parallel'");
    expect(source).toContain('dependsOn');
    expect(source).toContain('diagnostics');
  });
});
