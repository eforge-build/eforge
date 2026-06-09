import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ASSET = 'eforge/extensions/eforge-plan/workstation-assets/plans/index.js';
const SRC = 'eforge/extensions/eforge-plan/workstation-src/plans/src';
const BACKLOG_VIEW = `${SRC}/views/backlog-view.tsx`;
const RECOMMENDATIONS_PANEL = `${SRC}/views/backlog/recommendations-panel.tsx`;
const PLAN_WITH_AI_PANEL = `${SRC}/views/backlog/plan-with-ai-panel.tsx`;
const TASK_WORKFLOWS_HOOK = `${SRC}/views/backlog/use-planning-task-workflows.ts`;
const TASK_RESULT_PREVIEW = `${SRC}/views/backlog/planning-task-result-preview.tsx`;
const TASK_CARD = `${SRC}/views/backlog/planning-task-card.tsx`;
const MOCK_DATA = `${SRC}/fixtures/mock-data.ts`;
const BRIDGE = `${SRC}/bridge.ts`;
const PLAN_DETAIL = `${SRC}/views/plans/plan-detail.tsx`;
const BOARD_MODEL = `${SRC}/views/backlog/board-model.ts`;
const LIFECYCLE_PANEL = `${SRC}/views/backlog/lifecycle-panel.tsx`;
const LIFECYCLE_EVIDENCE_PANEL = `${SRC}/views/plans/lifecycle-evidence-panel.tsx`;
const README = 'eforge/extensions/eforge-plan/README.md';
const PLAN_SET_DETAIL = `${SRC}/views/plans/plan-set-detail.tsx`;

const TASK_WORKFLOW_ACTIONS = [
  'list-planning-agent-tasks',
  'start-planning-agent-task',
  'get-planning-agent-task',
  'cancel-planning-agent-task',
  'retry-planning-agent-task',
  'redraft-planning-agent-task',
  'apply-planning-agent-task-result',
] as const;

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
    expect(source).toContain('Promote to a build plan');
    expect(source).toContain('Lifecycle evidence');
    expect(source).toContain('Source refs');
    expect(source).toContain('Partial progress');
    expect(source).not.toContain('Promote as one plan');
    for (const actionId of TASK_WORKFLOW_ACTIONS) {
      expect(source).toContain(actionId);
    }
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest/);
    expect(source).not.toMatch(/\.eforge\/storage\/extensions/);
  });

  it('invokes durable planning task workflow actions through the shared bridge hook', async () => {
    const source = await readFile(TASK_WORKFLOWS_HOOK, 'utf-8');

    for (const actionId of TASK_WORKFLOW_ACTIONS) {
      expect(source).toContain(actionId);
    }
    expect(source).toContain('bridge.invokeAction');
    expect(source).not.toMatch(/fetch\s*\(/);
  });

  it('monitor panel lists durable tasks without a free-form prompt-input start box', async () => {
    const source = await readFile(PLAN_WITH_AI_PANEL, 'utf-8');

    expect(source).toContain('Plan with AI');
    expect(source).toContain('PlanningTaskCard');
    expect(source).not.toContain('setUserGoal');
    expect(source).not.toContain('userGoal');
  });

  it('mock bridge supports the durable planning task workflow actions', async () => {
    const source = await readFile(BRIDGE, 'utf-8');

    for (const actionId of TASK_WORKFLOW_ACTIONS) {
      expect(source).toContain(`case '${actionId}'`);
    }
    expect(source).toContain('listMockPlanningTasks');
    expect(source).toContain('relinkMockPlanningTask');
    expect(source).toContain('applyMockCreationDraft');
    expect(source).toContain('const applied = {');
    expect(source).toContain('recommendations: Boolean(input.applyRecommendations)');
  });

  it('wires recommendation refresh through the bridge without queue actions', async () => {
    const [hook, panel, bridge, asset] = await Promise.all([
      readFile(TASK_WORKFLOWS_HOOK, 'utf-8'),
      readFile(RECOMMENDATIONS_PANEL, 'utf-8'),
      readFile(BRIDGE, 'utf-8'),
      readFile(ASSET, 'utf-8'),
    ]);

    expect(hook).toContain("invokeAction<RefreshRecommendationsResponse>('refresh-recommendations', {})");
    expect(panel).toContain('onRefreshRecommendations');
    const refreshBridgeCase = bridge.match(/case 'refresh-recommendations':[^\n]+/)?.[0] ?? '';
    expect(refreshBridgeCase).toContain("case 'refresh-recommendations'");
    expect(asset).toContain('refresh-recommendations');
    expect(`${hook}\n${panel}\n${refreshBridgeCase}`).not.toMatch(/enqueue|build-queue/);
  });

  it('keeps a stateful mock fixture set for running, failed, needs-input, and ready creation drafts', async () => {
    const source = await readFile(MOCK_DATA, 'utf-8');

    expect(source).toContain("lifecycleState: 'partial'");
    expect(source).toContain("lifecycleState: 'pr-open'");
    expect(source).toContain("lifecycleState: 'merged'");
    expect(source).toContain("lifecycleState: 'failed'");
    expect(source).toContain('multiItemPartialRows');
    expect(source).toContain('mockEpicProgress');
    expect(source).toContain("status: 'running'");
    expect(source).toContain('sectionProgress');
    expect(source).toContain('currentSection');
    expect(source).toContain('coveredSections');
    expect(source).toContain('remainingSections');
    expect(source).toContain("status: 'failed'");
    expect(source).toContain("decision: 'needs-input'");
    expect(source).toContain('clarificationQuestions');
    expect(source).toContain('sessionPlanCreationDraft');
    expect(source).toContain('getMockArtifacts');
    expect(source).toContain('applyMockCreationDraft');
  });

  it('requires explicit in-app confirmation before applying generated planning output', async () => {
    const source = await readFile(TASK_RESULT_PREVIEW, 'utf-8');

    expect(source).not.toMatch(/window\.confirm\s*\(/);
    expect(source).toContain('if (confirming !== key)');
    expect(source).toContain('Confirm create session plan');
    expect(source).toContain('Confirm apply recommendations');
    expect(source).toContain('Confirm apply session-plan content');
  });

  it('labels recommendation refresh workflow entries in the task monitor', async () => {
    const source = await readFile(TASK_CARD, 'utf-8');

    expect(source).toContain("entry.purpose === 'recommendation-refresh'");
    expect(source).toContain('Recommendation refresh');
  });

  it('promotes selected ready backlog items through a single AI planning task', async () => {
    const source = await readFile(BACKLOG_VIEW, 'utf-8');

    expect(source).toContain('Promote to a build plan');
    expect(source).not.toContain('Promote as one plan');
    expect(source).not.toContain("'promote-selection'");
    expect(source).toContain('selectedReadyIds');
    expect(source).toContain('workflows.start');
  });

  it('requires explicit in-app confirmation before handoff', async () => {
    const source = await readFile(PLAN_DETAIL, 'utf-8');

    expect(source).toContain("'handoff-session-plan'");
    // window.confirm is unusable in the sandboxed (allow-modals-less) iframe, so
    // handoff gates on an in-app confirmation step instead.
    expect(source).not.toMatch(/window\.confirm\s*\(/);
    expect(source).toContain('confirmingHandoff');
  });

  it('renders lifecycle source and evidence panels from extension action projections only', async () => {
    const [backlogPanel, evidencePanel, detail, bridge, asset, boardModel] = await Promise.all([
      readFile(LIFECYCLE_PANEL, 'utf-8'),
      readFile(LIFECYCLE_EVIDENCE_PANEL, 'utf-8'),
      readFile(PLAN_DETAIL, 'utf-8'),
      readFile(BRIDGE, 'utf-8'),
      readFile(ASSET, 'utf-8'),
      readFile(BOARD_MODEL, 'utf-8'),
    ]);

    expect(backlogPanel).toContain('Lifecycle evidence');
    expect(backlogPanel).toContain('PR open');
    expect(backlogPanel).toContain('Merged');
    expect(backlogPanel).toContain('Failed');
    expect(evidencePanel).toContain('Source refs');
    expect(evidencePanel).toContain('Partial progress');
    expect(detail.indexOf('<PlanLifecycleEvidencePanel')).toBeLessThan(detail.indexOf('<ReadinessChecklist'));
    expect(boardModel).toContain('lifecycleSearchText');
    expect(boardModel).toContain('row.prUrl');
    expect(boardModel).toContain('row.sessionId');
    expect(boardModel).toContain('row.affectedItemIds');
    expect(bridge).toContain('mockBoard');
    for (const source of [backlogPanel, evidencePanel, detail, bridge, asset]) {
      expect(source).not.toMatch(/fetch\s*\(/);
      expect(source).not.toMatch(/XMLHttpRequest/);
      expect(source).not.toMatch(/\.eforge\/storage\/extensions/);
    }
  });

  it('documents lifecycle linkage, partial completion, and recommendation freshness rules', async () => {
    const source = await readFile(README, 'utf-8');

    expect(source).toContain('.eforge/storage/extensions/eforge-plan/traces/');
    expect(source).toContain('.eforge/storage/extensions/eforge-plan/recommendations/');
    expect(source).toContain('.eforge/storage/extensions/eforge-plan/planning-tasks/index.json');
    expect(source).toContain('.eforge/session-plans/');
    expect(source).toContain('For AI session-plan creation drafts, source backlog item ids and epic ids are trusted only from the preserved workflow selection');
    expect(source).toContain('PR-open, failed, skipped, cancelled, and ambiguous evidence updates trace evidence and UI lifecycle rows but does not close backlog items');
    expect(source).toContain('may mark only correlated item ids `shipped`');
    expect(source).toContain('partial');
    expect(source).toContain('Freshness is restored only through explicit recommendation apply or refresh paths');
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
