import { describe, expect, it } from 'vitest';
import { captureCanonicalBacklogItem } from '../canonical/backlog-records.js';
import { recordCanonicalLifecycleEvent } from '../canonical/lifecycle-records.js';
import { syncSessionPlanArtifact } from '../canonical/session-plan-records.js';
import { withCanonicalTransaction } from '../canonical/store.js';
import { recordLifecycleEvidence } from '../sqlite/index.js';
import { getAssociatedPlanBuildLinksForItems, getItemDetailProjection, findNonterminalCoverage } from '../projections/index.js';
import { seedProjectionBacklog, withTempProjectionProject, writeSessionPlan } from './sqlite-projection-fixtures.js';

describe('SQLite lifecycle projections', () => {
  it('projects explicit user status separately from effective running build lifecycle and links', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);

      const output = await getItemDetailProjection(cwd, { id: 'running', includeLifecycleRows: true, includeBody: false, includeSections: false });

      expect(output.item).toMatchObject({ id: 'running', status: 'active', userStatus: 'active', lifecycleState: 'build', effectiveLifecycle: 'build', lane: 'in-progress' });
      expect(output.item.reasonCodes).toContain('running-build');
      expect(output.item.associatedLinks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'build-run', runId: 'run-1', buildSessionId: 'build-session-1' })]));
      expect(output.item).not.toHaveProperty('body');
      expect(output.item).not.toHaveProperty('sections');
    });
  });

  it('keeps explicit planned and active user statuses plan-eligible without backend blockers', async () => {
    await withTempProjectionProject(async (cwd) => {
      captureCanonicalBacklogItem(cwd, { id: 'user-planned', title: 'User Planned', status: 'planned' });
      captureCanonicalBacklogItem(cwd, { id: 'user-active', title: 'User Active', status: 'active' });

      const planned = await getItemDetailProjection(cwd, { id: 'user-planned' });
      const active = await getItemDetailProjection(cwd, { id: 'user-active' });

      expect(planned.item).toMatchObject({ lifecycleState: 'planned', planEligible: true });
      expect(active.item).toMatchObject({ lifecycleState: 'planned', planEligible: true });
      expect(planned.item).not.toHaveProperty('planEligibilityReasonCode');
      expect(active.item).not.toHaveProperty('planEligibilityReasonCode');
    });
  });

  it('ignores stale current planned-session-plan evidence once the tied session plan is terminal', async () => {
    await withTempProjectionProject(async (cwd) => {
      captureCanonicalBacklogItem(cwd, { id: 'terminal-item', title: 'Terminal Item', status: 'candidate' });
      const content = `---\nsession: terminal-plan\ntopic: Terminal plan\nstatus: deleted\neforge_plan:\n  source_item_ids: [terminal-item]\n---\n# Terminal plan\n`;
      syncSessionPlanArtifact(cwd, { session: 'terminal-plan', path: `${cwd}/.eforge/session-plans/terminal-plan.md`, content, status: 'deleted', sourceItemIds: ['terminal-item'] });
      withCanonicalTransaction(cwd, (store) => recordLifecycleEvidence(store, { evidenceKey: 'stale-planned-terminal-plan', itemRef: 'terminal-item', itemId: 'terminal-item', session: 'terminal-plan', lifecycleState: 'planned', reasonCode: 'planned-session-plan', evidenceKind: 'session-plan', status: 'ready', isCurrent: true, isTerminal: false, occurredAt: '2026-01-01T00:00:00.000Z', links: { session: 'terminal-plan' } }));

      const output = await getItemDetailProjection(cwd, { id: 'terminal-item', includeLifecycleRows: true });
      const coverage = await findNonterminalCoverage(cwd, { itemIds: ['terminal-item'] });

      expect(output.item).toMatchObject({ planEligible: true, lifecycleState: 'none', reasonCodes: ['candidate-no-evidence'] });
      expect(coverage).toMatchObject({ ok: true, entries: [] });
    });
  });

  it('uses downstream lifecycle priority over stale user-authored statuses and older failures', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      writeSessionPlan(cwd, 'plan-priority', ['candidate']);
      recordCanonicalLifecycleEvent(cwd, { eventKey: 'failed-first', type: 'session:end', session: 'plan-priority', sessionId: 'bs-priority', status: 'failed', timestamp: '2026-01-01T00:00:00.000Z' }, ['candidate']);
      recordCanonicalLifecycleEvent(cwd, { eventKey: 'ship-later', type: 'landing:complete', action: 'merge', commitSha: 'def456', timestamp: '2026-01-01T00:30:00.000Z' }, ['candidate']);

      const output = await getItemDetailProjection(cwd, { id: 'candidate', includeLifecycleRows: true });

      expect(output.item).toMatchObject({ lifecycleState: 'shipped', lane: 'done', closed: true });
      expect(output.item.reasonCodes).toContain('shipped-result');
      expect(output.item.reasonCodes).not.toContain('failed-result');
    });
  });

  it('returns associated links for recommendation, session plan, build session, and build run handoff chain', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      writeSessionPlan(cwd, 'plan-rec-running', ['candidate'], { recommendationRef: 'lane:rec:1' });
      recordCanonicalLifecycleEvent(cwd, { eventKey: 'rec-running', type: 'session:start', session: 'plan-rec-running', sessionId: 'build-session-rec', runId: 'run-rec', timestamp: '2026-01-01T00:11:00.000Z' }, ['candidate']);

      const links = await getAssociatedPlanBuildLinksForItems(cwd, { itemIds: ['candidate'] });

      expect(links).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'session-plan', session: 'plan-rec-running', affectedItemIds: ['candidate'] }),
        expect.objectContaining({ kind: 'build-run', runId: 'run-rec', buildSessionId: 'build-session-rec' }),
        expect.objectContaining({ kind: 'build-session', buildSessionId: 'build-session-rec' }),
      ]));
      expect(JSON.stringify(links)).toContain('lane:rec:1');
    });
  });

  it.each([
    ['merged', 'merged-result'],
    ['partial', 'partial-plan'],
  ])('treats current %s result evidence as an eligibility blocker', async (state, reasonCode) => {
    await withTempProjectionProject(async (cwd) => {
      captureCanonicalBacklogItem(cwd, { id: `result-${state}`, title: `Result ${state}`, status: 'candidate' });
      withCanonicalTransaction(cwd, (store) => recordLifecycleEvidence(store, { evidenceKey: `result-${state}`, itemRef: `result-${state}`, itemId: `result-${state}`, lifecycleState: state as never, reasonCode, evidenceKind: 'event', status: state, isCurrent: true, isTerminal: true, occurredAt: '2026-01-01T00:00:00.000Z', links: { url: `https://example.test/${state}` } }));

      const output = await getItemDetailProjection(cwd, { id: `result-${state}`, includeLifecycleRows: true });

      expect(output.item).toMatchObject({ planEligible: false, planEligibilityReasonCode: reasonCode, planEligibilityReasonMessage: expect.stringContaining(reasonCode), planEligibilityLinks: expect.arrayContaining([expect.objectContaining({ itemIds: [`result-${state}`] })]) });
    });
  });

  it('distinguishes nonterminal duplicate coverage from terminal-only evidence', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);

      const runningCoverage = await findNonterminalCoverage(cwd, { itemIds: ['running'] });
      const shippedCoverage = await findNonterminalCoverage(cwd, { itemIds: ['shipped'] });
      const shippedIncluded = await findNonterminalCoverage(cwd, { itemIds: ['shipped'], includeTerminalReasons: true });

      expect(runningCoverage.ok).toBe(false);
      expect(runningCoverage.entries).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: 'running', reasonCode: 'running-build', terminal: false })]));
      expect(shippedCoverage.ok).toBe(false);
      expect(shippedCoverage.entries).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: 'shipped', reasonCode: 'shipped-result', terminal: true })]));
      expect(shippedIncluded.entries).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: 'shipped', reasonCode: 'shipped-result', terminal: true })]));
    });
  });
});
