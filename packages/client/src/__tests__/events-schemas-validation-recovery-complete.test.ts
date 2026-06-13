import { describe, it, expect } from 'vitest';
import { safeParseEforgeEvent } from '../events.schemas.js';

// --- eforge:region recovery-complete-schema-tests ---

describe('recovery:complete event — optional RecoveryVerdict metadata fields', () => {
  function makeBaseRecoveryCompleteEvent(verdictOverrides?: Record<string, unknown>) {
    return {
      type: 'recovery:complete',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'test-prd',
      verdict: {
        verdict: 'retry',
        confidence: 'high',
        rationale: 'All failures were transient transport errors.',
        completedWork: [],
        remainingWork: [],
        risks: [],
        ...verdictOverrides,
      },
    };
  }

  it('accepts recovery:complete without new optional metadata fields (legacy compatibility)', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent());
    expect(result.success).toBe(true);
  });

  it('accepts recovery:complete with continue-repair verdict', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({ verdict: 'continue-repair' }));
    expect(result.success).toBe(true);
  });

  it('rejects recovery:complete with removed verdict literal', () => {
    const removedVerdict = 'spl' + 'it';
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({ verdict: removedVerdict }));
    expect(result.success).toBe(false);
  });

  it('accepts recovery:complete with recommendationSource=deterministic', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationSource: 'deterministic',
    }));
    expect(result.success).toBe(true);
  });

  it('accepts recovery:complete with recommendationSource=analyst', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationSource: 'analyst',
    }));
    expect(result.success).toBe(true);
  });

  it('accepts recovery:complete with recommendationSource=manual-fallback', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationSource: 'manual-fallback',
    }));
    expect(result.success).toBe(true);
  });

  it('accepts recovery:complete with recommendationRationale string', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationRationale: 'All 2 failed plans have terminalSubtype error_transient_transport with zero tool use.',
    }));
    expect(result.success).toBe(true);
  });

  it('accepts recovery:complete with verdictInvalidationReason string', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      verdict: 'manual',
      confidence: 'low',
      rationale: 'Analyst verdict was rejected.',
      verdictInvalidationReason: 'Analyst rationale did not mention plan-04-queue-view',
    }));
    expect(result.success).toBe(true);
  });

  it('accepts recovery:complete with all three metadata fields combined', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationSource: 'deterministic',
      recommendationRationale: 'All failed plans are transient; no completed work.',
      verdictInvalidationReason: 'Analyst output omitted plan-04-queue-view from rationale.',
    }));
    expect(result.success).toBe(true);
  });

  it('rejects recovery:complete when recommendationSource is not a known value', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationSource: 'llm-gut-feeling',
    }));
    expect(result.success).toBe(false);
  });

  it('rejects recovery:complete when recommendationSource is a number instead of a string', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationSource: 42,
    }));
    expect(result.success).toBe(false);
  });

  it('rejects recovery:complete when recommendationRationale is a number instead of a string', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationRationale: 999,
    }));
    expect(result.success).toBe(false);
  });

  it('rejects recovery:complete when verdictInvalidationReason is a boolean instead of a string', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      verdictInvalidationReason: true,
    }));
    expect(result.success).toBe(false);
  });

  it('round-trips recovery:complete with all verdict metadata through JSON', () => {
    const event = makeBaseRecoveryCompleteEvent({
      recommendationSource: 'analyst',
      recommendationRationale: 'Deterministic retry recommendation based on transient errors.',
      verdictInvalidationReason: undefined,
    });
    const parsed = JSON.parse(JSON.stringify(event));
    const result = safeParseEforgeEvent(parsed);
    expect(result.success).toBe(true);
  });
});

// --- eforge:endregion recovery-complete-schema-tests ---
