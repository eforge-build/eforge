import { describe, it, expect } from 'vitest';
import {
  categorizeFiles,
  determineApplicableReviews,
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
  it('returns code + security for code files', () => {
    const categories: FileCategories = {
      code: ['a.ts'],
      api: [],
      docs: [],
      config: [],
      deps: [],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toContain('code');
    expect(result).toContain('security');
    expect(result).toHaveLength(2);
  });

  it('adds api perspective for API files', () => {
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
    expect(result).toContain('security');
    expect(result).toContain('api');
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

  it('adds security for deps files without duplicating', () => {
    const categories: FileCategories = {
      code: ['a.ts'],
      api: [],
      docs: [],
      config: [],
      deps: ['package.json'],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    // code triggers code + security, deps also triggers security but it's already there
    expect(result).toContain('code');
    expect(result).toContain('security');
    expect(result).toHaveLength(2);
  });

  it('returns security only for deps-only changes', () => {
    const categories: FileCategories = {
      code: [],
      api: [],
      docs: [],
      config: [],
      deps: ['package.json'],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toEqual(['security']);
  });

  it('returns empty for config-only changes', () => {
    const categories: FileCategories = {
      code: [],
      api: [],
      docs: [],
      config: ['.eslintrc.json'],
      deps: [],
      test: [],
    };
    const result = determineApplicableReviews(categories);
    expect(result).toEqual([]);
  });

  it('adds test perspective for test files', () => {
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
  });

  it('does not add security for test-only files', () => {
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
    expect(result).toEqual(['test']);
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
