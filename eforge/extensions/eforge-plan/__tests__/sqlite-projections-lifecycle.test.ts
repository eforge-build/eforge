import { describe, expect, it } from 'vitest';
import { recordCanonicalLifecycleEvent } from '../canonical/lifecycle-records.js';
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

  it('distinguishes nonterminal duplicate coverage from terminal-only evidence', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);

      const runningCoverage = await findNonterminalCoverage(cwd, { itemIds: ['running'] });
      const shippedHidden = await findNonterminalCoverage(cwd, { itemIds: ['shipped'] });
      const shippedIncluded = await findNonterminalCoverage(cwd, { itemIds: ['shipped'], includeTerminalReasons: true });

      expect(runningCoverage.ok).toBe(false);
      expect(runningCoverage.entries).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: 'running', reasonCode: 'running-build', terminal: false })]));
      expect(shippedHidden.entries).toEqual([]);
      expect(shippedIncluded.entries).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: 'shipped', reasonCode: 'shipped-result', terminal: true })]));
    });
  });
});
