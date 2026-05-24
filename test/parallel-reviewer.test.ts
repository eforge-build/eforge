import { describe, it, expect } from 'vitest';
import type { ReviewIssue, EforgeEvent, AgentRole } from '@eforge-build/engine/events';
import type { AgentRunOptions } from '@eforge-build/engine/harness';
import type { ReviewerPerspectiveRegistration } from '@eforge-build/engine/extensions';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { deduplicateIssues, runParallelReview } from '@eforge-build/engine/agents/parallel-reviewer';
import { runReviewFixer } from '@eforge-build/engine/agents/review-fixer';

describe('deduplicateIssues', () => {
  it('removes exact duplicates keeping highest severity', () => {
    const issues: ReviewIssue[] = [
      { severity: 'warning', category: 'types', file: 'a.ts', line: 10, description: 'Unsafe cast' },
      { severity: 'critical', category: 'security', file: 'a.ts', line: 10, description: 'Unsafe cast' },
    ];

    const result = deduplicateIssues(issues);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('critical');
  });

  it('keeps distinct issues from different files', () => {
    const issues: ReviewIssue[] = [
      { severity: 'warning', category: 'bugs', file: 'a.ts', line: 10, description: 'Bug found' },
      { severity: 'warning', category: 'bugs', file: 'b.ts', line: 10, description: 'Bug found' },
    ];

    const result = deduplicateIssues(issues);
    expect(result).toHaveLength(2);
  });

  it('keeps issues with different lines in the same file', () => {
    const issues: ReviewIssue[] = [
      { severity: 'warning', category: 'bugs', file: 'a.ts', line: 10, description: 'Same desc' },
      { severity: 'warning', category: 'bugs', file: 'a.ts', line: 20, description: 'Same desc' },
    ];

    const result = deduplicateIssues(issues);
    expect(result).toHaveLength(2);
  });

  it('keeps issues with different descriptions at the same location', () => {
    const issues: ReviewIssue[] = [
      { severity: 'warning', category: 'bugs', file: 'a.ts', line: 10, description: 'Issue one' },
      { severity: 'warning', category: 'security', file: 'a.ts', line: 10, description: 'Issue two' },
    ];

    const result = deduplicateIssues(issues);
    expect(result).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(deduplicateIssues([])).toEqual([]);
  });

  it('handles issues without line numbers', () => {
    const issues: ReviewIssue[] = [
      { severity: 'suggestion', category: 'dry', file: 'a.ts', description: 'Extract method' },
      { severity: 'warning', category: 'dry', file: 'a.ts', description: 'Extract method' },
    ];

    const result = deduplicateIssues(issues);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warning');
  });
});

describe('runReviewFixer', () => {
  it('emits fix start and complete events', async () => {
    const backend = new StubHarness([{ text: 'Fixed all issues.' }]);

    const issues: ReviewIssue[] = [
      { severity: 'critical', category: 'bugs', file: 'a.ts', line: 10, description: 'Null pointer', fix: 'Add null check' },
    ];

    const events = await collectEvents(
      runReviewFixer({
        harness: backend,
        planId: 'plan-01',
        cwd: '/tmp/test',
        issues,
      }),
    );

    const fixStart = findEvent(events, 'plan:build:review:fix:start');
    expect(fixStart).toBeDefined();
    expect(fixStart!.planId).toBe('plan-01');
    expect(fixStart!.issueCount).toBe(1);

    const fixComplete = findEvent(events, 'plan:build:review:fix:complete');
    expect(fixComplete).toBeDefined();
    expect(fixComplete!.planId).toBe('plan-01');
  });

  it('runs with coding tools', async () => {
    const backend = new StubHarness([{ text: 'Done.' }]);

    await collectEvents(
      runReviewFixer({
        harness: backend,
        planId: 'plan-01',
        cwd: '/tmp/test',
        issues: [{ severity: 'warning', category: 'bugs', file: 'a.ts', description: 'Issue' }],
      }),
    );

    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].tools).toBe('coding');
  });

  it('uses review-fixer agent role', async () => {
    const backend = new StubHarness([{ text: 'Done.' }]);

    const events = await collectEvents(
      runReviewFixer({
        harness: backend,
        planId: 'plan-01',
        cwd: '/tmp/test',
        issues: [{ severity: 'warning', category: 'bugs', file: 'a.ts', description: 'Issue' }],
      }),
    );

    const agentStart = findEvent(events, 'agent:start');
    expect(agentStart).toBeDefined();
    expect(agentStart!.agent).toBe('review-fixer');
  });

  it('survives backend errors gracefully', async () => {
    const backend = new StubHarness([{ error: new Error('Backend failed') }]);

    // Should not throw — review fixer errors are non-fatal
    const events = await collectEvents(
      runReviewFixer({
        harness: backend,
        planId: 'plan-01',
        cwd: '/tmp/test',
        issues: [{ severity: 'warning', category: 'bugs', file: 'a.ts', description: 'Issue' }],
      }),
    );

    // Should still emit fix:start and fix:complete
    expect(findEvent(events, 'plan:build:review:fix:start')).toBeDefined();
    expect(findEvent(events, 'plan:build:review:fix:complete')).toBeDefined();
  });
});

// --- eforge:region plan-03-reviewer-contract-hardening ---
describe('runParallelReview — strict contract on parallel perspectives', () => {
  it('aggregate includes synthetic critical issue when one perspective returns no XML', async () => {
    // Route each perspective to a specific stub text to test the strict parser
    // on the parallel path independently for each perspective.
    class RoutedHarness extends StubHarness {
      private readonly perspectiveTexts: Record<string, string>;

      constructor(perspectiveTexts: Record<string, string>) {
        super([]);
        this.perspectiveTexts = perspectiveTexts;
      }

      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        const perspective = options.perspective;
        const text = perspective ? (this.perspectiveTexts[perspective] ?? '') : '';
        for await (const event of new StubHarness([{ text }]).run(options, agent, planId)) {
          yield event;
        }
      }
    }

    // code perspective returns a valid empty block; docs perspective returns plain
    // prose with no <review-issues> terminal block — a contract violation.
    const harness = new RoutedHarness({
      code: '<review-issues></review-issues>',
      docs: 'Everything looks fine with the documentation.',
    });

    const events = await collectEvents(
      runParallelReview({
        harness,
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-parallel-contract',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code', 'docs'],
      }),
    );

    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete).toBeDefined();

    // The aggregate must contain the synthetic critical issue from the docs
    // perspective contract violation — the complete event must NOT be clean.
    expect(complete!.issues.length).toBeGreaterThan(0);
    expect(
      complete!.issues.some((i) => i.severity === 'critical' && i.category === 'review-contract'),
    ).toBe(true);
  });

  it('aggregate includes synthetic critical issue when one perspective returns malformed XML', async () => {
    class RoutedHarness extends StubHarness {
      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        const text = options.perspective === 'docs'
          ? '<review-issues><issue severity="critical" category="docs" file="docs.md">unterminated</review-issues>'
          : '<review-issues></review-issues>';
        for await (const event of new StubHarness([{ text }]).run(options, agent, planId)) {
          yield event;
        }
      }
    }

    const events = await collectEvents(
      runParallelReview({
        harness: new RoutedHarness([]),
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-parallel-malformed-contract',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code', 'docs'],
      }),
    );

    const docsComplete = events.find(
      (event): event is Extract<EforgeEvent, { type: 'plan:build:review:parallel:perspective:complete' }> =>
        event.type === 'plan:build:review:parallel:perspective:complete' && event.perspective === 'docs',
    );
    expect(docsComplete).toBeDefined();
    expect(docsComplete!.issues).toHaveLength(1);
    expect(docsComplete!.issues[0]).toMatchObject({ severity: 'critical', category: 'review-contract', file: 'reviewer-output' });

    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'critical', category: 'review-contract', file: 'reviewer-output' }),
    ]));
  });

  it('aggregate includes synthetic critical issue when one perspective throws', async () => {
    class ThrowingHarness extends StubHarness {
      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        if (options.perspective === 'docs') {
          throw new Error('docs reviewer unavailable');
        }
        for await (const event of new StubHarness([{ text: '<review-issues></review-issues>' }]).run(options, agent, planId)) {
          yield event;
        }
      }
    }

    const events = await collectEvents(
      runParallelReview({
        harness: new ThrowingHarness([]),
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-parallel-throw-contract',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code', 'docs'],
      }),
    );

    expect(findEvent(events, 'plan:build:review:parallel:perspective:error')).toBeDefined();
    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'critical', category: 'review-contract', file: 'reviewer-output' }),
    ]));
    expect(complete!.issues[0].description).toContain('docs reviewer unavailable');
  });

  it('aggregate includes synthetic critical issue when an extension perspective violates the contract', async () => {
    const registration: ReviewerPerspectiveRegistration = {
      kind: 'reviewerPerspective',
      extensionName: 'test-extension',
      extensionPath: '/test/ext.js',
      name: 'accessibility',
      value: {
        key: 'accessibility',
        label: 'Accessibility Review',
        description: 'Check accessibility concerns.',
        promptFragment: 'Review keyboard and screen reader support.',
      },
    };
    const backend = new StubHarness([{ text: 'Accessibility looks good.' }]);

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-extension-contract',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['accessibility'],
        extensionReviewerPerspectives: [registration],
      }),
    );

    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'critical', category: 'review-contract', file: 'reviewer-output' }),
    ]));
  });
});
// --- eforge:endregion plan-03-reviewer-contract-hardening ---
