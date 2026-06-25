import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import { parseExtensionAgentTaskRecord, type ExtensionAgentTaskRecord } from '@eforge-build/client';
import { describe, expect, it } from 'vitest';
import eforgePlanExtension from '../index.js';
import { captureCanonicalBacklogItem } from '../canonical/backlog-records.js';
import { findCanonicalNonterminalCoverage } from '../canonical/coverage.js';
import { syncSessionPlanArtifact } from '../canonical/session-plan-records.js';
import { getItemDetailProjection } from '../projections/items.js';
import { createEmptyRecommendationModel, writeRecommendations } from '../recommendations-store.js';
import { recordPlanningTaskWorkflowEntry } from '../planning-task-workflow-store.js';
import { openEforgePlanStore } from '../sqlite/index.js';

function tempProject(): string { return mkdtempSync(join(tmpdir(), 'eforge-plan-live-coverage-')); }
function planMarkdown(status: string, itemId: string, session = 'live-plan'): string {
  return `---\nsession: ${session}\ntopic: Live plan\nstatus: ${status}\neforge_plan:\n  source_item_ids: [${itemId}]\n---\n# Live plan\n\n## Scope\nContent.\n`;
}
function load(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...state, extensions: [], candidates: [] };
}
function completedCreationTask(taskId: string, session: string): ExtensionAgentTaskRecord {
  return parseExtensionAgentTaskRecord({ taskId, kind: 'eforge-plan.planning-draft', status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', result: { summary: 'Drafted a plan.', assumptionsOpenQuestions: [], decision: 'ready', sessionPlanCreationDraft: { session, topic: 'Workflow plan', planningType: 'feature', planningDepth: 'focused', sections: [
    { dimension: 'problem-statement', content: 'The workflow needs end-to-end planning state coverage.' },
    { dimension: 'scope', content: 'Exercise extension actions and SQL projections.' },
    { dimension: 'acceptance-criteria', content: '- Readiness matches across SQL, action, and Markdown views.' },
    { dimension: 'code-impact', content: 'Tests cover the eforge-plan extension workflow.' },
    { dimension: 'design-decisions', content: 'Use terminal plan state to release planning eligibility.' },
    { dimension: 'assumptions-and-validation', content: 'Validate with targeted vitest coverage.' },
  ] } } });
}
async function dispatch(cwd: string, actionId: string, input: Record<string, unknown>, task?: ExtensionAgentTaskRecord) {
  return dispatchExtensionAction(load(), { actionId: `eforge-plan:${actionId}`, input, requestedBy: { host: 'console' }, cwd, timeoutMs: 1000, agentTasks: () => ({ async start() { return { task: parseExtensionAgentTaskRecord({ taskId: 'replacement-task', kind: 'eforge-plan.planning-draft', status: 'running', createdAt: '2026-01-01T00:00:02.000Z', updatedAt: '2026-01-01T00:00:02.000Z', startedAt: '2026-01-01T00:00:02.000Z' }) }; }, async get() { if (!task) throw new Error('unexpected get'); return { task }; }, async cancel() { throw new Error('unexpected cancel'); } }) });
}
function evidenceRows(cwd: string, session: string): Array<{ is_current: number; is_terminal: number; status: string | null; superseded_at: string | null }> {
  const store = openEforgePlanStore(cwd);
  const db = new DatabaseSync(store.path);
  store.close();
  try { return db.prepare("SELECT is_current, is_terminal, status, superseded_at FROM lifecycle_evidence WHERE session = ? AND reason_code = 'planned-session-plan' ORDER BY evidence_key").all(session) as Array<{ is_current: number; is_terminal: number; status: string | null; superseded_at: string | null }>; } finally { db.close(); }
}

describe('live coverage planning state regression', () => {
  it('drives replacement eligibility through extension actions after a creation draft is abandoned', async () => {
    const cwd = tempProject();
    const itemId = 'workflow-item';
    const session = 'workflow-plan';
    const task = completedCreationTask('task-workflow-create', session);
    const capture = await dispatch(cwd, 'capture-item', { id: itemId, title: 'Implement abandoned-plan replacement actionability', claim: 'Implement planning workstation state handling so an abandoned generated plan releases its backlog item for a replacement planning task.', evidence: 'This regression exercises capture, creation-draft apply, SQL projections, Markdown readiness, delete, recommendations, and replacement task start.', acceptanceCriteria: '- After deleting the generated plan, board, item detail, and recommendations all show the backlog item as actionable for a new planning task.\n- Starting a replacement planning task for the same backlog item succeeds.' });
    if (capture.kind !== 'success') throw new Error(JSON.stringify(capture));
    expect(capture).toMatchObject({ kind: 'success', output: { itemId } });
    await writeRecommendations(cwd, { ...createEmptyRecommendationModel(), readyCandidates: [{ ref: 'ready-workflow', itemId, rationale: 'Ready to plan.' }] });
    await recordPlanningTaskWorkflowEntry(cwd, { taskId: task.taskId, createdAt: '2026-01-01T00:00:00.000Z', originalRequest: 'Plan workflow item', derivedRequest: 'Draft a session plan.', selection: { itemIds: [itemId] }, requestedOutputSections: ['sessionPlanCreationDraft'] });

    const applied = await dispatch(cwd, 'apply-planning-agent-task-result', { taskId: task.taskId, applySessionPlanCreationDraft: {} }, task);
    expect(applied).toMatchObject({ kind: 'success', output: { sessionPlanCreationDraft: { session, readiness: { ready: true } } } });
    const showReady = await dispatch(cwd, 'show-session-plan', { session });
    const listReady = await dispatch(cwd, 'list-planning-artifacts', { includeSubmitted: true });
    const markdownReady = await createSessionPlanningWorkflowAdapter().flat.readiness({ cwd, session });
    expect(showReady).toMatchObject({ kind: 'success', output: { readiness: markdownReady } });
    expect((listReady as any).output.plans.find((plan: { session: string }) => plan.session === session)).toMatchObject({ readiness: markdownReady });

    await dispatch(cwd, 'delete-session-plan', { session });
    const board = await dispatch(cwd, 'list-board-compact', { includeArchive: true, limit: 50 });
    const item = await dispatch(cwd, 'get-item', { id: itemId });
    const recommendations = await dispatch(cwd, 'get-recommendations', {});
    expect(JSON.stringify(board)).toContain('"planEligible":true');
    expect(item).toMatchObject({ kind: 'success', output: { item: { id: itemId, planEligible: true } } });
    expect(recommendations).toMatchObject({ kind: 'success', output: { recommendationActionability: { readyCandidates: [expect.objectContaining({ itemId, actionability: expect.objectContaining({ state: 'actionable' }) })] } } });

    const replacement = await dispatch(cwd, 'start-planning-agent-task', { itemIds: [itemId], includeRoadmap: false });
    expect(replacement).toMatchObject({ kind: 'success', output: { task: { taskId: 'replacement-task' } } });
  });

  it.each(['abandoned', 'deleted', 'superseded', 'completed'])('treats %s session plans as historical audit evidence', async (terminalStatus) => {
    const cwd = tempProject();
    mkdirSync(join(cwd, '.eforge/session-plans'), { recursive: true });
    const itemId = `item-${terminalStatus}`;
    const session = `live-plan-${terminalStatus}`;
    captureCanonicalBacklogItem(cwd, { id: itemId, title: itemId });
    const path = join(cwd, `.eforge/session-plans/${session}.md`);
    writeFileSync(path, planMarkdown('ready', itemId, session));

    syncSessionPlanArtifact(cwd, { session, path, content: planMarkdown('ready', itemId, session), readinessSummary: { ready: true } });
    expect(findCanonicalNonterminalCoverage(cwd, [itemId]).entries.map((entry) => entry.reasonCode)).toContain('planned-session-plan');
    expect((await getItemDetailProjection(cwd, { id: itemId })).item).toMatchObject({ planEligible: false, planEligibilityReasonCode: 'planned-session-plan' });

    writeFileSync(path, planMarkdown(terminalStatus, itemId, session));
    syncSessionPlanArtifact(cwd, { session, path, content: planMarkdown(terminalStatus, itemId, session), readinessSummary: { ready: true } });
    expect(findCanonicalNonterminalCoverage(cwd, [itemId]).ok).toBe(true);
    expect((await getItemDetailProjection(cwd, { id: itemId })).item.planEligible).toBe(true);
    expect(evidenceRows(cwd, session)).toEqual([expect.objectContaining({ is_current: 0, is_terminal: 1, status: terminalStatus, superseded_at: expect.any(String) })]);
  });
});
