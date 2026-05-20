import { describe, expect, it } from 'vitest';
import {
  selectNextReviewPerspectives,
  shouldTerminateCycleEarly,
  type ReviewCycleEvaluationSummary,
  type ReviewPerspective,
} from '@eforge-build/engine/review-cycle-perspectives';
import type { ReviewIssue } from '@eforge-build/engine/events';

// Note: ReviewPerspective is still used for built-in perspective tests.
// Dynamic perspective keys are just strings and work alongside built-ins.

const cleanEvaluation: ReviewCycleEvaluationSummary = {
  ran: true,
  accepted: 0,
  rejected: 0,
  review: 0,
  files: [],
};

function issue(file = 'src/app.ts', severity: ReviewIssue['severity'] = 'warning'): ReviewIssue {
  return {
    severity,
    category: 'bugs',
    file,
    description: 'Fix the issue',
  };
}

function criticalIssue(file = 'src/app.ts'): ReviewIssue {
  return issue(file, 'critical');
}

function issuesByPerspective(perspectives: ReviewPerspective[], withIssues: ReviewPerspective[] = []) {
  return Object.fromEntries(
    perspectives.map(perspective => [perspective, withIssues.includes(perspective) ? [issue()] : []]),
  );
}

describe('selectNextReviewPerspectives', () => {
  it('drops zero-issue perspectives when evaluator evidence does not overlap', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'docs'],
      previousActive: ['code', 'docs'],
      issuesByPerspective: issuesByPerspective(['code', 'docs']),
      evaluation: cleanEvaluation,
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.perspectives).toEqual([]);
    expect(result.dropped).toEqual(['code', 'docs']);
  });

  it('drops perspectives with only warning prior issues when no concern evidence', () => {
    // Warning issues alone are not sufficient to retain a perspective — only
    // critical severity or concern overlap with evaluation verdicts retains.
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'docs'],
      previousActive: ['code', 'docs'],
      issuesByPerspective: issuesByPerspective(['code', 'docs'], ['docs']),
      evaluation: cleanEvaluation,
      previousReviewWasParallel: true,
    });

    expect(result.perspectives).toEqual([]);
    expect(result.dropped).toEqual(['code', 'docs']);
  });

  it('retains perspectives with critical prior issues', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'docs'],
      previousActive: ['code', 'docs'],
      issuesByPerspective: { code: [criticalIssue()], docs: [] },
      evaluation: cleanEvaluation,
      previousReviewWasParallel: true,
    });

    expect(result.perspectives).toEqual(['code']);
    expect(result.dropped).toEqual(['docs']);
  });

  it('retains zero-issue perspectives whose concern area appears in accepted evaluator files', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'docs'],
      previousActive: ['code', 'docs'],
      issuesByPerspective: issuesByPerspective(['code', 'docs']),
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'docs/guide.md', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(result.perspectives).toEqual(['docs']);
    expect(result.dropped).toEqual(['code']);
  });

  it('counts rejected and review verdict files as concern evidence', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['api', 'test', 'docs'],
      previousActive: ['api', 'test', 'docs'],
      issuesByPerspective: issuesByPerspective(['api', 'test', 'docs']),
      evaluation: {
        ran: true,
        accepted: 0,
        rejected: 2,
        review: 1,
        files: [
          { file: 'src/api/users.ts', mode: 'file', action: 'reject', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] },
          { file: 'test/users.test.ts', mode: 'hunks', acceptedHunks: [], rejectedHunks: [], reviewHunks: [1] },
        ],
      },
      previousReviewWasParallel: true,
    });

    expect(result.perspectives).toEqual(['api', 'test']);
    expect(result.dropped).toEqual(['docs']);
  });

  it('drops security for ordinary code paths (no security-sensitive concern overlap)', () => {
    // src/app.ts is an ordinary code file — concern inference no longer maps it to security.
    // Security has no prior critical issues and no concern overlap → dropped.
    const codeResult = selectNextReviewPerspectives({
      initialOrder: ['security'],
      previousActive: ['security'],
      issuesByPerspective: issuesByPerspective(['security']),
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'src/app.ts', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(codeResult.perspectives).toEqual([]);
    expect(codeResult.dropped).toEqual(['security']);
  });

  it('retains security for dependency paths (pnpm-lock.yaml → security+verify concern)', () => {
    const depsResult = selectNextReviewPerspectives({
      initialOrder: ['security'],
      previousActive: ['security'],
      issuesByPerspective: issuesByPerspective(['security']),
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'pnpm-lock.yaml', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(depsResult.perspectives).toEqual(['security']);
  });

  it('retains security for security-sensitive code path (src/auth.ts → security concern)', () => {
    // src/auth.ts is security-sensitive — determineApplicableReviewsWithRules maps it to security.
    const authResult = selectNextReviewPerspectives({
      initialOrder: ['security'],
      previousActive: ['security'],
      issuesByPerspective: issuesByPerspective(['security']),
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'src/auth.ts', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(authResult.perspectives).toEqual(['security']);
  });

  it('retains verify after prior critical verification issues', () => {
    // Only critical severity retains verify without other evidence
    const result = selectNextReviewPerspectives({
      initialOrder: ['verify'],
      previousActive: ['verify'],
      issuesByPerspective: { verify: [criticalIssue()] },
      evaluation: cleanEvaluation,
      previousReviewWasParallel: true,
    });

    expect(result.perspectives).toEqual(['verify']);
    expect(result.dropped).toEqual([]);
  });

  it('drops verify after only warning prior issues with no concern evidence', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['verify'],
      previousActive: ['verify'],
      issuesByPerspective: issuesByPerspective(['verify'], ['verify']),  // warning issue
      evaluation: cleanEvaluation,
      previousReviewWasParallel: true,
    });

    expect(result.perspectives).toEqual([]);
    expect(result.dropped).toEqual(['verify']);
  });

  it.each([
    ['code', 'src/app.ts'],
    ['test', 'test/app.test.ts'],
    ['dependency', 'package.json'],
    ['config', 'tsconfig.json'],
    ['unknown', 'assets/logo.svg'],
  ])('retains verify after accepted %s paths', (_label, file) => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['verify'],
      previousActive: ['verify'],
      issuesByPerspective: issuesByPerspective(['verify']),
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file, mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(result.perspectives).toEqual(['verify']);
  });

  it('retains verify after accepted hunk-level non-doc changes', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['verify'],
      previousActive: ['verify'],
      issuesByPerspective: issuesByPerspective(['verify']),
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'src/app.ts', mode: 'hunks', acceptedHunks: [1], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(result.perspectives).toEqual(['verify']);
  });

  it('drops verify after a clean round with docs-only accepted paths', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['verify'],
      previousActive: ['verify'],
      issuesByPerspective: issuesByPerspective(['verify']),
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'docs/guide.md', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(result.perspectives).toEqual([]);
    expect(result.dropped).toEqual(['verify']);
  });

  it('drops verify when rejected and review verdicts on non-doc files are the only evidence', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['verify'],
      previousActive: ['verify'],
      issuesByPerspective: issuesByPerspective(['verify']),
      evaluation: {
        ran: true,
        accepted: 0,
        rejected: 1,
        review: 1,
        files: [
          { file: 'src/app.ts', mode: 'file', action: 'reject', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] },
          { file: 'src/other.ts', mode: 'hunks', acceptedHunks: [], rejectedHunks: [], reviewHunks: [1] },
        ],
      },
      previousReviewWasParallel: true,
    });

    expect(result.perspectives).toEqual([]);
    expect(result.dropped).toEqual(['verify']);
  });

  it('preserves stable initial ordering for active and dropped lists', () => {
    // code has a CRITICAL issue → retained. docs has concern overlap with accepted docs file → retained.
    // api has no issues, no overlap → dropped. Ordering follows initialOrder: ['api','code','docs'].
    const result = selectNextReviewPerspectives({
      initialOrder: ['api', 'code', 'docs'],
      previousActive: ['code', 'docs', 'api'],
      issuesByPerspective: { code: [criticalIssue()], docs: [], api: [] },
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'docs/guide.md', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(result.perspectives).toEqual(['code', 'docs']);
    expect(result.dropped).toEqual(['api']);
  });

  it('uses previous active order when no explicit initial order exists', () => {
    // code has a CRITICAL issue → retained. docs has concern overlap → retained.
    // api dropped. Ordering follows previousActive: ['docs','code','api'].
    const result = selectNextReviewPerspectives({
      initialOrder: [],
      previousActive: ['docs', 'code', 'api'],
      issuesByPerspective: { docs: [], code: [criticalIssue()], api: [] },
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'docs/guide.md', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(result.perspectives).toEqual(['docs', 'code']);
    expect(result.dropped).toEqual(['api']);
  });

  it('falls back to the previous active list when completion data is missing', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'docs'],
      previousActive: ['code', 'docs'],
      issuesByPerspective: { code: [] },
      evaluation: cleanEvaluation,
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(true);
    expect(result.perspectives).toEqual(['code', 'docs']);
    expect(result.dropped).toEqual([]);
    expect(result.rationale).toMatch(/completion data was missing/i);
  });

  it('falls back to the previous active list when evaluation data is missing', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'docs'],
      previousActive: ['code', 'docs'],
      issuesByPerspective: issuesByPerspective(['code', 'docs']),
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(true);
    expect(result.perspectives).toEqual(['code', 'docs']);
    expect(result.dropped).toEqual([]);
    expect(result.rationale).toMatch(/evaluation summary data was missing/i);
  });

  it('falls back to the previous active list when evaluation did not run', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'docs'],
      previousActive: ['code', 'docs'],
      issuesByPerspective: issuesByPerspective(['code', 'docs']),
      evaluation: { ran: false, accepted: 0, rejected: 0, review: 0, files: [] },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(true);
    expect(result.perspectives).toEqual(['code', 'docs']);
    expect(result.dropped).toEqual([]);
    expect(result.rationale).toMatch(/evaluation did not run/i);
  });

  it('falls back to the previous active list when verdict counts have no file summaries', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'docs'],
      previousActive: ['code', 'docs'],
      issuesByPerspective: issuesByPerspective(['code', 'docs']),
      evaluation: { ran: true, accepted: 0, rejected: 1, review: 1, files: [] },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(true);
    expect(result.perspectives).toEqual(['code', 'docs']);
    expect(result.dropped).toEqual([]);
    expect(result.rationale).toMatch(/file verdict summaries were missing/i);
  });

  it.each([
    ['the prior review was not parallel', { previousReviewWasParallel: false }],
    ['a perspective errored', { previousReviewWasParallel: true, perspectiveErrors: ['docs'] as ReviewPerspective[] }],
  ])('falls back to the previous active list when %s', (_label, overrides) => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'docs'],
      previousActive: ['code', 'docs'],
      issuesByPerspective: issuesByPerspective(['code', 'docs']),
      evaluation: cleanEvaluation,
      previousReviewWasParallel: true,
      ...overrides,
    });

    expect(result.fallback).toBe(true);
    expect(result.perspectives).toEqual(['code', 'docs']);
    expect(result.dropped).toEqual([]);
    expect(result.rationale).toMatch(/Fallback/i);
  });
});

// --- eforge:region plan-01-dynamic-perspective-contracts ---
describe('selectNextReviewPerspectives — dynamic perspective key handling', () => {
  it('drops a dynamic key with only warning prior issues (critical-only retention)', () => {
    // Warning issues no longer retain perspectives — only critical severity does.
    // Dynamic keys follow the same severity threshold as built-in perspectives.
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'accessibility'],
      previousActive: ['code', 'accessibility'],
      issuesByPerspective: {
        code: [],
        accessibility: [{ severity: 'warning', category: 'bugs', file: 'src/app.ts', description: 'Issue' }],
      },
      evaluation: { ran: true, accepted: 0, rejected: 0, review: 0, files: [] },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.dropped).toContain('accessibility');
    expect(result.dropped).toContain('code');
    expect(result.perspectives).toEqual([]);
  });

  it('preserves a dynamic key in previousActive when it has a critical prior issue', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'accessibility'],
      previousActive: ['code', 'accessibility'],
      issuesByPerspective: {
        code: [],
        accessibility: [{ severity: 'critical', category: 'bugs', file: 'src/app.ts', description: 'Critical a11y issue' }],
      },
      evaluation: { ran: true, accepted: 0, rejected: 0, review: 0, files: [] },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.perspectives).toContain('accessibility');
    expect(result.dropped).toContain('code');
  });

  it('drops a dynamic key when it has no prior issues and no concern evidence', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'accessibility'],
      previousActive: ['code', 'accessibility'],
      issuesByPerspective: { code: [], accessibility: [] },
      evaluation: { ran: true, accepted: 0, rejected: 0, review: 0, files: [] },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.perspectives).toEqual([]);
    expect(result.dropped).toContain('accessibility');
    expect(result.dropped).toContain('code');
  });

  it('preserves a dynamic key in perspectiveErrors when it errors, triggering fallback', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'accessibility'],
      previousActive: ['code', 'accessibility'],
      issuesByPerspective: { code: [], accessibility: [] },
      evaluation: { ran: true, accepted: 0, rejected: 0, review: 0, files: [] },
      previousReviewWasParallel: true,
      perspectiveErrors: ['accessibility'],
    });

    // Error in any perspective triggers fallback, preserving all including the dynamic key
    expect(result.fallback).toBe(true);
    expect(result.perspectives).toContain('accessibility');
    expect(result.perspectives).toContain('code');
    expect(result.dropped).toEqual([]);
  });

  it('preserves a dynamic key in dropped when it is dropped in the result', () => {
    // code has a warning issue (not critical) + no concern overlap → dropped too
    // accessibility has no issues → dropped
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'accessibility'],
      previousActive: ['code', 'accessibility'],
      issuesByPerspective: {
        code: [{ severity: 'warning', category: 'bugs', file: 'src/app.ts', description: 'Issue' }],
        accessibility: [],
      },
      evaluation: { ran: true, accepted: 0, rejected: 0, review: 0, files: [] },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.dropped).toContain('accessibility');
    expect(result.dropped).toContain('code');
    expect(result.perspectives).toEqual([]);
  });

  it('handles a mix of built-in and dynamic keys in issuesByPerspective', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'security', 'performance-review'],
      previousActive: ['code', 'security', 'performance-review'],
      issuesByPerspective: {
        code: [],
        security: [{ severity: 'critical', category: 'security', file: 'src/auth.ts', description: 'Issue' }],
        'performance-review': [],
      },
      evaluation: { ran: true, accepted: 0, rejected: 0, review: 0, files: [] },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.perspectives).toContain('security');
    expect(result.dropped).toContain('code');
    expect(result.dropped).toContain('performance-review');
  });
});
// --- eforge:endregion plan-01-dynamic-perspective-contracts ---

// --- eforge:region plan-01-adaptive-review-policy ---
describe('selectNextReviewPerspectives — unresolved-risk retention policy', () => {
  it('retains docs when accepted warning fixes touch the docs concern area', () => {
    // Prior warning issue for docs. Warning-only issues are not sufficient to retain,
    // but the accepted docs/guide.md file creates concern overlap for docs.
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'docs'],
      previousActive: ['code', 'docs'],
      issuesByPerspective: { code: [], docs: [issue('docs/guide.md')] },
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'docs/guide.md', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    // docs is retained via concern overlap (accepted docs file matches docs concern)
    // code has no issues, no concern overlap → dropped
    expect(result.fallback).toBe(false);
    expect(result.perspectives).toContain('docs');
    expect(result.dropped).toContain('code');
  });

  it('drops a perspective when accepted warning fixes touch only ordinary low-risk code', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['code'],
      previousActive: ['code'],
      issuesByPerspective: { code: [issue('src/app.ts')] },
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'src/app.ts', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.perspectives).toEqual([]);
    expect(result.dropped).toEqual(['code']);
  });

  it('drops a perspective when prior warning issue has all fixes accepted and no concern evidence', () => {
    // Warning issue for code, but evaluator accepted a docs-only file
    // code concern does not overlap with docs/guide.md accepted file
    const result = selectNextReviewPerspectives({
      initialOrder: ['code'],
      previousActive: ['code'],
      issuesByPerspective: { code: [issue('src/app.ts')] },
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'docs/guide.md', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    // code: warning issue only, no critical. docs/guide.md → concern = {docs}, code NOT in {docs}.
    // → code dropped
    expect(result.fallback).toBe(false);
    expect(result.dropped).toContain('code');
  });

  it('retains a perspective with a critical prior issue regardless of evaluation', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['security'],
      previousActive: ['security'],
      issuesByPerspective: { security: [criticalIssue('src/auth.ts')] },
      evaluation: {
        ran: true,
        accepted: 0,
        rejected: 0,
        review: 0,
        files: [],
      },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.perspectives).toContain('security');
    expect(result.rationale).toContain('critical');
  });

  it('retains a perspective via rejected verdict on a relevant file', () => {
    // code reviewer found a warning issue; evaluator rejected src/app.ts fixer changes
    // → code concern overlaps with rejected file → retain code
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'docs'],
      previousActive: ['code', 'docs'],
      issuesByPerspective: { code: [issue('src/app.ts')], docs: [] },
      evaluation: {
        ran: true,
        accepted: 0,
        rejected: 1,
        review: 0,
        files: [{ file: 'src/app.ts', mode: 'file', action: 'reject', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.perspectives).toContain('code');
    expect(result.dropped).toContain('docs');
    expect(result.rationale).toContain('Kept code');
  });

  it('retains a perspective via review-needed verdict on a relevant file', () => {
    // api reviewer found no issues; evaluator flagged src/api/users.ts for review
    // → api concern overlaps with review file → retain api
    const result = selectNextReviewPerspectives({
      initialOrder: ['api', 'test'],
      previousActive: ['api', 'test'],
      issuesByPerspective: { api: [], test: [] },
      evaluation: {
        ran: true,
        accepted: 0,
        rejected: 0,
        review: 1,
        files: [{ file: 'src/api/users.ts', mode: 'hunks', acceptedHunks: [], rejectedHunks: [], reviewHunks: [1] }],
      },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.perspectives).toContain('api');
    expect(result.dropped).toContain('test');
  });

  it('drops verify after docs-only accepted fixes (no runtime risk)', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['verify'],
      previousActive: ['verify'],
      issuesByPerspective: { verify: [] },
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'docs/guide.md', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.perspectives).toEqual([]);
    expect(result.dropped).toContain('verify');
  });

  it('retains verify after accepted config file (command/integration risk)', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['verify'],
      previousActive: ['verify'],
      issuesByPerspective: { verify: [] },
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'tsconfig.json', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.perspectives).toContain('verify');
  });

  it('retains verify after accepted package dep file (runtime risk)', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['verify'],
      previousActive: ['verify'],
      issuesByPerspective: { verify: [] },
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'package.json', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.perspectives).toContain('verify');
  });

  it('retains verify as mandatory for sharded build regardless of evidence', () => {
    // Docs-only accepted changes would normally drop verify, but mandatory overrides this
    const result = selectNextReviewPerspectives({
      initialOrder: ['code', 'verify'],
      previousActive: ['code', 'verify'],
      issuesByPerspective: { code: [], verify: [] },
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'docs/guide.md', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      previousReviewWasParallel: true,
      mandatoryPerspectives: ['verify'],
    });

    expect(result.fallback).toBe(false);
    expect(result.perspectives).toContain('verify');
    expect(result.rationale).toContain('mandatory');
  });

  it('rationale names specific keep and drop reasons', () => {
    const result = selectNextReviewPerspectives({
      initialOrder: ['security', 'docs'],
      previousActive: ['security', 'docs'],
      issuesByPerspective: { security: [criticalIssue('src/auth.ts')], docs: [] },
      evaluation: { ran: true, accepted: 0, rejected: 0, review: 0, files: [] },
      previousReviewWasParallel: true,
    });

    expect(result.rationale).toContain('Kept security');
    expect(result.rationale).toContain('Dropped docs');
  });
});

describe('shouldTerminateCycleEarly', () => {
  it('terminates when all fixes accepted, no critical issues, and docs-only accepted changes', () => {
    const result = shouldTerminateCycleEarly({
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'docs/guide.md', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      issuesByPerspective: { code: [issue('docs/guide.md')], docs: [] },
      previousActive: ['code', 'docs'],
      perspectiveErrors: [],
    });

    expect(result.terminate).toBe(true);
    expect(result.rationale).toContain('docs-only scope');
  });

  it('terminates when all fixes accepted, no critical issues, and verify was active', () => {
    const result = shouldTerminateCycleEarly({
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'src/app.ts', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      issuesByPerspective: { code: [issue()], verify: [] },
      previousActive: ['code', 'verify'],
      perspectiveErrors: [],
      verifyWasActive: true,
    });

    expect(result.terminate).toBe(true);
    expect(result.rationale).toContain('all fixes accepted');
    expect(result.rationale).toContain('no unresolved high-risk concerns');
    expect(result.rationale).toContain('verify passed');
  });

  it('terminates when all fixes accepted, no critical issues, and test-cycle in pipeline', () => {
    const result = shouldTerminateCycleEarly({
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'src/app.ts', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      issuesByPerspective: { code: [issue()] },
      previousActive: ['code'],
      perspectiveErrors: [],
      hasTestCycle: true,
    });

    expect(result.terminate).toBe(true);
    expect(result.rationale).toContain('test-cycle');
  });

  it('does not terminate when rejected verdicts remain', () => {
    const result = shouldTerminateCycleEarly({
      evaluation: {
        ran: true,
        accepted: 0,
        rejected: 1,
        review: 0,
        files: [{ file: 'src/app.ts', mode: 'file', action: 'reject', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      issuesByPerspective: { code: [issue()] },
      previousActive: ['code'],
      perspectiveErrors: [],
      verifyWasActive: true,
    });

    expect(result.terminate).toBe(false);
    expect(result.rationale).toContain('rejected');
  });

  it('does not terminate when a perspective errored in the review round', () => {
    const result = shouldTerminateCycleEarly({
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'src/app.ts', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      issuesByPerspective: { code: [issue()] },
      previousActive: ['code'],
      perspectiveErrors: ['code'],
      verifyWasActive: true,
    });

    expect(result.terminate).toBe(false);
    expect(result.rationale).toContain('Perspective error');
  });

  it('does not terminate when critical issues remain', () => {
    const result = shouldTerminateCycleEarly({
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'src/app.ts', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      issuesByPerspective: { security: [criticalIssue('src/auth.ts')] },
      previousActive: ['security'],
      perspectiveErrors: [],
      verifyWasActive: true,
    });

    expect(result.terminate).toBe(false);
    expect(result.rationale).toContain('Critical issues remain');
  });

  it('does not terminate when no command/integration confidence signal', () => {
    // accepted non-docs changes but no verify, test-cycle, or docs-only
    const result = shouldTerminateCycleEarly({
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'src/app.ts', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      issuesByPerspective: { code: [issue()] },
      previousActive: ['code'],
      perspectiveErrors: [],
      verifyWasActive: false,
      hasTestCycle: false,
    });

    expect(result.terminate).toBe(false);
    expect(result.rationale).toContain('No command/integration confidence');
  });

  it('does not terminate when evaluation did not run', () => {
    const result = shouldTerminateCycleEarly({
      evaluation: { ran: false, accepted: 0, rejected: 0, review: 0, files: [] },
      issuesByPerspective: {},
      previousActive: ['code'],
      perspectiveErrors: [],
    });

    expect(result.terminate).toBe(false);
  });

  it('rationale names accepted verdicts and no unresolved high-risk concerns', () => {
    const result = shouldTerminateCycleEarly({
      evaluation: {
        ran: true,
        accepted: 1,
        rejected: 0,
        review: 0,
        files: [{ file: 'docs/guide.md', mode: 'file', action: 'accept', acceptedHunks: [], rejectedHunks: [], reviewHunks: [] }],
      },
      issuesByPerspective: { docs: [] },
      previousActive: ['docs'],
      perspectiveErrors: [],
    });

    expect(result.terminate).toBe(true);
    expect(result.rationale).toContain('all fixes accepted');
    expect(result.rationale).toContain('docs/guide.md');
  });
});
// --- eforge:endregion plan-01-adaptive-review-policy ---
