import { describe, expect, it } from 'vitest';
import { runEforgePlanPlanningDraftTask } from '@eforge-build/engine/agents/extension-planning-task';
import { StubHarness } from './stub-harness.js';
import type { EforgeEvent } from '@eforge-build/engine/events';

async function collect<T>(iter: AsyncGenerator<EforgeEvent, T>): Promise<{ events: EforgeEvent[]; result: T }> {
  const events: EforgeEvent[] = [];
  while (true) {
    const next = await iter.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

const validSubmission = {
  summary: 'Drafted implementation planning content.',
  assumptionsOpenQuestions: ['Assume current session metadata is authoritative.'],
  planDrafts: [{ title: 'Implement planning task runner', body: '# Plan\n\nImplement the runner.' }],
};

const BODY_SHA = 'a'.repeat(64);

const validBacklogCurationDraft = {
  schemaVersion: 1,
  sourceFingerprint: '1111111111111111111111111111111111111111111111111111111111111111',
  summary: ['Curated stale backlog records.'],
  itemChanges: [{
    id: 'item-1',
    kind: 'item',
    precondition: { id: 'item-1', kind: 'item', bodySha256: BODY_SHA, sourceFingerprint: '1111111111111111111111111111111111111111111111111111111111111111' },
    metadata: { status: 'active', last_checked: '2026-01-01', stale_after: '2026-02-01' },
    sectionOperations: [{ heading: 'Evidence', action: 'append', content: 'Durable evidence from source text.' }],
    rationale: 'The item has fresh implementation evidence.',
    evidence: ['Source text says the implementation is still active.'],
  }],
  epicChanges: [],
  noOpRechecks: [],
  skipped: [],
  needsInput: [],
};

describe('eforge-plan planning draft task runner', () => {
  it('forces read-only tools and captures submitted planning results', async () => {
    const harness = new StubHarness([{
      toolCalls: [{
        tool: 'submit_eforge_plan_planning_result',
        toolUseId: 'tool-1',
        input: validSubmission,
        output: '',
      }],
    }]);

    const { result } = await collect(runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: { topic: 'Demo task' },
    }));

    expect(harness.calls[0]?.tools).toBe('read-only');
    expect(result.summary).toBe(validSubmission.summary);
    expect(result.assumptionsOpenQuestions.length).toBeGreaterThan(0);
    expect(result.planDrafts?.length).toBeGreaterThan(0);
  });

  it('does not forward runtime-only options to the harness run options', async () => {
    const harness = new StubHarness([{
      toolCalls: [{
        tool: 'submit_eforge_plan_planning_result',
        toolUseId: 'tool-1',
        input: validSubmission,
        output: '',
      }],
    }]);

    await collect(runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: { topic: 'Demo task' },
      verbose: true,
      taskId: 'task-1',
      model: { id: 'model-a' },
    }));

    expect(harness.calls[0]?.model).toEqual({ id: 'model-a' });
    expect(harness.calls[0]?.harness).not.toBe(harness);
    expect('input' in (harness.calls[0] as unknown as Record<string, unknown>)).toBe(false);
    expect('verbose' in (harness.calls[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('sanitizes progress updates and isolates progress callback errors', async () => {
    const progressInput = {
      currentSection: `Goal\u0000${'x'.repeat(300)}`,
      coveredSections: Array.from({ length: 60 }, (_, index) => `covered-${index}\u0007${'y'.repeat(300)}`),
      remainingSections: ['Validation\nDetails', 12, ''] as unknown[],
      message: `Working\u0001${'z'.repeat(300)}`,
    };
    const received: unknown[] = [];
    const harness = new StubHarness([{
      toolCalls: [
        { tool: 'report_eforge_plan_planning_progress', toolUseId: 'progress-1', input: progressInput, output: '' },
        { tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: validSubmission, output: '' },
      ],
    }]);

    const { result } = await collect(runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: { topic: 'Demo task' },
      onProgress: (update) => {
        received.push(update);
        throw new Error('progress sink unavailable');
      },
    }));

    expect(result.summary).toBe(validSubmission.summary);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ remainingSections: ['Validation Details'], message: expect.stringContaining('Working') });
    const update = received[0] as { currentSection: string; coveredSections: string[]; message: string };
    expect(update.currentSection.length).toBeLessThanOrEqual(200);
    expect(update.message.length).toBeLessThanOrEqual(200);
    expect(update.coveredSections).toHaveLength(50);
    expect(update.coveredSections.every((entry) => entry.length <= 200 && !/[\u0000-\u001f\u007f]/.test(entry))).toBe(true);
  });

  it('does not complete when the submission tool is not called', async () => {
    const harness = new StubHarness([{ text: 'Here is prose instead of a tool call.' }]);

    await expect(collect(runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: { topic: 'Demo task' },
    }))).rejects.toThrow('submit_eforge_plan_planning_result');
  });

  it('keeps a submitted planning result when a transient transport error arrives after submission', async () => {
    const harness = new StubHarness([{
      toolCalls: [{
        tool: 'submit_eforge_plan_planning_result',
        toolUseId: 'tool-1',
        input: validSubmission,
        output: '',
      }],
      lateError: new Error('Backend error: WebSocket error'),
    }]);

    const { events, result } = await collect(runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: { topic: 'Demo task' },
      taskId: 'task-transport',
    }));

    expect(result.summary).toBe(validSubmission.summary);
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent:warning', code: 'late-infrastructure-error-after-planning-submit', agentId: 'task-transport' }));
  });

  it('rejects submissions without an applicable output section', async () => {
    const harness = new StubHarness([{
      toolCalls: [{
        tool: 'submit_eforge_plan_planning_result',
        toolUseId: 'tool-1',
        input: { summary: 'Incomplete', assumptionsOpenQuestions: [] },
        output: '',
      }],
      text: 'I called the tool with an incomplete payload.',
    }]);

    await expect(collect(runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: { topic: 'Demo task' },
    }))).rejects.toThrow('submit_eforge_plan_planning_result');
    expect(harness.calls[0]?.tools).toBe('read-only');
  });

  it('accepts a valid backlog curation draft submission', async () => {
    const submission = {
      summary: 'Drafted backlog curation.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: validBacklogCurationDraft,
    };
    const harness = new StubHarness([{
      toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: submission, output: '' }],
    }]);

    const { result } = await collect(runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: { topic: 'Curate backlog', requestedOutputSections: ['backlogCurationDraft'] },
    }));

    expect(result.backlogCurationDraft?.schemaVersion).toBe(1);
    expect(result.backlogCurationDraft?.sourceFingerprint).toBe('1111111111111111111111111111111111111111111111111111111111111111');
  });

  it('exposes backlogCurationDraft in the submit tool schema and prompt guidance', async () => {
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: validSubmission, output: '' }] }]);

    await collect(runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: { topic: 'Curate backlog', requestedOutputSections: ['backlogCurationDraft'] },
    }));

    const submitTool = harness.customToolSets[0]?.find((tool) => tool.name === 'submit_eforge_plan_planning_result');
    expect((submitTool?.inputSchema as { properties?: Record<string, unknown> }).properties?.backlogCurationDraft).toBeDefined();
    expect(harness.prompts[0]).toContain('backlogCurationDraft');
    expect(harness.prompts[0]).toContain('sourceFingerprint');
    expect(harness.prompts[0]).toContain('durable evidence');
  });

  it('accepts model-submitted shipped item curation when strong git/PR evidence is cited', async () => {
    const sourceFingerprint = '2'.repeat(64);
    const submission = {
      summary: 'Marked shipped work from strong evidence.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        schemaVersion: 1,
        sourceFingerprint,
        summary: ['Strong shipped evidence supports closing item-ship.'],
        itemChanges: [{
          id: 'item-ship',
          kind: 'item',
          precondition: { id: 'item-ship', kind: 'item', bodySha256: BODY_SHA, sourceFingerprint },
          metadata: { status: 'shipped' },
          sectionOperations: [{ heading: 'Evidence', action: 'append', content: 'Shipped evidence: inferred from git/PR history — git abc123 / PR #9: ship item-ship' }],
          rationale: 'Strong reachable git/PR shipped evidence cites item-ship directly.',
          evidence: ['Shipped evidence: inferred from git/PR history — git abc123 / PR #9: ship item-ship'],
        }],
        epicChanges: [],
        noOpRechecks: [],
        skipped: [],
        needsInput: [],
      },
    };
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: submission, output: '' }] }]);

    const { result } = await collect(runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: {
        topic: 'Curate backlog',
        requestedOutputSections: ['backlogCurationDraft'],
        sourceText: JSON.stringify({ sourceFingerprint, shippedEvidenceCandidates: [{ itemId: 'item-ship', confidence: 'strong', evidenceSource: 'combined', evidenceLabel: 'Shipped evidence: inferred from git/PR history', citations: ['git abc123 / PR #9: ship item-ship'] }] }),
      },
    }));

    expect(result.backlogCurationDraft?.itemChanges[0]).toMatchObject({ id: 'item-ship', metadata: { status: 'shipped' }, evidence: [expect.stringContaining('Shipped evidence: inferred from git/PR history')] });
  });

  it('accepts model-submitted ambiguous title-only curation without a shipped item change', async () => {
    const sourceFingerprint = '3'.repeat(64);
    const submission = {
      summary: 'Routed ambiguous evidence to needs input.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        schemaVersion: 1,
        sourceFingerprint,
        summary: ['Ambiguous title-only evidence is not enough to mark shipped.'],
        itemChanges: [],
        epicChanges: [],
        noOpRechecks: [],
        skipped: [],
        needsInput: [{ id: 'item-ambiguous', kind: 'item', question: 'Confirm whether the title-only shipped evidence refers to this backlog item.', reason: 'Ambiguous shipped candidate: needs input — git def456: similar title only' }],
      },
    };
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: submission, output: '' }] }]);

    const { result } = await collect(runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: {
        topic: 'Curate backlog',
        requestedOutputSections: ['backlogCurationDraft'],
        sourceText: JSON.stringify({ sourceFingerprint, shippedEvidenceCandidates: [{ itemId: 'item-ambiguous', confidence: 'ambiguous', evidenceSource: 'git-history', evidenceLabel: 'Ambiguous shipped candidate: needs input', citations: ['git def456: similar title only'] }] }),
      },
    }));

    expect(result.backlogCurationDraft?.itemChanges).toEqual([]);
    expect(result.backlogCurationDraft?.needsInput[0]).toMatchObject({ id: 'item-ambiguous', reason: expect.stringContaining('Ambiguous shipped candidate: needs input') });
  });

  it('rejects structurally malformed backlog curation draft submissions', async () => {
    for (const patch of [
      { ...validBacklogCurationDraft.itemChanges[0], kind: 'task' },
      { ...validBacklogCurationDraft.itemChanges[0], precondition: { id: 'item-1', kind: 'item' } },
      { ...validBacklogCurationDraft.itemChanges[0], unexpected: true },
    ]) {
      const harness = new StubHarness([{
        toolCalls: [{
          tool: 'submit_eforge_plan_planning_result',
          toolUseId: 'tool-1',
          input: {
            summary: 'Malformed curation draft.',
            assumptionsOpenQuestions: [],
            backlogCurationDraft: { ...validBacklogCurationDraft, itemChanges: [patch] },
          },
          output: '',
        }],
      }]);

      await expect(collect(runEforgePlanPlanningDraftTask({
        harness,
        cwd: '/tmp',
        input: { topic: 'Curate backlog', requestedOutputSections: ['backlogCurationDraft'] },
      }))).rejects.toThrow('submit_eforge_plan_planning_result');
    }
  });

  it('returns creation-draft schema guidance when alias dimensions fail strict parsing', async () => {
    const malformedSubmission = {
      summary: 'Drafted a plan with heading aliases.',
      assumptionsOpenQuestions: [],
      decision: 'ready',
      sessionPlanCreationDraft: {
        session: 'demo-session',
        topic: 'Fix grouped UX bugs',
        planningType: 'bugfix',
        planningDepth: 'focused',
        sections: [
          { dimension: 'Goal', content: 'Fix grouped UX bugs.' },
          { dimension: 'Validation', content: 'Run UI checks.' },
        ],
      },
    };
    const harness = new StubHarness([{
      toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: malformedSubmission, output: '' }],
      text: 'The malformed creation draft was rejected.',
    }]);
    const events: EforgeEvent[] = [];
    const run = runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: {
        topic: 'Fix grouped UX bugs',
        requestedOutputSections: ['sessionPlanCreationDraft'],
        sessionPlanCreationReadiness: {
          dimensionContract: {} as never,
          resolved: {
            planningType: 'bugfix',
            planningDepth: 'focused',
            requiredDimensions: ['problem-statement', 'reproduction-steps', 'root-cause', 'acceptance-criteria', 'assumptions-and-validation'],
            optionalDimensions: [],
          },
        },
      },
    });

    await expect((async () => {
      while (true) {
        const next = await run.next();
        if (next.done) return next.value;
        events.push(next.value);
      }
    })()).rejects.toThrow('submit_eforge_plan_planning_result');

    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent:tool_result',
      tool: 'submit_eforge_plan_planning_result',
      output: expect.stringContaining('expected required dimension ids: problem-statement, reproduction-steps, root-cause, acceptance-criteria, assumptions-and-validation'),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent:tool_result',
      output: expect.stringContaining('Do not use display-heading aliases such as Goal, Scope, or Validation.'),
    }));
  });

  it('returns a submission rejection tool result for malformed backlog curation drafts', async () => {
    const malformedSubmission = {
      summary: 'Malformed curation draft.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        itemChanges: [{ ...validBacklogCurationDraft.itemChanges[0], precondition: { id: 'item-1', kind: 'item' } }],
      },
    };
    const harness = new StubHarness([{
      toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: malformedSubmission, output: '' }],
      text: 'The malformed submission was rejected.',
    }]);
    const events: EforgeEvent[] = [];
    const run = runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: { topic: 'Curate backlog', requestedOutputSections: ['backlogCurationDraft'] },
    });

    await expect((async () => {
      while (true) {
        const next = await run.next();
        if (next.done) return next.value;
        events.push(next.value);
      }
    })()).rejects.toThrow('submit_eforge_plan_planning_result');

    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent:tool_result',
      tool: 'submit_eforge_plan_planning_result',
      output: expect.stringContaining('Submission rejected:'),
    }));
  });

  it('rejects malformed backlog curation draft submissions without completing', async () => {
    const malformedSubmission = {
      summary: 'Malformed curation draft.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...validBacklogCurationDraft,
        itemChanges: [{ ...validBacklogCurationDraft.itemChanges[0], precondition: { id: 'item-1', kind: 'item' } }],
      },
    };
    const harness = new StubHarness([{
      toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: malformedSubmission, output: '' }],
      text: 'The malformed submission was rejected.',
    }]);

    await expect(collect(runEforgePlanPlanningDraftTask({
      harness,
      cwd: '/tmp',
      input: { topic: 'Curate backlog', requestedOutputSections: ['backlogCurationDraft'] },
    }))).rejects.toThrow('submit_eforge_plan_planning_result');
  });
});
