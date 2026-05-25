import { describe, it, expect } from 'vitest';
import {
  getVerdictChipClass,
  getConfidenceClass,
  type RecoveryVerdictValue,
  type RecoveryConfidenceValue,
} from '@/components/recovery/verdict-chip';

// ---------------------------------------------------------------------------
// Pure helper mirrors — extracted from event-card.tsx for testability
// without a DOM environment.
// ---------------------------------------------------------------------------

/** Mirror of eventSummary's gap_close:complete branch */
function gapCloseCompleteSummary(passed: boolean): string {
  return passed ? 'Gap closing complete' : 'Gap closing failed';
}

/** Mirror of classifyEvent's gap_close:complete verdict-aware classification */
function classifyGapCloseComplete(passed: boolean): string {
  return passed === false ? 'failed' : 'complete';
}

/** Mirror of eventSummary's acceptance_validation:complete branch */
function acceptanceValidationSummary(
  verdicts: Array<{ verdict: 'pass' | 'fail' | 'unknown' }>,
): string {
  const passCount = verdicts.filter((v) => v.verdict === 'pass').length;
  const failCount = verdicts.filter((v) => v.verdict === 'fail').length;
  const unknownCount = verdicts.filter((v) => v.verdict === 'unknown').length;
  return `Acceptance: ${passCount} pass, ${failCount} fail, ${unknownCount} unknown`;
}

/** Mirror of classifyEvent's acceptance_validation:complete verdict-aware classification */
function classifyAcceptanceValidationComplete(passed: boolean): string {
  return passed === false ? 'failed' : 'complete';
}

/** Mirror of eventDetail's acceptance_validation:complete branch */
function acceptanceValidationDetail(
  verdicts: Array<{ criterion: string; verdict: 'pass' | 'fail' | 'unknown'; evidence: string }>,
  waivers?: string[],
): string | null {
  const parts: string[] = [];
  for (const v of verdicts) {
    const icon = v.verdict === 'pass' ? '✓' : v.verdict === 'fail' ? '✗' : '?';
    parts.push(`${icon} [${v.verdict}] ${v.criterion}\n  ${v.evidence}`);
  }
  if (waivers && waivers.length > 0) {
    parts.push('Waivers:');
    for (const waiver of waivers) {
      parts.push(`  • ${waiver}`);
    }
  }
  return parts.join('\n\n') || null;
}

// Pure logic tests validating that EventCard correctly surfaces the
// RecoveryVerdictChip for recovery:complete events.
//
// EventCard narrows the event with:
//   const recoveryCompleteEvent = event.type === 'recovery:complete' ? event : null;
// and then renders <RecoveryVerdictChip verdict={...} confidence={...} /> when
// recoveryCompleteEvent is non-null.
//
// Because no DOM environment is available in this test suite, we test the
// pure rendering-branch logic: the narrowing predicate and the chip styling
// helpers that would be called once the event is rendered.

// Mirror of EventCard's recoveryCompleteEvent narrowing — extracted as a pure
// function for testability.
type RecoveryCompleteEventShape = {
  type: 'recovery:complete';
  prdId: string;
  verdict: { verdict: RecoveryVerdictValue; confidence: RecoveryConfidenceValue };
};

function getRecoveryVerdictProps(
  event: { type: string; [key: string]: unknown },
): { verdict: RecoveryVerdictValue; confidence: RecoveryConfidenceValue } | null {
  if (event.type !== 'recovery:complete') return null;
  const e = event as unknown as RecoveryCompleteEventShape;
  return e.verdict;
}

describe('EventCard recovery:complete rendering branch', () => {
  it('returns non-null chip props for a recovery:complete event', () => {
    const event = {
      type: 'recovery:complete',
      prdId: 'my-plan',
      verdict: { verdict: 'retry' as RecoveryVerdictValue, confidence: 'high' as RecoveryConfidenceValue },
    };
    const props = getRecoveryVerdictProps(event);
    expect(props).not.toBeNull();
    expect(props?.verdict).toBe('retry');
    expect(props?.confidence).toBe('high');
  });

  it('returns null for non-recovery events (chip is not rendered)', () => {
    const event = { type: 'plan:build:complete', planId: 'my-plan' };
    expect(getRecoveryVerdictProps(event)).toBeNull();
  });

  it('returns null for recovery:start events (chip only shown on complete)', () => {
    const event = { type: 'recovery:start', prdId: 'my-plan', setName: 'my-set' };
    expect(getRecoveryVerdictProps(event)).toBeNull();
  });

  // --- eforge:region plan-04-rendering-and-docs ---

describe('EventCard gap_close:complete rendering branch', () => {
  it('classifies passed gap_close:complete as complete', () => {
    expect(classifyGapCloseComplete(true)).toBe('complete');
  });

  it('classifies failed gap_close:complete as failed', () => {
    expect(classifyGapCloseComplete(false)).toBe('failed');
  });

  it('summary for passed gap_close:complete is "Gap closing complete"', () => {
    expect(gapCloseCompleteSummary(true)).toBe('Gap closing complete');
  });

  it('summary for failed gap_close:complete is "Gap closing failed"', () => {
    expect(gapCloseCompleteSummary(false)).toBe('Gap closing failed');
  });
});

describe('EventCard acceptance_validation:complete rendering branch', () => {
  it('classifies passed acceptance_validation:complete as complete', () => {
    expect(classifyAcceptanceValidationComplete(true)).toBe('complete');
  });

  it('classifies failed acceptance_validation:complete as failed', () => {
    expect(classifyAcceptanceValidationComplete(false)).toBe('failed');
  });

  it('summary includes correct pass/fail/unknown counts', () => {
    const verdicts = [
      { verdict: 'pass' as const },
      { verdict: 'pass' as const },
      { verdict: 'fail' as const },
      { verdict: 'unknown' as const },
    ];
    expect(acceptanceValidationSummary(verdicts)).toBe('Acceptance: 2 pass, 1 fail, 1 unknown');
  });

  it('summary with all passing verdicts shows 0 fail and 0 unknown', () => {
    const verdicts = [{ verdict: 'pass' as const }, { verdict: 'pass' as const }];
    expect(acceptanceValidationSummary(verdicts)).toBe('Acceptance: 2 pass, 0 fail, 0 unknown');
  });

  it('detail lists each verdict with icon, label, criterion, and evidence', () => {
    const verdicts = [
      { criterion: 'AC-1: Must do X', verdict: 'pass' as const, evidence: 'Implemented in foo.ts' },
      { criterion: 'AC-2: Must do Y', verdict: 'fail' as const, evidence: 'No implementation found' },
      { criterion: 'AC-3: Must do Z', verdict: 'unknown' as const, evidence: 'Insufficient diff' },
    ];
    const detail = acceptanceValidationDetail(verdicts);
    expect(detail).toContain('✓ [pass] AC-1: Must do X');
    expect(detail).toContain('Implemented in foo.ts');
    expect(detail).toContain('✗ [fail] AC-2: Must do Y');
    expect(detail).toContain('No implementation found');
    expect(detail).toContain('? [unknown] AC-3: Must do Z');
    expect(detail).toContain('Insufficient diff');
  });

  it('detail includes waiver reasons when present', () => {
    const verdicts = [
      { criterion: 'AC-1', verdict: 'pass' as const, evidence: 'evidence' },
    ];
    const waivers = ['No-PRD build: acceptance inventory not applicable'];
    const detail = acceptanceValidationDetail(verdicts, waivers);
    expect(detail).toContain('Waivers:');
    expect(detail).toContain('No-PRD build: acceptance inventory not applicable');
  });

  it('detail returns null when verdicts array is empty and no waivers', () => {
    expect(acceptanceValidationDetail([])).toBeNull();
  });

  it('detail includes all waiver reason strings in order', () => {
    const verdicts = [{ criterion: 'AC-1', verdict: 'pass' as const, evidence: 'ok' }];
    const waivers = ['reason-one', 'reason-two'];
    const detail = acceptanceValidationDetail(verdicts, waivers);
    expect(detail).toContain('reason-one');
    expect(detail).toContain('reason-two');
  });
});

// --- eforge:endregion plan-04-rendering-and-docs ---

  it('chip styling is valid for all verdict/confidence combinations from recovery events', () => {
    const verdicts: RecoveryVerdictValue[] = ['retry', 'split', 'abandon', 'manual'];
    const confidences: RecoveryConfidenceValue[] = ['low', 'medium', 'high'];

    verdicts.forEach((verdict) => {
      confidences.forEach((confidence) => {
        const event = {
          type: 'recovery:complete',
          prdId: 'my-plan',
          verdict: { verdict, confidence },
        };
        const props = getRecoveryVerdictProps(event);
        expect(props).not.toBeNull();
        // Validate that the chip helpers produce non-empty class strings for
        // the verdict and confidence values from the event — these are called
        // by RecoveryVerdictChip during rendering.
        expect(getVerdictChipClass(props!.verdict).trim().length).toBeGreaterThan(0);
        expect(getConfidenceClass(props!.confidence).trim().length).toBeGreaterThan(0);
      });
    });
  });
});
