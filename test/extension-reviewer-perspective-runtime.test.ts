/**
 * Tests for the extension reviewer perspective runtime.
 *
 * Covers:
 * - Applicability evaluation (all rule types, including fn predicate)
 * - selectExtensionPerspectives — explicit keys, auto mode, diagnostics
 * - Prompt provenance composition
 * - Integration with runParallelReview via StubHarness (extension dispatch path)
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateApplicability,
  selectExtensionPerspectives,
  buildExtensionPerspectivePromptSection,
} from '@eforge-build/engine/extensions';
import type { ApplicabilityInput } from '@eforge-build/engine/extensions';
import type { ReviewerPerspectiveRegistration } from '@eforge-build/engine/extensions';
import { runParallelReview } from '@eforge-build/engine/agents/parallel-reviewer';
import { StubHarness } from './stub-harness.js';
import { collectEvents } from './test-events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistration(
  key: string,
  appliesTo?: ReviewerPerspectiveRegistration['value']['appliesTo'],
): ReviewerPerspectiveRegistration {
  return {
    kind: 'reviewerPerspective',
    extensionName: 'test-extension',
    extensionPath: '/test/ext.js',
    name: key,
    value: {
      key,
      label: `${key} label`,
      description: `${key} description`,
      promptFragment: `Check ${key} concerns.`,
      appliesTo,
    },
  };
}

const INPUT_WITH_FILES: ApplicabilityInput = {
  changedFiles: ['src/button.tsx', 'src/modal.tsx', 'packages/api/routes.ts'],
  changedLines: 200,
};

const EMPTY_INPUT: ApplicabilityInput = {
  changedFiles: [],
  changedLines: 0,
};

// ---------------------------------------------------------------------------
// evaluateApplicability
// ---------------------------------------------------------------------------

describe('evaluateApplicability', () => {
  it('returns applicable when appliesTo is undefined', async () => {
    const result = await evaluateApplicability(undefined, INPUT_WITH_FILES);
    expect(result.applicable).toBe(true);
  });

  it('returns applicable when appliesTo is empty object', async () => {
    const result = await evaluateApplicability({}, INPUT_WITH_FILES);
    expect(result.applicable).toBe(true);
  });

  describe('fileGlobs', () => {
    it('returns applicable when a file matches a glob', async () => {
      const result = await evaluateApplicability(
        { fileGlobs: ['**/*.tsx'] },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(true);
    });

    it('treats **/ as zero or more directories', async () => {
      await expect(evaluateApplicability(
        { fileGlobs: ['**/*.tsx'] },
        { changedFiles: ['Button.tsx'], changedLines: 4 },
      )).resolves.toMatchObject({ applicable: true });

      await expect(evaluateApplicability(
        { fileGlobs: ['src/**/*.ts'] },
        { changedFiles: ['src/index.ts'], changedLines: 4 },
      )).resolves.toMatchObject({ applicable: true });
    });

    it('passes a defensive copy of changed files to function predicates', async () => {
      const input: ApplicabilityInput = { changedFiles: ['src/button.tsx'], changedLines: 10 };
      const result = await evaluateApplicability(
        { fn: (changedFiles) => { changedFiles.push('mutated.ts'); return true; } },
        input,
      );
      expect(result.applicable).toBe(true);
      expect(input.changedFiles).toEqual(['src/button.tsx']);
    });

    it('returns not-applicable when no file matches any glob', async () => {
      const result = await evaluateApplicability(
        { fileGlobs: ['**/*.graphql'] },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(false);
      if (!result.applicable) expect(result.reason).toBe('not-applicable');
    });

    it('returns not-applicable when changedFiles is empty', async () => {
      const result = await evaluateApplicability(
        { fileGlobs: ['**/*.tsx'] },
        EMPTY_INPUT,
      );
      expect(result.applicable).toBe(false);
    });
  });

  describe('paths', () => {
    it('returns applicable when a file starts with a path prefix', async () => {
      const result = await evaluateApplicability(
        { paths: ['src/'] },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(true);
    });

    it('normalizes prefix without trailing slash', async () => {
      const result = await evaluateApplicability(
        { paths: ['src'] },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(true);
    });

    it('returns not-applicable when no file matches any path prefix', async () => {
      const result = await evaluateApplicability(
        { paths: ['infra/'] },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(false);
    });
  });

  describe('extensions', () => {
    it('returns applicable when a changed file has a matching extension', async () => {
      const result = await evaluateApplicability(
        { extensions: ['.tsx'] },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(true);
    });

    it('normalizes extensions without leading dot', async () => {
      const result = await evaluateApplicability(
        { extensions: ['tsx'] },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(true);
    });

    it('returns not-applicable when no file has a matching extension', async () => {
      const result = await evaluateApplicability(
        { extensions: ['.graphql'] },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(false);
    });
  });

  describe('categories', () => {
    it('returns applicable when changed files match a category', async () => {
      // src/button.tsx → code category
      const result = await evaluateApplicability(
        { categories: ['code'] },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(true);
    });

    it('returns not-applicable when category has no matching files', async () => {
      const result = await evaluateApplicability(
        { categories: ['deps'] },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(false);
    });

    it('uses the built-in categorization rules rather than treating unknown files as code', async () => {
      const result = await evaluateApplicability(
        { categories: ['code'] },
        { changedFiles: ['assets/logo.png'], changedLines: 1 },
      );
      expect(result.applicable).toBe(false);
    });
  });

  describe('minChangedFiles', () => {
    it('returns applicable when changedFiles.length >= minChangedFiles', async () => {
      const result = await evaluateApplicability(
        { minChangedFiles: 3 },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(true);
    });

    it('returns not-applicable when changedFiles.length < minChangedFiles', async () => {
      const result = await evaluateApplicability(
        { minChangedFiles: 10 },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(false);
    });
  });

  describe('minChangedLines', () => {
    it('returns applicable when changedLines >= minChangedLines', async () => {
      const result = await evaluateApplicability(
        { minChangedLines: 100 },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(true);
    });

    it('returns not-applicable when changedLines < minChangedLines', async () => {
      const result = await evaluateApplicability(
        { minChangedLines: 1000 },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(false);
    });
  });

  describe('fn predicate', () => {
    it('returns applicable when fn returns true', async () => {
      const result = await evaluateApplicability(
        { fn: async () => true },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(true);
    });

    it('returns not-applicable when fn returns false', async () => {
      const result = await evaluateApplicability(
        { fn: async () => false },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(false);
      if (!result.applicable) expect(result.reason).toBe('not-applicable');
    });

    it('returns applicability-error when fn throws', async () => {
      const result = await evaluateApplicability(
        { fn: async () => { throw new Error('fn exploded'); } },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(false);
      if (!result.applicable) {
        expect(result.reason).toBe('applicability-error');
        expect((result as { message?: string }).message).toContain('fn exploded');
      }
    });

    it('returns applicability-timeout when fn exceeds timeoutMs', async () => {
      const result = await evaluateApplicability(
        { fn: async () => new Promise<boolean>(() => {}) },
        INPUT_WITH_FILES,
        10, // very short timeout
      );
      expect(result.applicable).toBe(false);
      if (!result.applicable) {
        expect(result.reason).toBe('applicability-timeout');
        expect((result as { timeoutMs?: number }).timeoutMs).toBe(10);
      }
    });
  });

  describe('combined rules (AND semantics)', () => {
    it('requires all rules to pass', async () => {
      // fileGlobs passes but minChangedLines fails
      const result = await evaluateApplicability(
        { fileGlobs: ['**/*.tsx'], minChangedLines: 10000 },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(false);
    });

    it('succeeds when all rules pass', async () => {
      const result = await evaluateApplicability(
        { fileGlobs: ['**/*.tsx'], minChangedFiles: 1, minChangedLines: 50 },
        INPUT_WITH_FILES,
      );
      expect(result.applicable).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// selectExtensionPerspectives
// ---------------------------------------------------------------------------

describe('selectExtensionPerspectives', () => {
  it('returns all applicable perspectives in auto mode', async () => {
    const registrations = [
      makeRegistration('accessibility', { fileGlobs: ['**/*.tsx'] }),
      makeRegistration('performance'),
      makeRegistration('i18n', { fileGlobs: ['**/*.graphql'] }), // won't match
    ];

    const result = await selectExtensionPerspectives({
      registrations,
      applicabilityInput: INPUT_WITH_FILES,
    });

    expect(result.selectedKeys).toContain('accessibility');
    expect(result.selectedKeys).toContain('performance');
    expect(result.selectedKeys).not.toContain('i18n');
  });

  it('emits applied diagnostic for selected perspectives', async () => {
    const registrations = [makeRegistration('accessibility')];

    const result = await selectExtensionPerspectives({
      registrations,
      applicabilityInput: INPUT_WITH_FILES,
      planId: 'plan-01',
    });

    expect(result.diagnosticEvents).toContainEqual(
      expect.objectContaining({
        type: 'extension:reviewer-perspective:applied',
        perspectiveKey: 'accessibility',
        planId: 'plan-01',
      }),
    );
  });

  it('emits skipped diagnostic for non-applicable perspectives', async () => {
    const registrations = [
      makeRegistration('accessibility', { fileGlobs: ['**/*.graphql'] }),
    ];

    const result = await selectExtensionPerspectives({
      registrations,
      applicabilityInput: INPUT_WITH_FILES,
    });

    expect(result.selectedKeys).toHaveLength(0);
    expect(result.diagnosticEvents).toContainEqual(
      expect.objectContaining({
        type: 'extension:reviewer-perspective:skipped',
        perspectiveKey: 'accessibility',
        reason: 'not-applicable',
      }),
    );
  });

  describe('explicit keys mode', () => {
    it('only considers the specified extension keys', async () => {
      const registrations = [
        makeRegistration('accessibility'),
        makeRegistration('performance'),
      ];

      const result = await selectExtensionPerspectives({
        registrations,
        explicitKeys: ['performance', 'code'], // 'code' is built-in, 'performance' is extension
        applicabilityInput: INPUT_WITH_FILES,
      });

      expect(result.selectedKeys).toContain('performance');
      expect(result.selectedKeys).not.toContain('accessibility');
    });

    it('emits unknown-key diagnostic for unregistered extension keys', async () => {
      const result = await selectExtensionPerspectives({
        registrations: [],
        explicitKeys: ['unknown-perspective'],
        applicabilityInput: INPUT_WITH_FILES,
      });

      expect(result.diagnosticEvents).toContainEqual(
        expect.objectContaining({
          type: 'extension:reviewer-perspective:skipped',
          perspectiveKey: 'unknown-perspective',
          reason: 'unknown-key',
        }),
      );
    });

    it('silently skips built-in keys in explicit mode', async () => {
      const result = await selectExtensionPerspectives({
        registrations: [],
        explicitKeys: ['code', 'security'],
        applicabilityInput: INPUT_WITH_FILES,
      });

      // Built-in keys are handled by the built-in path; no diagnostic
      expect(result.selectedKeys).toHaveLength(0);
      expect(result.diagnosticEvents).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// buildExtensionPerspectivePromptSection
// ---------------------------------------------------------------------------

describe('buildExtensionPerspectivePromptSection', () => {
  it('includes extension name, extension path, key, label, description, and prompt fragment', () => {
    const section = buildExtensionPerspectivePromptSection('my-extension', '/path/to/ext.js', {
      key: 'accessibility',
      label: 'Accessibility Review',
      description: 'Check WCAG 2.1 compliance',
      promptFragment: 'Focus on ARIA roles and keyboard navigation.',
    });

    expect(section).toContain('my-extension');
    expect(section).toContain('/path/to/ext.js');
    expect(section).toContain('accessibility');
    expect(section).toContain('Accessibility Review');
    expect(section).toContain('Check WCAG 2.1 compliance');
    expect(section).toContain('Focus on ARIA roles and keyboard navigation.');
  });
});

// ---------------------------------------------------------------------------
// runParallelReview with extension perspectives
// ---------------------------------------------------------------------------

describe('runParallelReview with extension perspectives', () => {
  it('dispatches extension perspective using generic reviewer prompt with fragment', async () => {
    const backend = new StubHarness([{ text: '<review-issues></review-issues>' }]);

    const accessibilityReg = makeRegistration('accessibility');

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nBuild a button.',
        baseBranch: 'main',
        planId: 'plan-01',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['accessibility'],
        extensionReviewerPerspectives: [accessibilityReg],
      }),
    );

    // Reviewer should have been called once for the extension perspective
    expect(backend.prompts).toHaveLength(1);

    // The prompt should contain the extension provenance section
    const prompt = backend.prompts[0];
    expect(prompt).toContain('accessibility');
    expect(prompt).toContain('test-extension');
    expect(prompt).toContain('/test/ext.js');
    expect(prompt).toContain('Check accessibility concerns');

    // Standard parallel review lifecycle events should be emitted
    const reviewStart = events.find((e) => e.type === 'plan:build:review:start');
    const reviewComplete = events.find((e) => e.type === 'plan:build:review:complete');
    expect(reviewStart).toBeDefined();
    expect(reviewComplete).toBeDefined();
  });

  it('emits a skip diagnostic for unknown extension perspective key', async () => {
    const backend = new StubHarness([]);

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nDo work.',
        baseBranch: 'main',
        planId: 'plan-01',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['unknown-ext-perspective'],
        extensionReviewerPerspectives: [], // empty registry
      }),
    );

    // No harness calls since the perspective is unknown and skipped.
    expect(backend.prompts).toHaveLength(0);

    const skipped = events.find(
      (e) => e.type === 'extension:reviewer-perspective:skipped',
    ) as Extract<typeof events[0], { type: 'extension:reviewer-perspective:skipped' }> | undefined;
    expect(skipped).toBeDefined();
    expect(skipped?.perspectiveKey).toBe('unknown-ext-perspective');
    expect(skipped?.reason).toBe('unknown-key');
    expect(skipped?.message).toContain('not registered');
    expect(events.some((e) => e.type === 'plan:build:review:parallel:perspective:error')).toBe(false);
  });

  it('auto-selects applicable extension perspectives when not overriding', async () => {
    // In auto mode, extension perspectives are selected based on applicability
    const backend = new StubHarness([
      { text: '<review-issues></review-issues>' }, // for inferred built-in
      { text: '<review-issues></review-issues>' }, // for extension perspective
    ]);

    const extensionReg = makeRegistration('accessibility'); // always applicable

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nBuild features.',
        baseBranch: 'main',
        planId: 'plan-02',
        cwd: '/tmp',
        strategy: 'parallel',
        // no perspectives override — auto-inferred
        extensionReviewerPerspectives: [extensionReg],
      }),
    );

    // Should emit the applied diagnostic
    const applied = events.find(
      (e) => e.type === 'extension:reviewer-perspective:applied',
    ) as { type: 'extension:reviewer-perspective:applied'; perspectiveKey: string } | undefined;
    expect(applied?.perspectiveKey).toBe('accessibility');
  });

  it('emits reviewer-perspective diagnostics when extension perspectives are explicitly requested', async () => {
    const backend = new StubHarness([{ text: '<review-issues></review-issues>' }]);

    const extensionReg = makeRegistration('performance');

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan',
        baseBranch: 'main',
        planId: 'plan-03',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code', 'performance'], // 'code' built-in, 'performance' extension
        extensionReviewerPerspectives: [extensionReg],
      }),
    );

    // Diagnostic events for extension perspectives are emitted
    const applied = events.find(
      (e) => e.type === 'extension:reviewer-perspective:applied',
    ) as { type: 'extension:reviewer-perspective:applied'; perspectiveKey: string } | undefined;
    expect(applied?.perspectiveKey).toBe('performance');
  });
});
