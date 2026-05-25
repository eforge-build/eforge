import { describe, it, expect } from 'vitest';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { runCohesionReview } from '@eforge-build/engine/agents/cohesion-reviewer';
import { runCohesionEvaluate } from '@eforge-build/engine/agents/plan-evaluator';
import { runPlanReview } from '@eforge-build/engine/agents/plan-reviewer';
import { runArchitectureReview } from '@eforge-build/engine/agents/architecture-reviewer';
import type { EforgeEvent } from '@eforge-build/engine/events';

// --- Cohesion Reviewer ---

describe('runCohesionReview wiring', () => {
  it('emits cohesion review lifecycle events', async () => {
    const backend = new StubHarness([{ text: '<review-issues></review-issues>' }]);

    const events = await collectEvents(runCohesionReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-expedition',
      architectureContent: '# Architecture\nModular design.',
      cwd: '/tmp',
    }));

    expect(findEvent(events, 'planning:cohesion:start')).toBeDefined();
    const complete = findEvent(events, 'planning:cohesion:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toHaveLength(0);
    // agent:result should always be yielded
    expect(findEvent(events, 'agent:result')).toBeDefined();
  });

  it('parses review issues from cohesion review output', async () => {
    const backend = new StubHarness([{
      text: `<review-issues>
  <issue severity="critical" category="cohesion" file="plans/mod-a.md" line="15">File overlap: src/index.ts modified by both mod-a and mod-b without dependency</issue>
  <issue severity="warning" category="feasibility" file="plans/mod-b.md">Vague criterion: "tests pass properly" — replace with "pnpm test exits with code 0"<fix>Replaced "tests pass properly" with "pnpm test exits with code 0"</fix></issue>
  <issue severity="critical" category="dependency" file="plans/mod-c.md">Missing dependency: mod-c uses types from mod-a but does not list mod-a in depends_on</issue>
</review-issues>`,
    }]);

    const events = await collectEvents(runCohesionReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-expedition',
      architectureContent: '# Architecture',
      cwd: '/tmp',
    }));

    const complete = findEvent(events, 'planning:cohesion:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toHaveLength(3);
    expect(complete!.issues[0]).toMatchObject({
      severity: 'critical',
      category: 'cohesion',
      file: 'plans/mod-a.md',
      line: 15,
    });
    expect(complete!.issues[1]).toMatchObject({
      severity: 'warning',
      category: 'feasibility',
      file: 'plans/mod-b.md',
    });
    expect(complete!.issues[1].fix).toBe('Replaced "tests pass properly" with "pnpm test exits with code 0"');
    expect(complete!.issues[2]).toMatchObject({
      severity: 'critical',
      category: 'dependency',
    });
  });

  it('yields empty issues for plain text output (no XML)', async () => {
    const backend = new StubHarness([{ text: 'Everything looks good. No cross-module issues found.' }]);

    const events = await collectEvents(runCohesionReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-expedition',
      architectureContent: '# Architecture',
      cwd: '/tmp',
    }));

    const complete = findEvent(events, 'planning:cohesion:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toHaveLength(0);
  });

  it('uses coding tools', async () => {
    const backend = new StubHarness([{ text: '<review-issues></review-issues>' }]);

    await collectEvents(runCohesionReview({
      harness: backend,
      sourceContent: 'PRD',
      planSetName: 'test',
      architectureContent: '',
      cwd: '/tmp',
    }));

    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].tools).toBe('coding');
  });

  it('suppresses agent:message when verbose is false', async () => {
    const backend = new StubHarness([{ text: 'Some output.' }]);

    const events = await collectEvents(runCohesionReview({
      harness: backend,
      sourceContent: 'PRD',
      planSetName: 'test',
      architectureContent: '',
      cwd: '/tmp',
    }));

    expect(filterEvents(events, 'agent:message')).toHaveLength(0);
  });

  it('emits agent:message when verbose is true', async () => {
    const backend = new StubHarness([{ text: 'Some output.' }]);

    const events = await collectEvents(runCohesionReview({
      harness: backend,
      sourceContent: 'PRD',
      planSetName: 'test',
      architectureContent: '',
      cwd: '/tmp',
      verbose: true,
    }));

    expect(filterEvents(events, 'agent:message').length).toBeGreaterThan(0);
  });

  it('propagates errors (non-fatal handling is engine responsibility)', async () => {
    const backend = new StubHarness([{ error: new Error('Cohesion review crashed') }]);

    let thrown: Error | undefined;
    try {
      await collectEvents(runCohesionReview({
        harness: backend,
        sourceContent: 'PRD',
        planSetName: 'test',
        architectureContent: '',
        cwd: '/tmp',
      }));
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toBe('Cohesion review crashed');
  });
});

// --- Cohesion Evaluator ---

describe('runCohesionEvaluate wiring', () => {
  it('emits cohesion evaluation lifecycle events', async () => {
    const backend = new StubHarness([{
      text: `<evaluation>
  <verdict file="plans/mod-a.md" action="accept">
    <original>No dependency on mod-b</original>
    <fix>Added mod-b to depends_on</fix>
    <rationale>mod-a uses types from mod-b</rationale>
    <if-accepted>Correct dependency ordering</if-accepted>
    <if-rejected>Build failure when mod-a runs before mod-b</if-rejected>
  </verdict>
</evaluation>`,
    }]);

    const events = await collectEvents(runCohesionEvaluate({
      harness: backend,
      planSetName: 'my-expedition',
      sourceContent: 'PRD content',
      cwd: '/tmp',
    }));

    expect(findEvent(events, 'planning:cohesion:evaluate:start')).toBeDefined();
    const complete = findEvent(events, 'planning:cohesion:evaluate:complete');
    expect(complete).toBeDefined();
    expect(complete!.accepted).toBe(1);
    expect(complete!.rejected).toBe(0);
    expect(complete!.verdicts).toEqual([
      { file: 'plans/mod-a.md', action: 'accept', reason: 'mod-a uses types from mod-b' },
    ]);
    // agent:result should always be yielded
    expect(findEvent(events, 'agent:result')).toBeDefined();
  });

  it('counts evaluation verdicts correctly', async () => {
    const backend = new StubHarness([{
      text: `<evaluation>
  <verdict file="plans/a.md" hunk="1" action="accept">
    <original>Original</original>
    <fix>Fix</fix>
    <rationale>Good fix</rationale>
    <if-accepted>Better</if-accepted>
    <if-rejected>Worse</if-rejected>
  </verdict>
  <verdict file="plans/b.md" action="accept">
    <original>Original</original>
    <fix>Fix</fix>
    <rationale>Also good</rationale>
    <if-accepted>Better</if-accepted>
    <if-rejected>Worse</if-rejected>
  </verdict>
  <verdict file="plans/c.md" action="reject">
    <original>Original</original>
    <fix>Fix</fix>
    <rationale>Alters approach</rationale>
    <if-accepted>Different</if-accepted>
    <if-rejected>Same</if-rejected>
  </verdict>
  <verdict file="plans/d.md" action="review">
    <original>Original</original>
    <fix>Fix</fix>
    <rationale>Debatable</rationale>
    <if-accepted>Maybe better</if-accepted>
    <if-rejected>Status quo</if-rejected>
  </verdict>
</evaluation>`,
    }]);

    const events = await collectEvents(runCohesionEvaluate({
      harness: backend,
      planSetName: 'my-expedition',
      sourceContent: 'PRD content',
      cwd: '/tmp',
    }));

    const complete = findEvent(events, 'planning:cohesion:evaluate:complete');
    expect(complete).toBeDefined();
    expect(complete!.accepted).toBe(2);
    expect(complete!.rejected).toBe(2); // reject + review both count as rejected
    expect(complete!.verdicts).toEqual([
      { file: 'plans/a.md', hunk: 1, action: 'accept', reason: 'Good fix' },
      { file: 'plans/b.md', action: 'accept', reason: 'Also good' },
      { file: 'plans/c.md', action: 'reject', reason: 'Alters approach' },
      { file: 'plans/d.md', action: 'review', reason: 'Debatable' },
    ]);
  });

  it('emits zero counts and re-throws on error', async () => {
    const backend = new StubHarness([{ error: new Error('Evaluate crash') }]);

    let thrown: Error | undefined;
    const events: EforgeEvent[] = [];
    try {
      for await (const event of runCohesionEvaluate({
        harness: backend,
        planSetName: 'my-expedition',
        sourceContent: 'PRD content',
        cwd: '/tmp',
      })) {
        events.push(event);
      }
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toBe('Evaluate crash');

    const complete = findEvent(events, 'planning:cohesion:evaluate:complete');
    expect(complete).toBeDefined();
    expect(complete!.accepted).toBe(0);
    expect(complete!.rejected).toBe(0);
  });

  it('handles empty evaluation output', async () => {
    const backend = new StubHarness([{ text: 'No fixes to evaluate.' }]);

    const events = await collectEvents(runCohesionEvaluate({
      harness: backend,
      planSetName: 'my-expedition',
      sourceContent: 'PRD content',
      cwd: '/tmp',
    }));

    const complete = findEvent(events, 'planning:cohesion:evaluate:complete');
    expect(complete).toBeDefined();
    expect(complete!.accepted).toBe(0);
    expect(complete!.rejected).toBe(0);
  });

  it('uses coding tools with evaluator mutation tools denied', async () => {
    const backend = new StubHarness([{ text: '<evaluation></evaluation>' }]);

    await collectEvents(runCohesionEvaluate({
      harness: backend,
      planSetName: 'test',
      sourceContent: 'PRD',
      cwd: '/tmp',
    }));

    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].tools).toBe('coding');
    expect(backend.calls[0].disallowedTools).toEqual(expect.arrayContaining(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']));
  });
});

// ---------------------------------------------------------------------------
// Advisory-only parser policy: planning reviewers (cohesion, plan, architecture)
// use the legacy fail-open parser — missing or malformed XML yields empty issues
// rather than synthetic critical contract violations.
// ---------------------------------------------------------------------------

describe('cohesion-reviewer advisory-only XML parsing policy', () => {
  it('yields empty issues when XML is missing entirely (advisory, not a contract violation)', async () => {
    const backend = new StubHarness([{ text: 'All modules look fine, no issues to report.' }]);
    const events = await collectEvents(runCohesionReview({
      harness: backend,
      sourceContent: 'PRD',
      planSetName: 'test',
      architectureContent: '',
      cwd: '/tmp',
    }));
    const complete = findEvent(events, 'planning:cohesion:complete');
    expect(complete).toBeDefined();
    // Advisory: missing XML → 0 issues (not a synthetic critical issue)
    expect(complete!.issues).toHaveLength(0);
  });

  it('merges issues from multiple XML blocks (legacy fail-open multi-block handling)', async () => {
    const backend = new StubHarness([{
      text: `<review-issues>
  <issue severity="critical" category="cohesion" file="plans/mod-a.md">File overlap</issue>
</review-issues>
<review-issues>
  <issue severity="warning" category="dependency" file="plans/mod-b.md">Missing dep</issue>
</review-issues>`,
    }]);
    const events = await collectEvents(runCohesionReview({
      harness: backend,
      sourceContent: 'PRD',
      planSetName: 'test',
      architectureContent: '',
      cwd: '/tmp',
    }));
    const complete = findEvent(events, 'planning:cohesion:complete');
    expect(complete).toBeDefined();
    // Advisory: multiple blocks → all issues merged (not a contract violation)
    expect(complete!.issues).toHaveLength(2);
  });

  it('omits line field for non-numeric line attribute (advisory, not a contract violation)', async () => {
    const backend = new StubHarness([{
      text: '<review-issues><issue severity="warning" category="cohesion" file="plans/mod-a.md" line="abc">Bad line</issue></review-issues>',
    }]);
    const events = await collectEvents(runCohesionReview({
      harness: backend,
      sourceContent: 'PRD',
      planSetName: 'test',
      architectureContent: '',
      cwd: '/tmp',
    }));
    const complete = findEvent(events, 'planning:cohesion:complete');
    expect(complete).toBeDefined();
    // Advisory: non-numeric line → issue included without line (not rejected)
    expect(complete!.issues).toHaveLength(1);
    expect(complete!.issues[0].line).toBeUndefined();
  });

  it('yields empty issues for malformed (unclosed) XML tag (advisory fail-open)', async () => {
    const backend = new StubHarness([{
      text: '<review-issues><issue severity="critical" category="cohesion" file="plans/mod-a.md">Unclosed tag</review-issues>',
    }]);
    const events = await collectEvents(runCohesionReview({
      harness: backend,
      sourceContent: 'PRD',
      planSetName: 'test',
      architectureContent: '',
      cwd: '/tmp',
    }));
    const complete = findEvent(events, 'planning:cohesion:complete');
    expect(complete).toBeDefined();
    // Advisory: malformed XML → 0 issues parsed, no contract-violation synthetic issue
    expect(complete!.issues).toHaveLength(0);
  });
});

describe('plan-reviewer advisory-only XML parsing policy', () => {
  it('yields empty issues when XML is missing entirely (advisory, not a contract violation)', async () => {
    const backend = new StubHarness([{ text: 'Plans look complete and well-specified.' }]);
    const events = await collectEvents(runPlanReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-expedition',
      cwd: '/tmp',
    }));
    const complete = findEvent(events, 'planning:review:complete');
    expect(complete).toBeDefined();
    // Advisory: missing XML → 0 issues (not a synthetic critical issue)
    expect(complete!.issues).toHaveLength(0);
  });

  it('parses issues from valid terminal XML block', async () => {
    const backend = new StubHarness([{
      text: '<review-issues><issue severity="critical" category="correctness" file="plans/plan-01.md">Missing step</issue></review-issues>',
    }]);
    const events = await collectEvents(runPlanReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-expedition',
      cwd: '/tmp',
    }));
    const complete = findEvent(events, 'planning:review:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toHaveLength(1);
    expect(complete!.issues[0].severity).toBe('critical');
  });

  it('yields empty issues for malformed (unclosed) XML tag (advisory fail-open)', async () => {
    const backend = new StubHarness([{
      text: '<review-issues><issue severity="critical" category="correctness" file="plans/plan-01.md">Unclosed tag</review-issues>',
    }]);
    const events = await collectEvents(runPlanReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-expedition',
      cwd: '/tmp',
    }));
    const complete = findEvent(events, 'planning:review:complete');
    expect(complete).toBeDefined();
    // Advisory: malformed XML → 0 issues parsed, no contract-violation synthetic issue
    expect(complete!.issues).toHaveLength(0);
  });
});

describe('architecture-reviewer advisory-only XML parsing policy', () => {
  it('yields empty issues when XML is missing entirely (advisory, not a contract violation)', async () => {
    const backend = new StubHarness([{ text: 'Architecture document is well-aligned with the PRD.' }]);
    const events = await collectEvents(runArchitectureReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-expedition',
      architectureContent: '# Architecture',
      cwd: '/tmp',
    }));
    const complete = findEvent(events, 'planning:architecture:review:complete');
    expect(complete).toBeDefined();
    // Advisory: missing XML → 0 issues (not a synthetic critical issue)
    expect(complete!.issues).toHaveLength(0);
  });

  it('parses issues from valid terminal XML block', async () => {
    const backend = new StubHarness([{
      text: '<review-issues><issue severity="warning" category="boundary" file="architecture.md">Module boundary unclear</issue></review-issues>',
    }]);
    const events = await collectEvents(runArchitectureReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-expedition',
      architectureContent: '# Architecture',
      cwd: '/tmp',
    }));
    const complete = findEvent(events, 'planning:architecture:review:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toHaveLength(1);
    expect(complete!.issues[0].severity).toBe('warning');
  });

  it('merges issues from multiple blocks (advisory legacy multi-block handling)', async () => {
    const backend = new StubHarness([{
      text: `<review-issues>
  <issue severity="critical" category="boundary" file="architecture.md">Issue A</issue>
</review-issues>
Some extra text.
<review-issues>
  <issue severity="warning" category="contract" file="architecture.md">Issue B</issue>
</review-issues>`,
    }]);
    const events = await collectEvents(runArchitectureReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-expedition',
      architectureContent: '# Architecture',
      cwd: '/tmp',
    }));
    const complete = findEvent(events, 'planning:architecture:review:complete');
    expect(complete).toBeDefined();
    // Advisory: multiple blocks → all issues merged (not a contract violation)
    expect(complete!.issues).toHaveLength(2);
  });

  it('yields empty issues for malformed (unclosed) XML tag (advisory fail-open)', async () => {
    const backend = new StubHarness([{
      text: '<review-issues><issue severity="critical" category="boundary" file="architecture.md">Unclosed tag</review-issues>',
    }]);
    const events = await collectEvents(runArchitectureReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-expedition',
      architectureContent: '# Architecture',
      cwd: '/tmp',
    }));
    const complete = findEvent(events, 'planning:architecture:review:complete');
    expect(complete).toBeDefined();
    // Advisory: malformed XML → 0 issues parsed, no contract-violation synthetic issue
    expect(complete!.issues).toHaveLength(0);
  });
});
