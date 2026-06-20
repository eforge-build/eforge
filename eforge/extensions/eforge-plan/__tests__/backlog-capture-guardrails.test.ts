import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import eforgePlanExtension from '../index.js';
import { captureReadinessIssues } from '../backlog-capture-guardrails.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-capture-guardrails-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function loadRegistry(cwd: string) {
  const { api, state } = createExtensionRecorder('eforge-plan', join(cwd, 'eforge/extensions/eforge-plan/index.ts'));
  eforgePlanExtension(api as never);
  return { ...state, extensions: [], candidates: [] };
}

describe('backlog capture readiness guardrails', () => {
  it('accepts implementation-shaped items with concrete acceptance criteria', () => {
    expect(captureReadinessIssues({
      title: 'Add capture readiness guardrails',
      claim: 'Require backlog captures to include concrete work and acceptance criteria before they enter planning.',
      acceptanceCriteria: 'Capture accepts implementation-shaped backlog items with verifiable criteria and rejects vague planning topics.',
      tags: ['backlog', 'ux'],
    })).toEqual([]);
  });

  it('flags exploration-shaped captures before they enter the backlog', () => {
    const issues = captureReadinessIssues({
      title: 'Explore auto-mode backlog draining',
      claim: 'Revisit whether eforge-plan should drain the backlog automatically in the future.',
      acceptanceCriteria: 'Decide whether auto-mode is a good idea.',
      tags: ['future'],
    });
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('title contains exploratory language'),
      expect.stringContaining('claim contains exploratory language'),
      expect.stringContaining('acceptanceCriteria contains exploratory language'),
      expect.stringContaining('tags mark the item as exploratory'),
      expect.stringContaining('Title or claim should state the implementation change'),
    ]));
    // Exactly the five expected issues fire - no spurious over-flagging.
    expect(issues).toHaveLength(5);
  });

  it('flags missing acceptance criteria', () => {
    expect(captureReadinessIssues({
      title: 'Add capture readiness guardrails',
      claim: 'Require backlog captures to include concrete work before planning.',
      acceptanceCriteria: '   ',
    })).toEqual(['Acceptance criteria are required.']);
  });

  it('flags placeholder acceptance criteria', () => {
    expect(captureReadinessIssues({
      title: 'Add capture readiness guardrails',
      claim: 'Require backlog captures to include concrete work before planning.',
      acceptanceCriteria: 'Missing acceptance criteria: add concrete, verifiable done conditions before build handoff.',
    })).toEqual(['Acceptance criteria must be concrete and verifiable, not placeholder guidance.']);
  });

  it('flags topic-only captures with no actionable implementation verb', () => {
    expect(captureReadinessIssues({
      title: 'Backlog drain policy',
      claim: 'Backlog draining policy for eforge-plan.',
      acceptanceCriteria: 'The backlog drains down to zero open candidate items per sprint.',
    })).toEqual([
      'Title or claim should state the implementation change, not only a topic or question.',
    ]);
  });

  it('rejects capture-item action input without acceptance criteria', async () => {
    await withTempProject(async (cwd) => {
      const result = await dispatchExtensionAction(loadRegistry(cwd), {
        actionId: 'eforge-plan:capture-item',
        input: { title: 'Add missing criteria smoke item', claim: 'Add a smoke item without criteria.' },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(result.kind).toBe('invalid-input');
      expect(String(result.message)).toContain('Action input failed schema validation');
    });
  });

  it('rejects exploratory capture-item action input with guidance', async () => {
    await withTempProject(async (cwd) => {
      const result = await dispatchExtensionAction(loadRegistry(cwd), {
        actionId: 'eforge-plan:capture-item',
        input: {
          title: 'Explore host adapter options',
          claim: 'Investigate whether extensions should provide host-specific adapters.',
          acceptanceCriteria: 'Decide whether host adapters are needed.',
        },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(result.kind).toBe('invalid-input');
      expect(String(result.message)).toContain('not session-plan-ready');
      expect(String(result.message)).toContain('Do the exploration before capture');
    });
  });
});
