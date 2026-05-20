import { describe, it, expect } from 'vitest';
import {
  categorizeFiles,
  determineApplicableReviews,
  selectInitialReviewPerspectives,
  isSecuritySensitivePath,
  shouldParallelizeReview,
  type FileCategories,
} from '@eforge-build/engine/review-heuristics';

describe('categorizeFiles', () => {
  it('assigns TypeScript files to code', () => {
    const result = categorizeFiles(['src/engine/agents/reviewer.ts']);
    expect(result.code).toEqual(['src/engine/agents/reviewer.ts']);
  });

  it('assigns route files to api', () => {
    const result = categorizeFiles(['src/routes/users.ts', 'src/api/auth.ts']);
    expect(result.api).toEqual(['src/routes/users.ts', 'src/api/auth.ts']);
  });

  it('assigns README to docs', () => {
    const result = categorizeFiles(['README.md']);
    expect(result.docs).toEqual(['README.md']);
  });

  it('assigns package.json to deps', () => {
    const result = categorizeFiles(['package.json']);
    expect(result.deps).toEqual(['package.json']);
  });

  it('assigns config files to config', () => {
    const result = categorizeFiles(['.eslintrc.json', 'tsconfig.json']);
    expect(result.config).toEqual(['.eslintrc.json', 'tsconfig.json']);
  });

  it('assigns markdown files to docs', () => {
    const result = categorizeFiles(['docs/guide.md', 'CHANGELOG.md']);
    expect(result.docs).toEqual(['docs/guide.md', 'CHANGELOG.md']);
  });

  it('handles mixed file types', () => {
    const result = categorizeFiles([
      'src/engine/eforge.ts',
      'package.json',
      'README.md',
      '.gitignore',
      'src/api/users.ts',
    ]);
    expect(result.code).toEqual(['src/engine/eforge.ts']);
    expect(result.deps).toEqual(['package.json']);
    expect(result.docs).toEqual(['README.md']);
    expect(result.config).toEqual(['.gitignore']);
    expect(result.api).toEqual(['src/api/users.ts']);
  });

  it('returns empty categories for empty input', () => {
    const result = categorizeFiles([]);
    expect(result.code).toEqual([]);
    expect(result.api).toEqual([]);
    expect(result.docs).toEqual([]);
    expect(result.config).toEqual([]);
    expect(result.deps).toEqual([]);
    expect(result.test).toEqual([]);
  });

  it('assigns *.test.ts files to test bucket', () => {
    const result = categorizeFiles(['src/foo.test.ts']);
    expect(result.test).toEqual(['src/foo.test.ts']);
    expect(result.code).toEqual([]);
  });

  it('assigns *.spec.ts files to test bucket', () => {
    const result = categorizeFiles(['src/bar.spec.ts']);
    expect(result.test).toEqual(['src/bar.spec.ts']);
    expect(result.code).toEqual([]);
  });

  it('assigns *.test.tsx files to test bucket', () => {
    const result = categorizeFiles(['src/component.test.tsx']);
    expect(result.test).toEqual(['src/component.test.tsx']);
    expect(result.code).toEqual([]);
  });

  it('assigns *.spec.jsx files to test bucket', () => {
    const result = categorizeFiles(['src/widget.spec.jsx']);
    expect(result.test).toEqual(['src/widget.spec.jsx']);
    expect(result.code).toEqual([]);
  });

  it('assigns files under test/ directory to test bucket', () => {
    const result = categorizeFiles(['test/helpers.ts']);
    expect(result.test).toEqual(['test/helpers.ts']);
    expect(result.code).toEqual([]);
  });

  it('assigns files under tests/ directory to test bucket', () => {
    const result = categorizeFiles(['tests/utils.ts']);
    expect(result.test).toEqual(['tests/utils.ts']);
    expect(result.code).toEqual([]);
  });

  it('assigns files under __tests__/ directory to test bucket', () => {
    const result = categorizeFiles(['src/__tests__/foo.ts']);
    expect(result.test).toEqual(['src/__tests__/foo.ts']);
    expect(result.code).toEqual([]);
  });

  it('assigns regular code files to code, not test', () => {
    const result = categorizeFiles(['src/foo.ts']);
    expect(result.code).toEqual(['src/foo.ts']);
    expect(result.test).toEqual([]);
  });
});

describe('determineApplicableReviews', () => {
  it('returns code only for ordinary code files (no automatic security)', () => {
    const categories: FileCategories = {
      code: ['src/app.ts'],
      api: [],
      docs: [],
      config: [],
      deps: [],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toEqual(['code']);
  });

  it('returns security + code for security-sensitive code files', () => {
    const categories: FileCategories = {
      code: ['src/auth.ts'],
      api: [],
      docs: [],
      config: [],
      deps: [],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toContain('security');
    expect(result).toContain('code');
    // security ranks above code
    expect(result.indexOf('security')).toBeLessThan(result.indexOf('code'));
  });

  it('adds api perspective for API files (no security for non-sensitive routes)', () => {
    const categories: FileCategories = {
      code: ['a.ts'],
      api: ['src/routes/users.ts'],
      docs: [],
      config: [],
      deps: [],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toContain('code');
    expect(result).toContain('api');
    expect(result).not.toContain('security');
  });

  it('adds docs perspective for doc files', () => {
    const categories: FileCategories = {
      code: [],
      api: [],
      docs: ['README.md'],
      config: [],
      deps: [],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toEqual(['docs']);
  });

  it('returns security + verify for deps-only changes', () => {
    const categories: FileCategories = {
      code: [],
      api: [],
      docs: [],
      config: [],
      deps: ['package.json'],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toContain('security');
    expect(result).toContain('verify');
    // security ranks above verify
    expect(result.indexOf('security')).toBeLessThan(result.indexOf('verify'));
    expect(result).not.toContain('code');
  });

  it('returns security + verify + code for deps + code changes', () => {
    const categories: FileCategories = {
      code: ['a.ts'],
      api: [],
      docs: [],
      config: [],
      deps: ['package.json'],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toContain('code');
    expect(result).toContain('security');
    expect(result).toContain('verify');
    // security > verify > code by risk rank
    expect(result.indexOf('security')).toBeLessThan(result.indexOf('verify'));
    expect(result.indexOf('verify')).toBeLessThan(result.indexOf('code'));
  });

  it('returns verify for config-only changes', () => {
    const categories: FileCategories = {
      code: [],
      api: [],
      docs: [],
      config: ['.eslintrc.json'],
      deps: [],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toEqual(['verify']);
  });

  it('adds test + verify for test files', () => {
    const categories: FileCategories = {
      code: [],
      api: [],
      docs: [],
      config: [],
      deps: [],
      test: ['x.test.ts'],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toContain('test');
    expect(result).toContain('verify');
    // verify ranks above test
    expect(result.indexOf('verify')).toBeLessThan(result.indexOf('test'));
  });

  it('does not add security for test-only files without security-sensitive names', () => {
    const categories: FileCategories = {
      code: [],
      api: [],
      docs: [],
      config: [],
      deps: [],
      test: ['x.test.ts'],
    };
    const result = determineApplicableReviews(categories);
    expect(result).not.toContain('security');
  });

  it('docs-only changes infer docs only (no verify)', () => {
    const categories: FileCategories = {
      code: [],
      api: [],
      docs: ['docs/guide.md'],
      config: [],
      deps: [],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toEqual(['docs']);
    expect(result).not.toContain('verify');
  });

  it('api-only routes without security-sensitive names infer api only', () => {
    const categories: FileCategories = {
      code: [],
      api: ['src/routes/users.ts'],
      docs: [],
      config: [],
      deps: [],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toEqual(['api']);
  });
});

describe('isSecuritySensitivePath', () => {
  it('matches auth in filename', () => {
    expect(isSecuritySensitivePath('src/auth.ts')).toBe(true);
  });

  it('matches authentication as prefix', () => {
    expect(isSecuritySensitivePath('src/authentication.ts')).toBe(true);
  });

  it('matches session-store via hyphen', () => {
    expect(isSecuritySensitivePath('src/session-store.ts')).toBe(true);
  });

  it('matches token in filename', () => {
    expect(isSecuritySensitivePath('src/token-validator.ts')).toBe(true);
  });

  it('matches secret in filename', () => {
    expect(isSecuritySensitivePath('src/secret-manager.ts')).toBe(true);
  });

  it('matches http-client', () => {
    expect(isSecuritySensitivePath('src/http-client.ts')).toBe(true);
  });

  it('matches webhook in filename', () => {
    expect(isSecuritySensitivePath('src/webhook.ts')).toBe(true);
  });

  it('matches jwt in filename', () => {
    expect(isSecuritySensitivePath('src/jwt-utils.ts')).toBe(true);
  });

  it('matches oauth in filename', () => {
    expect(isSecuritySensitivePath('src/oauth-provider.ts')).toBe(true);
  });

  it('matches exec as prefix (executor)', () => {
    expect(isSecuritySensitivePath('src/executor.ts')).toBe(true);
  });

  it('does not match ordinary app.ts', () => {
    expect(isSecuritySensitivePath('src/app.ts')).toBe(false);
  });

  it('does not match utils.ts', () => {
    expect(isSecuritySensitivePath('src/utils.ts')).toBe(false);
  });

  it('does not match effects.ts (exec is not a substring here)', () => {
    // 'effects' does not start with 'exec'
    expect(isSecuritySensitivePath('src/effects.ts')).toBe(false);
  });

  it('matches auth directory in path', () => {
    expect(isSecuritySensitivePath('src/auth/handler.ts')).toBe(true);
  });

  it('matches filesystem in filename', () => {
    expect(isSecuritySensitivePath('src/filesystem.ts')).toBe(true);
  });

  it('matches cors in filename', () => {
    expect(isSecuritySensitivePath('src/cors-middleware.ts')).toBe(true);
  });
});

describe('shouldParallelizeReview', () => {
  it('returns false below both thresholds', () => {
    expect(shouldParallelizeReview(['a.ts'], { lines: 100 })).toBe(false);
  });

  it('returns true at 10 files', () => {
    expect(shouldParallelizeReview(Array(10).fill('a.ts'), { lines: 100 })).toBe(true);
  });

  it('returns false at 9 files below line threshold', () => {
    expect(shouldParallelizeReview(Array(9).fill('a.ts'), { lines: 499 })).toBe(false);
  });

  it('returns true at 500 lines', () => {
    expect(shouldParallelizeReview(['a.ts'], { lines: 500 })).toBe(true);
  });

  it('returns true when both thresholds exceeded', () => {
    expect(shouldParallelizeReview(Array(15).fill('a.ts'), { lines: 1000 })).toBe(true);
  });

  it('returns false for empty file list', () => {
    expect(shouldParallelizeReview([], { lines: 0 })).toBe(false);
  });
});

describe('selectInitialReviewPerspectives — ordinary code', () => {
  it('returns [code] for ordinary src/app.ts with budget 2', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/app.ts'], changedLines: 10 });
    expect(result.perspectives).toEqual(['code']);
    expect(result.budget).toBe(2);
  });

  it('returns [security, code] for auth-sensitive code with budget 2', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/auth.ts'], changedLines: 10 });
    expect(result.perspectives).toContain('security');
    expect(result.perspectives).toContain('code');
    expect(result.perspectives.indexOf('security')).toBeLessThan(result.perspectives.indexOf('code'));
  });

  it('raises budget to 3 for security-sensitive changes', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/auth.ts'], changedLines: 10 });
    expect(result.budget).toBe(3);
    expect(result.riskSignals.length).toBeGreaterThan(0);
  });
});

describe('selectInitialReviewPerspectives — deps and config', () => {
  it('infers security + verify for dependency/lockfiles', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['pnpm-lock.yaml'], changedLines: 50 });
    expect(result.perspectives).toContain('security');
    expect(result.perspectives).toContain('verify');
    expect(result.perspectives).not.toContain('code');
  });

  it('infers verify for config-only changes', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['tsconfig.json'], changedLines: 5 });
    expect(result.perspectives).toContain('verify');
    expect(result.perspectives).not.toContain('security');
    expect(result.perspectives).not.toContain('code');
  });

  it('infers verify + test for test-only changes', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['test/app.test.ts'], changedLines: 30 });
    expect(result.perspectives).toContain('verify');
    expect(result.perspectives).toContain('test');
    expect(result.perspectives).not.toContain('security');
  });

  it('excludes verify for docs-only changes', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['docs/guide.md'], changedLines: 20 });
    expect(result.perspectives).toEqual(['docs']);
    expect(result.perspectives).not.toContain('verify');
  });
});

describe('selectInitialReviewPerspectives — api paths', () => {
  it('infers api for API route files without security terms', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/routes/users.ts'], changedLines: 40 });
    expect(result.perspectives).toContain('api');
    expect(result.perspectives).not.toContain('security');
  });

  it('infers api + security for auth-related API route', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/routes/auth.ts'], changedLines: 40 });
    expect(result.perspectives).toContain('api');
    expect(result.perspectives).toContain('security');
  });
});

describe('selectInitialReviewPerspectives — budget and ranking', () => {
  it('applies budget cap of 2 for normal-risk changes', () => {
    // code + docs = 2 perspectives, fits within budget
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/app.ts', 'docs/guide.md'], changedLines: 30 });
    expect(result.perspectives.length).toBeLessThanOrEqual(result.budget);
    expect(result.budget).toBe(2);
  });

  it('raises budget to 3 for large changesets', () => {
    const files = Array.from({ length: 10 }, (_, i) => `src/module${i}.ts`);
    const result = selectInitialReviewPerspectives({ changedFiles: files, changedLines: 600 });
    expect(result.budget).toBe(3);
  });

  it('records budget rule in rules array', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/app.ts'], changedLines: 10 });
    expect(result.rules).toContain('normal-risk change — budget 2');
  });

  it('records security-critical budget rule when security signal fires', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/auth.ts'], changedLines: 10 });
    expect(result.rules).toContain('security-critical change — budget raised to 3');
  });

  it('returns perspectives in risk-ranked order (security > verify > api > code > test > docs)', () => {
    // test file + dep file gives: test, verify, security; budget is raised to 3 by dependency risk.
    const result = selectInitialReviewPerspectives({ changedFiles: ['test/app.test.ts', 'package.json'], changedLines: 20 });
    expect(result.perspectives).toEqual(['security', 'verify', 'test']);
  });

  it('includes categories in the result', () => {
    const result = selectInitialReviewPerspectives({ changedFiles: ['src/app.ts', 'docs/guide.md'], changedLines: 10 });
    expect(result.categories).toContain('code');
    expect(result.categories).toContain('docs');
  });
});
