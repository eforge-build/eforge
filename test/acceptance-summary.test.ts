import { describe, it, expect } from 'vitest';
import { countVerdicts, formatAcceptanceFailureSummary } from '@eforge-build/engine/validation/acceptance-summary';
import type { AcceptanceCriterionVerdict } from '@eforge-build/client';

function makeVerdict(verdict: 'pass' | 'fail' | 'unknown', criterion = 'Test criterion'): AcceptanceCriterionVerdict {
  return { criterion, verdict, evidence: `Evidence for ${verdict}` };
}

describe('countVerdicts', () => {
  it('returns all zeros for an empty array', () => {
    const counts = countVerdicts([]);
    expect(counts).toEqual({ total: 0, pass: 0, fail: 0, unknown: 0 });
  });

  it('counts a single pass verdict', () => {
    const counts = countVerdicts([makeVerdict('pass')]);
    expect(counts).toEqual({ total: 1, pass: 1, fail: 0, unknown: 0 });
  });

  it('counts a single fail verdict', () => {
    const counts = countVerdicts([makeVerdict('fail')]);
    expect(counts).toEqual({ total: 1, pass: 0, fail: 1, unknown: 0 });
  });

  it('counts a single unknown verdict', () => {
    const counts = countVerdicts([makeVerdict('unknown')]);
    expect(counts).toEqual({ total: 1, pass: 0, fail: 0, unknown: 1 });
  });

  it('counts mixed verdicts correctly', () => {
    const verdicts = [
      makeVerdict('pass'),
      makeVerdict('pass'),
      makeVerdict('fail'),
      makeVerdict('unknown'),
      makeVerdict('unknown'),
    ];
    const counts = countVerdicts(verdicts);
    expect(counts).toEqual({ total: 5, pass: 2, fail: 1, unknown: 2 });
  });

  it('counts all-pass verdicts', () => {
    const verdicts = [makeVerdict('pass'), makeVerdict('pass'), makeVerdict('pass')];
    const counts = countVerdicts(verdicts);
    expect(counts).toEqual({ total: 3, pass: 3, fail: 0, unknown: 0 });
  });
});

describe('formatAcceptanceFailureSummary', () => {
  it('uses "not met" language for fail-only verdicts', () => {
    const verdicts = [makeVerdict('fail'), makeVerdict('fail')];
    const result = formatAcceptanceFailureSummary(verdicts);
    expect(result).toContain('not met');
    expect(result).not.toContain('inconclusive');
    expect(result).toContain('2');
  });

  it('uses "inconclusive" language for unknown-only verdicts', () => {
    const verdicts = [makeVerdict('unknown'), makeVerdict('unknown')];
    const result = formatAcceptanceFailureSummary(verdicts);
    expect(result).toContain('inconclusive');
    expect(result).not.toContain('not met');
    expect(result).toContain('2');
  });

  it('includes both "not met" and "inconclusive" for mixed fail and unknown verdicts', () => {
    const verdicts = [makeVerdict('fail'), makeVerdict('unknown')];
    const result = formatAcceptanceFailureSummary(verdicts);
    expect(result).toContain('not met');
    expect(result).toContain('inconclusive');
  });

  it('ignores pass verdicts in the summary (counts only non-pass)', () => {
    const verdicts = [makeVerdict('pass'), makeVerdict('fail'), makeVerdict('unknown')];
    const result = formatAcceptanceFailureSummary(verdicts);
    // 1 fail + 1 unknown
    expect(result).toContain('1 criterion');
    expect(result).toContain('not met');
    expect(result).toContain('inconclusive');
  });

  it('produces a non-empty fallback for an all-pass array (defensive)', () => {
    const verdicts = [makeVerdict('pass')];
    const result = formatAcceptanceFailureSummary(verdicts);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('Acceptance criteria validation failed');
  });

  it('produces a non-empty fallback for an empty array (defensive)', () => {
    const result = formatAcceptanceFailureSummary([]);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('Acceptance criteria validation failed');
  });
});
