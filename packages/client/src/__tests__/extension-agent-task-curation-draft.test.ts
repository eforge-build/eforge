import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  EforgePlanPlanningBacklogCurationDraftSchema,
  hasEforgePlanPlanningDraftOutputSection,
  parseEforgePlanPlanningDraftResult,
  safeParseEforgePlanPlanningDraftResult,
  safeParseExtensionAgentTaskStartRequest,
} from '../index.js';

const validBacklogCurationDraft = {
  schemaVersion: 1,
  sourceFingerprint: 'source-fingerprint-1',
  generatedAt: '2026-01-01T00:00:00.000Z',
  summary: ['Curated stale backlog records.'],
  itemChanges: [{
    id: 'item-1',
    kind: 'item',
    precondition: { id: 'item-1', kind: 'item', bodySha256: 'body-sha', sourceFingerprint: 'source-fingerprint-1' },
    metadata: { status: 'active', priority: 'high', tags: ['curated'], depends_on: ['item-0'], epic: 'epic-1', last_checked: '2026-01-01', stale_after: '2026-02-01' },
    sectionOperations: [{ heading: 'Evidence', action: 'append', content: 'Durable evidence from source text.' }],
    rationale: 'The item has fresh implementation evidence.',
    evidence: ['Source text says the implementation is still active.'],
  }],
  epicChanges: [{
    id: 'epic-1',
    kind: 'epic',
    precondition: { id: 'epic-1', kind: 'epic', bodySha256: 'epic-body-sha', recordSha256: 'record-sha' },
    metadata: { epic: null },
  }],
  noOpRechecks: [{
    id: 'item-2',
    kind: 'item',
    precondition: { id: 'item-2', kind: 'item', bodySha256: 'unchanged-body-sha' },
    last_checked: '2026-01-01',
    stale_after: '2026-02-01',
    rationale: 'No material change found.',
  }],
  skipped: [{ id: 'item-3', kind: 'item', reason: 'Insufficient evidence.' }],
  needsInput: [{ id: 'epic-2', kind: 'epic', question: 'Should this epic remain active?', reason: 'Source evidence conflicts.' }],
};

const recommendations = {
  schemaVersion: 1,
  activeWork: [],
  readyCandidates: [{ itemId: 'item-1' }],
  recommendedNextSequence: [],
  safeParallelizableGroups: [],
  blockedChains: [],
  rationaleAndAssumptions: [],
};

describe('eforge-plan backlog curation draft contract', () => {
  it('exports the shared curation draft schema for downstream structural validation', () => {
    expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, validBacklogCurationDraft)).toBe(true);
    expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, {
      ...validBacklogCurationDraft,
      itemChanges: [{
        ...validBacklogCurationDraft.itemChanges[0],
        metadata: { ...validBacklogCurationDraft.itemChanges[0].metadata, rawMarkdown: 'do not accept ad hoc patches' },
      }],
    })).toBe(false);
  });

  it('accepts backlogCurationDraft as a requested output section with recommendations', () => {
    expect(safeParseExtensionAgentTaskStartRequest({
      kind: 'eforge-plan.planning-draft',
      input: { topic: 'Curate backlog', requestedOutputSections: ['backlogCurationDraft', 'recommendations'] },
      requestedBy: { host: 'console', surface: 'workstation:eforge-plan' },
    }).success).toBe(true);

    expect(safeParseExtensionAgentTaskStartRequest({
      kind: 'eforge-plan.planning-draft',
      input: { topic: 'Curate backlog', requestedOutputSections: ['backlogCurationDraft', 'unsupported'] },
    }).success).toBe(false);
  });

  it('parses valid curation-only and curation-plus-recommendations ready results', () => {
    const curationOnly = {
      summary: 'Drafted curation changes.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: validBacklogCurationDraft,
    };
    const parsed = parseEforgePlanPlanningDraftResult(curationOnly);
    expect((parsed as typeof curationOnly).backlogCurationDraft.schemaVersion).toBe(1);
    expect(hasEforgePlanPlanningDraftOutputSection(parsed)).toBe(true);

    expect(safeParseEforgePlanPlanningDraftResult({
      ...curationOnly,
      recommendations,
    }).success).toBe(true);
  });

  it('rejects malformed curation draft payloads fail-closed', () => {
    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Invalid extra property.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: { ...validBacklogCurationDraft, unexpected: true },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Invalid record kind.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        itemChanges: [{ ...validBacklogCurationDraft.itemChanges[0], kind: 'task' }],
      },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Epic patches must not appear in itemChanges.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        itemChanges: [{ ...validBacklogCurationDraft.epicChanges[0] }],
      },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Item patches must not appear in epicChanges.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        epicChanges: [{ ...validBacklogCurationDraft.itemChanges[0] }],
      },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Patch and precondition kinds must match.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        itemChanges: [{
          ...validBacklogCurationDraft.itemChanges[0],
          precondition: { ...validBacklogCurationDraft.itemChanges[0].precondition, kind: 'epic' },
        }],
      },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Recheck and precondition kinds must match.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        noOpRechecks: [{
          ...validBacklogCurationDraft.noOpRechecks[0],
          precondition: { ...validBacklogCurationDraft.noOpRechecks[0].precondition, kind: 'epic' },
        }],
      },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Missing precondition hash.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        itemChanges: [{ ...validBacklogCurationDraft.itemChanges[0], precondition: { id: 'item-1', kind: 'item' } }],
      },
    }).success).toBe(false);

    const { needsInput: _needsInput, ...missingRequiredArray } = validBacklogCurationDraft;
    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Missing required arrays.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: missingRequiredArray,
    }).success).toBe(false);
  });

  it('requires curation preview arrays and non-empty structural fields', () => {
    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Draft summary must be structured.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: { ...validBacklogCurationDraft, summary: 'not an array' },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Patch evidence must be structured.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        itemChanges: [{ ...validBacklogCurationDraft.itemChanges[0], evidence: 'not an array' }],
      },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Source fingerprint must not be blank.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: { ...validBacklogCurationDraft, sourceFingerprint: '   ' },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Headings must not be blank.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        itemChanges: [{
          ...validBacklogCurationDraft.itemChanges[0],
          sectionOperations: [{ heading: ' ', action: 'append', content: 'Evidence.' }],
        }],
      },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Reasons and questions must not be blank.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        skipped: [{ id: 'item-3', kind: 'item', reason: ' ' }],
        needsInput: [{ id: 'epic-2', kind: 'epic', question: ' ' }],
      },
    }).success).toBe(false);
  });

  it('keeps the top-level needs-input result variant output-free', () => {
    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Need clarification before drafting.',
      assumptionsOpenQuestions: [],
      decision: 'needs-input',
      clarificationQuestions: [{ question: 'Which curation scope should be used?' }],
      rationale: 'The requested scope is ambiguous.',
      backlogCurationDraft: validBacklogCurationDraft,
    }).success).toBe(false);
  });
});
