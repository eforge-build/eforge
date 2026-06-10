import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  EforgePlanPlanningBacklogCurationDraftSchema,
  EforgePlanPlanningBacklogCurationRecordPatchSchema,
  hasEforgePlanPlanningDraftOutputSection,
  parseEforgePlanPlanningDraftResult,
  safeParseEforgePlanPlanningDraftResult,
  safeParseExtensionAgentTaskRecord,
  safeParseExtensionAgentTaskStartRequest,
} from '../index.js';

const BODY_SHA = 'a'.repeat(64);
const EPIC_BODY_SHA = 'b'.repeat(64);
const RECORD_SHA = 'c'.repeat(64);
const UNCHANGED_BODY_SHA = 'd'.repeat(64);

const validBacklogCurationDraft = {
  schemaVersion: 1,
  sourceFingerprint: '1111111111111111111111111111111111111111111111111111111111111111',
  generatedAt: '2026-01-01T00:00:00.000Z',
  summary: ['Curated stale backlog records.'],
  itemChanges: [{
    id: 'item-1',
    kind: 'item',
    precondition: { id: 'item-1', kind: 'item', bodySha256: BODY_SHA, sourceFingerprint: '1111111111111111111111111111111111111111111111111111111111111111' },
    metadata: { status: 'active', priority: 'high', tags: ['curated'], depends_on: ['item-0'], epic: 'epic-1', last_checked: '2026-01-01', stale_after: '2026-02-01' },
    sectionOperations: [{ heading: 'Evidence', action: 'append', content: 'Durable evidence from source text.' }],
    rationale: 'The item has fresh implementation evidence.',
    evidence: ['Source text says the implementation is still active.'],
  }],
  epicChanges: [{
    id: 'epic-1',
    kind: 'epic',
    precondition: { id: 'epic-1', kind: 'epic', bodySha256: EPIC_BODY_SHA, recordSha256: RECORD_SHA },
    metadata: { priority: 'high' },
    rationale: 'The epic needs priority alignment with active items.',
  }],
  noOpRechecks: [{
    id: 'item-2',
    kind: 'item',
    precondition: { id: 'item-2', kind: 'item', bodySha256: UNCHANGED_BODY_SHA },
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

  it('rejects non-hex or wrong-length curation fingerprints and hashes', () => {
    for (const sourceFingerprint of ['not-a-sha', 'a'.repeat(63), 'g'.repeat(64)]) {
      expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, { ...validBacklogCurationDraft, sourceFingerprint })).toBe(false);
    }
    expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, {
      ...validBacklogCurationDraft,
      itemChanges: [{ ...validBacklogCurationDraft.itemChanges[0], precondition: { ...validBacklogCurationDraft.itemChanges[0].precondition, bodySha256: 'z'.repeat(64) } }],
    })).toBe(false);
    expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, {
      ...validBacklogCurationDraft,
      epicChanges: [{ ...validBacklogCurationDraft.epicChanges[0], precondition: { ...validBacklogCurationDraft.epicChanges[0].precondition, recordSha256: 'c'.repeat(63) } }],
    })).toBe(false);
    expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, {
      ...validBacklogCurationDraft,
      noOpRechecks: [{ ...validBacklogCurationDraft.noOpRechecks[0], precondition: { ...validBacklogCurationDraft.noOpRechecks[0].precondition, sourceFingerprint: 'A'.repeat(64) } }],
    })).toBe(false);
  });

  it('accepts source-provided curation precondition metadata', () => {
    expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, {
      ...validBacklogCurationDraft,
      itemChanges: [{
        ...validBacklogCurationDraft.itemChanges[0],
        precondition: { ...validBacklogCurationDraft.itemChanges[0].precondition, origin: 'private', relativePath: '.eforge/storage/extensions/eforge-plan/backlog/items/item-1.md' },
      }],
    })).toBe(true);
  });

  it('rejects unsafe curation ids, references, and statuses', () => {
    for (const id of ['nested/item', 'nested\\item', '.', '..', 'bad\0id']) {
      expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, { ...validBacklogCurationDraft, itemChanges: [{ ...validBacklogCurationDraft.itemChanges[0], id }] })).toBe(false);
      expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, { ...validBacklogCurationDraft, itemChanges: [{ ...validBacklogCurationDraft.itemChanges[0], precondition: { ...validBacklogCurationDraft.itemChanges[0].precondition, id } }] })).toBe(false);
      expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, { ...validBacklogCurationDraft, noOpRechecks: [{ ...validBacklogCurationDraft.noOpRechecks[0], id }] })).toBe(false);
      expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, { ...validBacklogCurationDraft, skipped: [{ id, kind: 'item', reason: 'skip' }] })).toBe(false);
      expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, { ...validBacklogCurationDraft, needsInput: [{ id, kind: 'item', question: 'Question?' }] })).toBe(false);
    }

    expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, {
      ...validBacklogCurationDraft,
      itemChanges: [{
        ...validBacklogCurationDraft.itemChanges[0],
        metadata: { ...validBacklogCurationDraft.itemChanges[0].metadata, depends_on: ['nested/item'] },
      }],
    })).toBe(false);

    expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, {
      ...validBacklogCurationDraft,
      itemChanges: [{
        ...validBacklogCurationDraft.itemChanges[0],
        metadata: { ...validBacklogCurationDraft.itemChanges[0].metadata, epic: '../epic' },
      }],
    })).toBe(false);

    expect(Value.Check(EforgePlanPlanningBacklogCurationDraftSchema, {
      ...validBacklogCurationDraft,
      itemChanges: [{
        ...validBacklogCurationDraft.itemChanges[0],
        metadata: { ...validBacklogCurationDraft.itemChanges[0].metadata, status: 'blocked' },
      }],
    })).toBe(false);
  });

  it('rejects standalone curation patches with mismatched kind and precondition kind', () => {
    expect(Value.Check(EforgePlanPlanningBacklogCurationRecordPatchSchema, validBacklogCurationDraft.itemChanges[0])).toBe(true);
    expect(Value.Check(EforgePlanPlanningBacklogCurationRecordPatchSchema, {
      ...validBacklogCurationDraft.itemChanges[0],
      precondition: { ...validBacklogCurationDraft.itemChanges[0].precondition, kind: 'epic' },
    })).toBe(false);
  });

  it('requires non-empty rationale for material curation patches', () => {
    const { rationale: _missingItemRationale, ...itemWithoutRationale } = validBacklogCurationDraft.itemChanges[0];
    expect(Value.Check(EforgePlanPlanningBacklogCurationRecordPatchSchema, itemWithoutRationale)).toBe(false);
    expect(Value.Check(EforgePlanPlanningBacklogCurationRecordPatchSchema, {
      ...validBacklogCurationDraft.epicChanges[0],
      rationale: '   ',
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

  it('validates completed task records carrying curation plus recommendations output', () => {
    expect(safeParseExtensionAgentTaskRecord({
      taskId: 'task-curation',
      kind: 'eforge-plan.planning-draft',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      metadata: { outputSectionCount: 2 },
      result: {
        summary: 'Drafted backlog curation and recommendations.',
        assumptionsOpenQuestions: [],
        backlogCurationDraft: validBacklogCurationDraft,
        recommendations,
      },
    }).success).toBe(true);
  });

  it('rejects completed task records with malformed curation output before persistence', () => {
    expect(safeParseExtensionAgentTaskRecord({
      taskId: 'task-curation-malformed',
      kind: 'eforge-plan.planning-draft',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      result: {
        summary: 'Drafted malformed backlog curation.',
        assumptionsOpenQuestions: [],
        backlogCurationDraft: {
          ...validBacklogCurationDraft,
          itemChanges: [{ ...validBacklogCurationDraft.itemChanges[0], precondition: { id: 'item-1', kind: 'item' } }],
        },
      },
    }).success).toBe(false);
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
      summary: 'Missing precondition hash.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        itemChanges: [{ ...validBacklogCurationDraft.itemChanges[0], precondition: { id: 'item-1', kind: 'item' } }],
      },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Mismatched item change kind.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        itemChanges: [{ ...validBacklogCurationDraft.itemChanges[0], kind: 'epic', precondition: { ...validBacklogCurationDraft.itemChanges[0].precondition, kind: 'epic' } }],
      },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Mismatched epic change kind.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        epicChanges: [{ ...validBacklogCurationDraft.epicChanges[0], kind: 'item', precondition: { ...validBacklogCurationDraft.epicChanges[0].precondition, kind: 'item' } }],
      },
    }).success).toBe(false);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Mismatched no-op recheck kind.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        noOpRechecks: [{
          ...validBacklogCurationDraft.noOpRechecks[0],
          precondition: { ...validBacklogCurationDraft.noOpRechecks[0].precondition, kind: 'epic' },
        }],
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
    const needsInputResult = {
      summary: 'Need clarification before drafting.',
      assumptionsOpenQuestions: [],
      decision: 'needs-input' as const,
      clarificationQuestions: [{ question: 'Which curation scope should be used?' }],
      rationale: 'The requested scope is ambiguous.',
    };
    expect(safeParseEforgePlanPlanningDraftResult({
      ...needsInputResult,
      backlogCurationDraft: validBacklogCurationDraft,
    }).success).toBe(false);
    expect(hasEforgePlanPlanningDraftOutputSection(needsInputResult)).toBe(false);
  });
});
