import { describe, expect, it } from 'vitest';
import * as client from '../index.js';

const removedSection = ['play', 'book', 'Draft'].join('');
const removedTypeExport = ['EforgePlan', 'Planning', 'Playbook', 'Draft'].join('');

const baseResult = {
  summary: 'Drafted planning output.',
  assumptionsOpenQuestions: [],
};

function completedRecord(result: unknown) {
  return {
    taskId: 'task-neutrality',
    kind: 'eforge-plan.planning-draft',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    result,
  };
}

describe('extension agent task planning contract neutrality', () => {
  it('accepts every remaining requested output section and rejects the removed one', () => {
    const remainingSections = [
      'recommendations',
      'handoffDrafts',
      'planDrafts',
      'sessionPlanPatch',
      'sessionPlanCreationDraft',
      'backlogCurationDraft',
      'planRevisionTurn',
    ];
    for (const section of remainingSections) {
      const request = { kind: 'eforge-plan.planning-draft', input: { topic: 'Plan it', requestedOutputSections: [section] } };
      expect(client.safeParseExtensionAgentTaskStartRequest(request).success, section).toBe(true);
    }

    const request = { kind: 'eforge-plan.planning-draft', input: { topic: 'Plan it', requestedOutputSections: [removedSection] } };
    expect(client.safeParseExtensionAgentTaskStartRequest(request).success).toBe(false);
  });

  it('accepts remaining planning result sections', () => {
    const accepted = [
      { recommendations: { schemaVersion: 1, activeWork: [], readyCandidates: [], recommendedNextSequence: [], safeParallelizableGroups: [], blockedChains: [], rationaleAndAssumptions: [] } },
      { backlogCurationDraft: { schemaVersion: 1, sourceFingerprint: 'a'.repeat(64), summary: [], itemChanges: [], epicChanges: [], noOpRechecks: [], skipped: [], needsInput: [] } },
      { handoffDraft: { selection: {} } },
      { handoffDrafts: [{ selection: {} }] },
      { planDrafts: [{ title: 'Plan', body: 'Body.' }] },
      { sessionPlanPatch: { sections: [{ dimension: 'scope', content: 'Scope.' }] } },
      { decision: 'ready', sessionPlanCreationDraft: { session: 'session-one', topic: 'Topic', planningType: 'feature', planningDepth: 'focused', sections: [{ dimension: 'scope', content: 'Scope.' }] } },
      { planRevisionTurn: { schemaVersion: 1, targetSession: 'session-one', basePlanFingerprint: 'a'.repeat(64), assistantMessage: 'Answer.', noPatchReason: 'No changes needed.' } },
    ];
    for (const output of accepted) expect(client.safeParseEforgePlanPlanningDraftResult({ ...baseResult, ...output }).success).toBe(true);
  });

  it('rejects results and completed records carrying the removed draft field', () => {
    const removedOnly = { ...baseResult, [removedSection]: { name: 'Draft', body: 'Body.' } };
    const removedWithAccepted = { ...baseResult, planDrafts: [{ title: 'Plan', body: 'Body.' }], [removedSection]: { name: 'Draft', body: 'Body.' } };
    expect(client.safeParseEforgePlanPlanningDraftResult(removedOnly).success).toBe(false);
    expect(client.safeParseEforgePlanPlanningDraftResult(removedWithAccepted).success).toBe(false);
    expect(client.safeParseExtensionAgentTaskRecord(completedRecord(removedWithAccepted)).success).toBe(false);
  });

  it('does not expose the removed draft schema export at runtime', () => {
    expect(Object.prototype.hasOwnProperty.call(client, `${removedTypeExport}Schema`)).toBe(false);
  });
});
