import { describe, expect, it } from 'vitest';
import {
  EforgePlanPlanningPlanRevisionTurnSchema,
  hasEforgePlanPlanningDraftOutputSection,
  parseEforgePlanPlanningDraftResult,
  parseExtensionAgentTaskRecord,
  safeParseEforgePlanPlanningDraftResult,
  safeParseExtensionAgentTaskRecord,
  safeParseExtensionAgentTaskStartRequest,
  type EforgePlanPlanningPlanRevisionTurn,
  type ExtensionAgentTaskRecord,
} from '../index.js';
import {
  EforgePlanPlanningPlanRevisionTurnSchema as BrowserPlanRevisionTurnSchema,
  safeParseEforgePlanPlanningDraftResult as browserSafeParseEforgePlanPlanningDraftResult,
  type EforgePlanPlanningPlanRevisionTurn as BrowserPlanRevisionTurn,
} from '../browser.js';

const BASE_SHA = '1'.repeat(64);
const SCOPE_SHA = '2'.repeat(64);
const ACCEPTANCE_SHA = '3'.repeat(64);

const answerOnlyTurn = {
  schemaVersion: 1,
  targetSession: 'demo-session',
  assistantMessage: 'The current scope already answers the question; no patch is needed.',
  basePlanFingerprint: BASE_SHA,
  noPatchReason: 'The requested change is already covered by the plan.',
};

const patchBearingTurn = {
  schemaVersion: 1,
  targetSession: 'demo-session',
  assistantMessage: 'I propose updates to scope and acceptance criteria.',
  basePlanFingerprint: BASE_SHA,
  baseSectionHashes: [
    { dimension: 'scope', sha256: SCOPE_SHA },
    { dimension: 'acceptance-criteria', sha256: ACCEPTANCE_SHA },
  ],
  proposedPatch: {
    sections: [
      { dimension: 'scope', content: 'Narrow the scope to revision-session contract work.', rationale: 'Keeps the turn bounded.' },
      { dimension: 'acceptance-criteria', content: 'Accept when answer-only and patch-bearing turns parse.' },
    ],
    metadata: { openQuestions: ['Confirm whether UI apply semantics are in scope.'] },
    skippedDimensions: [{ dimension: 'risks', reason: 'No risk changes requested.' }],
  },
  citations: [{ label: 'Existing plan', excerpt: 'Scope section excerpt.', path: '.eforge/session-plans/demo.md' }],
  applyGuidance: 'Apply only if the base fingerprint still matches.',
};

function completedRecord(result: unknown): ExtensionAgentTaskRecord {
  return {
    taskId: 'task-revision',
    kind: 'eforge-plan.planning-draft',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    metadata: { outputSectionCount: 1 },
    result,
  } as ExtensionAgentTaskRecord;
}

describe('eforge-plan plan revision turn contract', () => {
  it('exports planRevisionTurn schemas and compatible types from node and browser barrels', () => {
    expect(EforgePlanPlanningPlanRevisionTurnSchema.properties.schemaVersion).toBeDefined();
    expect(BrowserPlanRevisionTurnSchema.properties.basePlanFingerprint).toBeDefined();
    const browserTurn = answerOnlyTurn as BrowserPlanRevisionTurn;
    const nodeTurn: EforgePlanPlanningPlanRevisionTurn = browserTurn;
    expect(nodeTurn.targetSession).toBe('demo-session');
    expect(browserSafeParseEforgePlanPlanningDraftResult({ summary: 'Browser parse.', assumptionsOpenQuestions: [], planRevisionTurn: browserTurn }).success).toBe(true);
  });

  it('accepts planRevisionTurn as a requested output section with an existing session plan', () => {
    expect(safeParseExtensionAgentTaskStartRequest({
      kind: 'eforge-plan.planning-draft',
      input: { topic: 'Revise scope', existingSessionPlan: '# Scope\nCurrent plan.', requestedOutputSections: ['planRevisionTurn'] },
      requestedBy: { host: 'console', surface: 'workstation:eforge-plan' },
    }).success).toBe(true);
  });

  it('parses answer-only revision turns and completed records', () => {
    const result = parseEforgePlanPlanningDraftResult({ summary: 'Answered without a patch.', assumptionsOpenQuestions: [], planRevisionTurn: answerOnlyTurn });
    expect((result as { planRevisionTurn: typeof answerOnlyTurn }).planRevisionTurn.targetSession).toBe('demo-session');
    expect(hasEforgePlanPlanningDraftOutputSection(result)).toBe(true);
    expect(safeParseExtensionAgentTaskRecord(completedRecord(result)).success).toBe(true);
  });

  it('parses patch-bearing revision turns and round-trips completed records', () => {
    const result = parseEforgePlanPlanningDraftResult({ summary: 'Drafted patch-bearing revision.', assumptionsOpenQuestions: [], planRevisionTurn: patchBearingTurn });
    const parsedRecord = parseExtensionAgentTaskRecord(JSON.parse(JSON.stringify(completedRecord(result))));
    expect(parsedRecord.status).toBe('completed');
    if (parsedRecord.status !== 'completed') throw new Error('Expected completed record');
    const turn = (parsedRecord.result as { planRevisionTurn: typeof patchBearingTurn }).planRevisionTurn;
    expect(turn.targetSession).toBe('demo-session');
    expect(turn.proposedPatch?.sections).toHaveLength(2);
    expect(hasEforgePlanPlanningDraftOutputSection(parsedRecord.result)).toBe(true);
  });

  it('rejects malformed revision-turn payloads fail-closed', () => {
    expect(safeParseEforgePlanPlanningDraftResult({ summary: 'Invalid sha.', assumptionsOpenQuestions: [], planRevisionTurn: { ...answerOnlyTurn, basePlanFingerprint: 'not-a-sha' } }).success).toBe(false);
    expect(safeParseEforgePlanPlanningDraftResult({ summary: 'Empty message.', assumptionsOpenQuestions: [], planRevisionTurn: { ...answerOnlyTurn, assistantMessage: '   ' } }).success).toBe(false);
    expect(safeParseEforgePlanPlanningDraftResult({ summary: 'Missing target.', assumptionsOpenQuestions: [], planRevisionTurn: { ...answerOnlyTurn, targetSession: '' } }).success).toBe(false);
    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Missing content.',
      assumptionsOpenQuestions: [],
      planRevisionTurn: { ...patchBearingTurn, proposedPatch: { sections: [{ dimension: 'scope' }] } },
    }).success).toBe(false);
    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Empty patch dimension.',
      assumptionsOpenQuestions: [],
      planRevisionTurn: { ...patchBearingTurn, proposedPatch: { sections: [{ dimension: '', content: 'x' }] } },
    }).success).toBe(false);
    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Unexpected nested field.',
      assumptionsOpenQuestions: [],
      planRevisionTurn: { ...answerOnlyTurn, citations: [{ label: 'doc', unexpected: true }] },
    }).success).toBe(false);
  });

  it('keeps top-level needs-input clarification output-free', () => {
    const needsInput = {
      summary: 'Need clarification before revising.',
      assumptionsOpenQuestions: [],
      decision: 'needs-input' as const,
      clarificationQuestions: [{ question: 'Which section should be revised?' }],
      rationale: 'The requested dimension is ambiguous.',
    };
    expect(hasEforgePlanPlanningDraftOutputSection(parseEforgePlanPlanningDraftResult(needsInput))).toBe(false);
    expect(safeParseEforgePlanPlanningDraftResult({ ...needsInput, planRevisionTurn: answerOnlyTurn }).success).toBe(false);
    expect(safeParseEforgePlanPlanningDraftResult({ ...needsInput, sessionPlanPatch: { sections: [{ dimension: 'scope', content: 'x' }] } }).success).toBe(false);
  });
});
