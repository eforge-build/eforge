import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX,
  BACKLOG_CURATION_DIAGNOSTICS_PER_PACKET_MAX,
  BACKLOG_CURATION_FINDING_MAX_BYTES,
  BACKLOG_CURATION_HISTORICAL_HINTS_PER_ITEM_MAX,
  BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION,
  BACKLOG_CURATION_RECOMMENDATION_SIGNALS_PER_ITEM_MAX,
  BacklogCurationMapReduceFindingSchema,
  BacklogCurationMapReduceItemOutcomeSchema,
  BacklogCurationMapReduceItemPacketSchema,
  BacklogCurationMapReduceReducerInputSchema,
  BacklogCurationMapReduceRuntimeIdentitySchema,
  safeParseBacklogCurationMapReduceFinding,
  safeParseBacklogCurationMapReduceItemOutcome,
  safeParseBacklogCurationMapReduceReducerInput,
  safeParseBacklogCurationMapReduceSourceBundle,
} from '../index.js';

const SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);
const runtimeIdentity = { provider: 'pi', modelId: 'claude-sonnet-4' };
const packet = {
  schemaVersion: BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION,
  kind: 'item',
  sourceFingerprint: SHA,
  itemId: 'item-1',
  itemTitle: 'Item 1',
  metadata: { status: 'candidate' },
  precondition: { kind: 'item', id: 'item-1', bodySha256: SHA, sourceFingerprint: SHA, recordSha256: OTHER_SHA },
  bodySha256: SHA,
  recordSha256: OTHER_SHA,
  sectionSummaries: [{ heading: 'Claim', text: 'Do the work.' }],
  dependencyFacts: [],
  currentSourceCitations: [],
  historicalHints: [],
  recommendationSignals: [],
  diagnostics: [],
};
const finding = {
  schemaVersion: BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION,
  itemId: 'item-1',
  sourceFingerprint: SHA,
  packetSha256: OTHER_SHA,
  bodySha256: SHA,
  promptVersion: 'prompt-v1',
  runtimeIdentity,
  disposition: 'recheck',
  summary: 'No change.',
  rationale: 'Current source did not prove closure.',
  citations: [],
  recommendationSignals: [],
  diagnostics: [],
};

const auditedOutcome = { schemaVersion: 1, outcome: 'audited-finding', itemId: 'item-1', sourceFingerprint: SHA, packetSha256: OTHER_SHA, bodySha256: SHA, diagnostics: [], finding };
const globalContext = {
  schemaVersion: 1,
  purpose: 'backlog-curation-map-reduce',
  sourceFingerprint: SHA,
  curationGuidance: ['Use current source as closure authority.'],
  caps: { packetBytes: 1 },
  itemCount: 1,
  openItemIds: ['item-1'],
  roadmapSummaries: [],
  dependencySummaries: [],
  recommendationSummaries: [],
  diagnostics: [],
};

describe('backlog curation map/reduce schemas', () => {
  it('accepts valid packets, findings, outcomes, reducer input, and runtime identity', () => {
    expect(Value.Check(BacklogCurationMapReduceRuntimeIdentitySchema, runtimeIdentity)).toBe(true);
    expect(Value.Check(BacklogCurationMapReduceItemPacketSchema, packet)).toBe(true);
    expect(Value.Check(BacklogCurationMapReduceFindingSchema, finding)).toBe(true);
    expect(Value.Check(BacklogCurationMapReduceItemOutcomeSchema, auditedOutcome)).toBe(true);
    expect(Value.Check(BacklogCurationMapReduceReducerInputSchema, { schemaVersion: 1, sourceFingerprint: SHA, globalContext, outcomes: [auditedOutcome], diagnostics: [] })).toBe(true);
  });

  it('accepts all required outcome variants and rejects unknown variants', () => {
    const variants = [
      { outcome: 'cache-hit', finding },
      { outcome: 'audited-finding', finding },
      { outcome: 'oversized-packet', byteLength: 10, byteCap: 5 },
      { outcome: 'item-agent-failure', error: 'failed' },
      { outcome: 'invalid-finding', validationErrors: ['bad'] },
      { outcome: 'cancelled', reason: 'cancelled' },
    ];
    for (const variant of variants) {
      expect(Value.Check(BacklogCurationMapReduceItemOutcomeSchema, { schemaVersion: 1, itemId: 'item-1', sourceFingerprint: SHA, diagnostics: [], ...variant })).toBe(true);
    }
    expect(Value.Check(BacklogCurationMapReduceItemOutcomeSchema, { schemaVersion: 1, outcome: 'mystery', itemId: 'item-1', sourceFingerprint: SHA, diagnostics: [] })).toBe(false);
  });

  it('rejects unknown top-level properties', () => {
    expect(Value.Check(BacklogCurationMapReduceItemPacketSchema, { ...packet, extra: true })).toBe(false);
    expect(Value.Check(BacklogCurationMapReduceFindingSchema, { ...finding, extra: true })).toBe(false);
    expect(Value.Check(BacklogCurationMapReduceItemOutcomeSchema, { ...auditedOutcome, extra: true })).toBe(false);
    expect(Value.Check(BacklogCurationMapReduceReducerInputSchema, { schemaVersion: 1, sourceFingerprint: SHA, globalContext, outcomes: [auditedOutcome], diagnostics: [], extra: true })).toBe(false);
  });

  it('requires packet precondition source and record hashes', () => {
    const { sourceFingerprint: _sourceFingerprint, ...withoutSourceFingerprint } = packet.precondition;
    const { recordSha256: _recordSha256, ...withoutRecordSha256 } = packet.precondition;
    expect(Value.Check(BacklogCurationMapReduceItemPacketSchema, { ...packet, precondition: withoutSourceFingerprint })).toBe(false);
    expect(Value.Check(BacklogCurationMapReduceItemPacketSchema, { ...packet, precondition: withoutRecordSha256 })).toBe(false);
  });

  it('enforces finding string and array caps', () => {
    expect(Value.Check(BacklogCurationMapReduceFindingSchema, { ...finding, summary: 'x'.repeat(BACKLOG_CURATION_FINDING_MAX_BYTES) })).toBe(false);
    expect(Value.Check(BacklogCurationMapReduceFindingSchema, { ...finding, citations: Array.from({ length: BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX + 1 }, () => ({ kind: 'current-source', source: 'src' })) })).toBe(false);
    expect(Value.Check(BacklogCurationMapReduceFindingSchema, { ...finding, recommendationSignals: Array.from({ length: BACKLOG_CURATION_RECOMMENDATION_SIGNALS_PER_ITEM_MAX + 1 }, () => ({ source: 'recommendations', signal: 'x' })) })).toBe(false);
    expect(Value.Check(BacklogCurationMapReduceFindingSchema, { ...finding, diagnostics: Array.from({ length: BACKLOG_CURATION_DIAGNOSTICS_PER_PACKET_MAX + 1 }, () => ({ code: 'cap', severity: 'info' })) })).toBe(false);
    expect(Value.Check(BacklogCurationMapReduceItemPacketSchema, { ...packet, historicalHints: Array.from({ length: BACKLOG_CURATION_HISTORICAL_HINTS_PER_ITEM_MAX + 1 }, () => ({ source: 'history', closureAuthority: false })) })).toBe(false);
  });

  it('enforces finding total byte caps at the shared parse boundary', () => {
    const oversized = oversizedSchemaValidFinding();
    expect(Value.Check(BacklogCurationMapReduceFindingSchema, oversized)).toBe(true);
    expect(safeParseBacklogCurationMapReduceFinding(oversized).success).toBe(false);
  });

  it('enforces nested finding byte caps in item outcomes, reducer inputs, and source bundles', () => {
    const oversized = oversizedSchemaValidFinding();
    const outcome = { ...auditedOutcome, finding: oversized };
    const reducerInput = { schemaVersion: 1, sourceFingerprint: SHA, globalContext, outcomes: [outcome], diagnostics: [] };
    const sourceBundle = { schemaVersion: 1, sourceFingerprint: SHA, globalContext, packets: [packet], degradedOutcomes: [], reducerInput };

    const outcomeResult = safeParseBacklogCurationMapReduceItemOutcome(outcome);
    expect(outcomeResult.success).toBe(false);
    if (!outcomeResult.success) expect(outcomeResult.error.message).toContain('finding:');

    const reducerResult = safeParseBacklogCurationMapReduceReducerInput(reducerInput);
    expect(reducerResult.success).toBe(false);
    if (!reducerResult.success) expect(reducerResult.error.message).toContain('outcomes/0/finding:');

    const bundleResult = safeParseBacklogCurationMapReduceSourceBundle(sourceBundle);
    expect(bundleResult.success).toBe(false);
    if (!bundleResult.success) expect(bundleResult.error.message).toContain('reducerInput/outcomes/0/finding:');
  });
});

function oversizedSchemaValidFinding() {
  return {
    ...finding,
    summary: 's'.repeat(1_900),
    rationale: 'r'.repeat(2_900),
    citations: Array.from({ length: BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX }, (_, index) => ({ kind: 'current-source', source: `source-${index}`, excerpt: 'e'.repeat(900) })),
  };
}
