/**
 * Focused tests for selectInitialReviewPerspectives: risk signals, ranking,
 * budget caps, and rationale/rule output.
 *
 * These tests complement the broader review-heuristics.test.ts suite with
 * detailed assertions about budget behavior and risk-signal interaction.
 */

import { describe, it, expect } from 'vitest';
import { selectInitialReviewPerspectives } from '@eforge-build/engine/review-heuristics';

describe('selectInitialReviewPerspectives — risk signal detection', () => {
  it('fires no risk signals for ordinary code files', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/app.ts'], changedLines: 10 });
    expect(result.riskSignals).toHaveLength(0);
  });

  it('fires security-sensitive-paths signal for auth files', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/auth.ts'], changedLines: 10 });
    const signal = result.riskSignals.find(s => s.includes('security-sensitive-paths'));
    expect(signal).toBeDefined();
    expect(signal).toContain('src/auth.ts');
  });

  it('fires dependency risk signal for pnpm-lock.yaml', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['pnpm-lock.yaml'], changedLines: 100 });
    const signal = result.riskSignals.find(s => s.includes('dependency-files'));
    expect(signal).toBeDefined();
  });

  it('fires no risk signals for docs-only changes', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['docs/guide.md'], changedLines: 50 });
    expect(result.riskSignals).toHaveLength(0);
  });

  it('fires security signal for api/auth routes', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/api/auth.ts'], changedLines: 20 });
    const signal = result.riskSignals.find(s => s.includes('security-sensitive-paths'));
    expect(signal).toBeDefined();
  });
});

describe('selectInitialReviewPerspectives — budget caps', () => {
  it('applies budget 2 for ordinary code (no security signals, no large changeset)', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/app.ts'], changedLines: 50 });
    expect(result.budget).toBe(2);
    expect(result.perspectives.length).toBeLessThanOrEqual(2);
  });

  it('raises budget to 3 for security-sensitive code files', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/auth.ts', 'src/app.ts'], changedLines: 50 });
    expect(result.budget).toBe(3);
  });

  it('raises budget to 3 for large changeset (≥10 files)', () => {
    const files = Array.from({ length: 10 }, (_, i) => `src/module${i}.ts`);
    const result = selectInitialReviewPerspectives({ changedFiles: files, changedLines: 100 });
    expect(result.budget).toBe(3);
  });

  it('raises budget to 3 for large changeset (≥500 lines)', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/app.ts'], changedLines: 500 });
    expect(result.budget).toBe(3);
  });

  it('keeps the top-ranked candidates and trims lower-ranked ones when over budget', () => {
    // Mixed changeset: code + test + deps + security-sensitive = four candidates.
    // Budget is raised to 3, so the lower-ranked test perspective is trimmed.
    const result = selectInitialReviewPerspectives({
      changedFiles: ['src/auth.ts', 'test/auth.test.ts', 'package.json'],
      changedLines: 200,
    });
    expect(result.budget).toBe(3);
    expect(result.perspectives).toEqual(['security', 'verify', 'code']);
    expect(result.perspectives).not.toContain('test');
  });
});

describe('selectInitialReviewPerspectives — risk-based ranking', () => {
  it('security ranks before verify', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['pnpm-lock.yaml'], changedLines: 50 });
    expect(result.perspectives).toEqual(['security', 'verify']);
  });

  it('verify ranks before api', () => {
    // deps + api file (no security name): security + verify + api
    const result = selectInitialReviewPerspectives({
      changedFiles: ['pnpm-lock.yaml', 'src/routes/users.ts'],
      changedLines: 50,
    });
    expect(result.perspectives).toEqual(['security', 'verify', 'api']);
  });

  it('api ranks before code', () => {
    const result = selectInitialReviewPerspectives({
      changedFiles: ['src/routes/users.ts', 'src/helper.ts'],
      changedLines: 50,
    });
    expect(result.perspectives).toEqual(['api', 'code']);
  });

  it('verify ranks before test', () => {
    const result = selectInitialReviewPerspectives({
      changedFiles: ['test/app.test.ts'],
      changedLines: 30,
    });
    expect(result.perspectives).toEqual(['verify', 'test']);
  });
});

describe('selectInitialReviewPerspectives — rules output', () => {
  it('includes code-files rule for code changes', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/app.ts'], changedLines: 10 });
    expect(result.rules).toContain('code-files → code');
  });

  it('includes dep-files rule for lockfile changes', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['pnpm-lock.yaml'], changedLines: 50 });
    expect(result.rules.some(r => r.includes('dep-files → security+verify'))).toBe(true);
  });

  it('includes test-files rule for test changes', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['test/app.test.ts'], changedLines: 20 });
    expect(result.rules.some(r => r.includes('test-files → test+verify'))).toBe(true);
  });

  it('includes security-sensitive-paths rule for auth files', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/auth.ts'], changedLines: 10 });
    expect(result.rules.some(r => r.includes('security-sensitive-paths → security'))).toBe(true);
  });

  it('records budget rule in rules', () => {
    const normal = selectInitialReviewPerspectives({ changedFiles: ['src/app.ts'], changedLines: 10 });
    expect(normal.rules).toContain('normal-risk change — budget 2');

    const security = selectInitialReviewPerspectives({ changedFiles: ['src/auth.ts'], changedLines: 10 });
    expect(security.rules).toContain('security-critical change — budget raised to 3');
  });
});

describe('selectInitialReviewPerspectives — rationale output', () => {
  it('provides a non-empty rationale string', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/app.ts'], changedLines: 10 });
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it('rationale for no-perspectives case is informative', () => {
    // Empty file list should produce "No perspectives inferred"
    const result = selectInitialReviewPerspectives({ changedFiles: [], changedLines: 0 });
    expect(result.perspectives).toHaveLength(0);
    expect(result.rationale).toContain('No perspectives inferred');
  });
});
