import { describe, expect, it } from 'vitest';
import { BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES } from '@eforge-build/client';
import { buildBacklogCurationMapReduceSourceBundle } from '../eforge/extensions/eforge-plan/backlog-curation-packets.js';

const SHA = 'a'.repeat(64);
const BODY_SHA = 'b'.repeat(64);

describe('eforge-plan backlog curation map/reduce integration bounds', () => {
  it('builds a capped reducer input without raw curation metadata sentinels', () => {
    const rawBodySentinel = 'FULL_ITEM_BODY_SENTINEL_SHOULD_NOT_REACH_REDUCER';
    const gitDeltaSentinel = 'RAW_GIT_DELTA_SENTINEL_SHOULD_NOT_REACH_REDUCER';
    const auditSentinel = 'RAW_FULL_IMPLEMENTATION_AUDIT_SENTINEL_SHOULD_NOT_REACH_REDUCER';
    const source = {
      schemaVersion: 1,
      purpose: 'backlog-curation',
      sourceFingerprint: SHA,
      generatedAt: '2026-01-01T00:00:00.000Z',
      curationGuidance: { instruction: 'Audit every item with current source as closure authority.' },
      openItems: Array.from({ length: 24 }, (_, index) => ({
        id: `item-${index}`,
        title: `Item ${index}`,
        status: 'planned',
        precondition: { id: `item-${index}`, bodySha256: BODY_SHA, recordSha256: BODY_SHA, sourceFingerprint: SHA },
        sections: { Body: `${rawBodySentinel}-${index} ${'x'.repeat(12_000)}` },
      })),
      dependencyDetails: [],
      roadmapContext: { entries: [] },
      recommendations: { exists: false, modelSummary: null, modelHash: null },
      gitDelta: { raw: `${gitDeltaSentinel}${'g'.repeat(100_000)}` },
      fullImplementationAudit: { raw: `${auditSentinel}${'f'.repeat(100_000)}`, items: [] },
    };

    const bundle = buildBacklogCurationMapReduceSourceBundle(source);
    const reducerJson = JSON.stringify(bundle.reducerInput);
    expect(Buffer.byteLength(reducerJson, 'utf-8')).toBeLessThanOrEqual(BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES);
    expect(reducerJson).not.toContain(rawBodySentinel);
    expect(reducerJson).not.toContain(gitDeltaSentinel);
    expect(reducerJson).not.toContain(auditSentinel);
  });
});
