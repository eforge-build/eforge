import { describe, it, expect } from 'vitest';
import type { ReviewIssue, EforgeEvent, AgentRole } from '@eforge-build/engine/events';
import type { AgentRunOptions } from '@eforge-build/engine/harness';
import { AgentTerminalError } from '@eforge-build/engine/harness';
import type { ReviewerPerspectiveRegistration } from '@eforge-build/engine/extensions';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { deduplicateIssues, runParallelReview } from '@eforge-build/engine/agents/parallel-reviewer';
import { runReviewFixer } from '@eforge-build/engine/agents/review-fixer';

function expectUniqueIssueIds(issues: ReviewIssue[]): void {
  const issueIds = issues.map((issue) => issue.issueId);
  expect(issueIds.every((issueId) => typeof issueId === 'string' && issueId.length > 0)).toBe(true);
  expect(new Set(issueIds).size).toBe(issueIds.length);
}

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

  it('rethrows AgentTerminalError with error_max_turns subtype', async () => {
    const maxTurnsError = new AgentTerminalError('error_max_turns', 'Turn limit reached');
    const backend = new StubHarness([{ error: maxTurnsError }]);

    let thrown: unknown;
    try {
      await collectEvents(
        runReviewFixer({
          harness: backend,
          planId: 'plan-01',
          cwd: '/tmp/test',
          issues: [{ severity: 'warning', category: 'bugs', file: 'a.ts', description: 'Issue' }],
        }),
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(AgentTerminalError);
    expect((thrown as AgentTerminalError).subtype).toBe('error_max_turns');
  });
});

describe('runParallelReview — strict contract on parallel perspectives', () => {
  const validLateReviewXml = `<review-issues>
  <issue severity="warning" category="bug" file="src/parallel.ts" line="12">Parallel reviewer finding</issue>
</review-issues>`;

  it('assigns generated issue IDs containing round and perspective lane', async () => {
    const backend = new StubHarness([{ text: validLateReviewXml }]);

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-perspective-issue-ids',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code'],
        round: 2,
      }),
    );

    const perspectiveComplete = filterEvents(events, 'plan:build:review:parallel:perspective:complete')[0];
    expect(perspectiveComplete.issues[0].issueId).toBe('review-r2-code-1');
    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete!.issues[0].issueId).toBe('review-r2-code-1');
  });

  it('deduplicates aggregate issue IDs after supplied duplicates and generated collisions', async () => {
    class RoutedHarness extends StubHarness {
      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        const text = options.perspective === 'docs'
          ? '<review-issues><issue issueId="review-r3-aggregate-2" severity="warning" category="stale-docs" file="docs.md">Docs issue</issue></review-issues>'
          : '<review-issues><issue issueId="review-r3-aggregate-2" severity="warning" category="bugs" file="src/app.ts">Code issue</issue></review-issues>';
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
        planId: 'plan-test-aggregate-issue-id-collisions',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code', 'docs'],
        round: 3,
      }),
    );

    const complete = findEvent(events, 'plan:build:review:complete');
    const issueIds = complete!.issues.map((issue) => issue.issueId);
    expect(new Set(issueIds).size).toBe(issueIds.length);
    expect(issueIds).toEqual(['review-r3-aggregate-2', 'review-r3-aggregate-2-2']);
  });

  it('single delegation preserves parsed issues after a late transient reviewer error', async () => {
    const backend = new StubHarness([{
      resultText: validLateReviewXml,
      lateError: new AgentTerminalError('error_transient_transport', 'transport closed after result'),
    }]);

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-single-late-reviewer-error',
        cwd: '/tmp',
        strategy: 'single',
        round: 1,
      }),
    );

    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete).toBeDefined();
    expect(complete!.round).toBe(1);
    expect(complete!.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'bug', file: 'src/parallel.ts', issueId: 'review-r1-single-1' }),
    ]));
    expect(new Set(complete!.issues.map((issue) => issue.issueId)).size).toBe(complete!.issues.length);
    expect(complete!.issues.some(issue => issue.category === 'review-contract')).toBe(false);
  });

  it('built-in perspective preserves parsed issues after a late transient reviewer error', async () => {
    const backend = new StubHarness([{
      resultText: validLateReviewXml,
      lateError: new AgentTerminalError('error_transient_transport', 'transport closed after built-in perspective result'),
    }]);

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-built-in-late-reviewer-error',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code'],
      }),
    );

    const reviewerStart = findEvent(events, 'agent:start');
    expect(findEvent(events, 'agent:warning')).toMatchObject({
      code: 'reviewer-late-infrastructure-error-downgraded',
      agent: 'reviewer',
      planId: 'plan-test-built-in-late-reviewer-error',
      agentId: reviewerStart!.agentId,
    });
    const perspectiveComplete = filterEvents(events, 'plan:build:review:parallel:perspective:complete')[0];
    expect(perspectiveComplete.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'bug', file: 'src/parallel.ts' }),
    ]));
    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete!.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'bug', file: 'src/parallel.ts' }),
    ]));
    expect(complete!.issues.some(issue => issue.category === 'review-contract')).toBe(false);
  });

  it('single delegation preserves parsed issues after a late context-window reviewer error', async () => {
    const backend = new StubHarness([{
      resultText: validLateReviewXml,
      lateError: new AgentTerminalError('error_context_window', 'Backend error: input exceeds the context window after result'),
    }]);

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-single-late-context-reviewer-error',
        cwd: '/tmp',
        strategy: 'single',
        round: 1,
      }),
    );

    expect(findEvent(events, 'agent:warning')).toMatchObject({
      code: 'reviewer-late-infrastructure-error-downgraded',
      agent: 'reviewer',
      planId: 'plan-test-single-late-context-reviewer-error',
    });
    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete!.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'bug', file: 'src/parallel.ts', issueId: 'review-r1-single-1' }),
    ]));
    expect(complete!.issues.some(issue => issue.category === 'review-contract')).toBe(false);
  });

  it('salvages non-strict reviewer findings after a late context-window error', async () => {
    const nonStrictXml = `<review-issues>
  <issue severity="high">
    <title>Generated docs still advertise removed playbook host commands/tools</title>
    <evidence>
      <item path="web/content/reference/cli.md" line="12">Still documents removed commands.</item>
    </evidence>
    <recommendation>Run pnpm docs:generate and commit regenerated artifacts.</recommendation>
  </issue>
</review-issues>`;
    const backend = new StubHarness([{
      resultText: nonStrictXml,
      lateError: new AgentTerminalError('error_context_window', 'Backend error: input exceeds the context window after result'),
    }]);

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-late-context-salvage',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code'],
      }),
    );

    expect(filterEvents(events, 'plan:build:review:parallel:perspective:error')).toHaveLength(0);
    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete!.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'critical',
        category: 'reviewer-finding',
        file: 'web/content/reference/cli.md',
        line: 12,
        fix: 'Run pnpm docs:generate and commit regenerated artifacts.',
      }),
    ]));
    expect(complete!.issues.some(issue => issue.category === 'review-contract')).toBe(false);
  });

  it('extension perspective preserves parsed issues after a late transient reviewer error', async () => {
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
    const backend = new StubHarness([{
      resultText: validLateReviewXml,
      lateError: new AgentTerminalError('error_transient_transport', 'transport closed after extension perspective result'),
    }]);

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-extension-late-reviewer-error',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['accessibility'],
        extensionReviewerPerspectives: [registration],
      }),
    );

    const reviewerStart = findEvent(events, 'agent:start');
    const warning = findEvent(events, 'agent:warning');
    expect(warning).toMatchObject({
      code: 'reviewer-late-infrastructure-error-downgraded',
      agent: 'reviewer',
      planId: 'plan-test-extension-late-reviewer-error',
      agentId: reviewerStart!.agentId,
    });
    expect(warning?.message).toContain('accessibility');
    const perspectiveComplete = filterEvents(events, 'plan:build:review:parallel:perspective:complete')
      .find(event => event.perspective === 'accessibility');
    expect(perspectiveComplete?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'bug', file: 'src/parallel.ts' }),
    ]));
    expect(filterEvents(events, 'plan:build:review:parallel:perspective:error')
      .some(event => event.perspective === 'accessibility')).toBe(false);
    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete!.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'bug', file: 'src/parallel.ts' }),
    ]));
    expect(complete!.issues.some(issue => issue.category === 'review-contract')).toBe(false);
  });

  it('keeps a synthetic contract issue for one perspective while preserving another late-error perspective', async () => {
    class RoutedHarness extends StubHarness {
      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        const response = options.perspective === 'docs'
          ? { error: new AgentTerminalError('error_transient_transport', 'docs failed before output') }
          : {
              resultText: validLateReviewXml,
              lateError: new AgentTerminalError('error_transient_transport', 'code closed after result'),
            };
        for await (const event of new StubHarness([response]).run(options, agent, planId)) {
          yield event;
        }
      }
    }

    const events = await collectEvents(
      runParallelReview({
        harness: new RoutedHarness([]),
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-mixed-late-reviewer-error',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code', 'docs'],
      }),
    );

    expect(filterEvents(events, 'plan:build:review:parallel:perspective:error')).toHaveLength(1);
    const degraded = events.filter((event) => event.type === 'plan:build:decision' && (event as { decision: { kind: string } }).decision.kind === 'review-perspective-degraded');
    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toMatchObject({ decision: { perspective: 'docs' } });
    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete!.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'bug', file: 'src/parallel.ts' }),
      expect.objectContaining({ severity: 'critical', category: 'review-contract', file: 'reviewer-output' }),
    ]));
  });

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

    const docsComplete = events.find(
      (event): event is Extract<EforgeEvent, { type: 'plan:build:review:parallel:perspective:complete' }> =>
        event.type === 'plan:build:review:parallel:perspective:complete' && event.perspective === 'docs',
    );
    expect(docsComplete).toBeDefined();
    expect(docsComplete!.issues[0]?.issueId).toBe('review-r0-docs-1');

    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete).toBeDefined();

    // The aggregate must contain the synthetic critical issue from the docs
    // perspective contract violation — the complete event must NOT be clean.
    expect(complete!.issues.length).toBeGreaterThan(0);
    expect(
      complete!.issues.some((i) => i.severity === 'critical' && i.category === 'review-contract'),
    ).toBe(true);
    expectUniqueIssueIds(complete!.issues);
    expect(complete!.issues.map((issue) => issue.issueId)).toContain(docsComplete!.issues[0]!.issueId);
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
    expect(docsComplete!.issues[0]).toMatchObject({ issueId: 'review-r0-docs-1', severity: 'critical', category: 'review-contract', file: 'reviewer-output' });

    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ issueId: docsComplete!.issues[0]!.issueId, severity: 'critical', category: 'review-contract', file: 'reviewer-output' }),
    ]));
    expectUniqueIssueIds(complete!.issues);
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
      expect.objectContaining({ issueId: 'review-r0-docs-1', severity: 'critical', category: 'review-contract', file: 'reviewer-output' }),
    ]));
    expectUniqueIssueIds(complete!.issues);
    expect(complete!.issues[0].description).toContain('docs reviewer unavailable');
  });

  it('aggregate includes synthetic critical issue when one perspective returns trailing prose after the terminal block', async () => {
    class RoutedHarness extends StubHarness {
      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        const text = options.perspective === 'docs'
          ? '<review-issues></review-issues>\ntrailing prose'
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
        planId: 'plan-test-parallel-trailing-prose',
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
    expect(docsComplete!.issues[0]).toMatchObject({ issueId: 'review-r0-docs-1', severity: 'critical', category: 'review-contract', file: 'reviewer-output' });

    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ issueId: docsComplete!.issues[0]!.issueId, severity: 'critical', category: 'review-contract', file: 'reviewer-output' }),
    ]));
    expectUniqueIssueIds(complete!.issues);
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

describe('runParallelReview — read-only tool preset', () => {
  it('dispatches built-in perspective reviewers with read-only tools', async () => {
    const backend = new StubHarness([
      { text: '<review-issues></review-issues>' },
      { text: '<review-issues></review-issues>' },
    ]);

    await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-read-only-tools',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code', 'security'],
      }),
    );

    expect(backend.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of backend.calls) {
      expect(call.tools).toBe('read-only');
    }
  });

  it('dispatches extension perspective reviewers with read-only tools', async () => {
    const registration: ReviewerPerspectiveRegistration = {
      kind: 'reviewerPerspective',
      extensionName: 'test-ext',
      extensionPath: '/test/ext.js',
      name: 'accessibility',
      value: {
        key: 'accessibility',
        label: 'Accessibility Review',
        description: 'Check accessibility concerns.',
        promptFragment: 'Review keyboard and screen reader support.',
      },
    };

    const backend = new StubHarness([{
      text: '<review-issues></review-issues>',
    }]);

    await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nTest plan.',
        baseBranch: 'main',
        planId: 'plan-test-ext-read-only',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['accessibility'],
        extensionReviewerPerspectives: [registration],
      }),
    );

    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].tools).toBe('read-only');
  });
});
