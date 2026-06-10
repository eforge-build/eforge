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
  sourceFingerprint: 'source-fingerprint-1',
  summary: ['Curated stale backlog records.'],
  itemChanges: [{
    id: 'item-1',
    kind: 'item',
    precondition: { id: 'item-1', kind: 'item', bodySha256: BODY_SHA, sourceFingerprint: 'source-fingerprint-1' },
    metadata: { status: 'active', last_checked: '2026-01-01', stale_after: '2026-02-01' },
    sectionOperations: [{ heading: 'Evidence', action: 'append', content: 'Durable evidence from source text.' }],
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
    expect(result.backlogCurationDraft?.sourceFingerprint).toBe('source-fingerprint-1');
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

  it('rejects backlog curation drafts with unsafe ids, bad statuses, or mismatched preconditions', async () => {
    for (const patch of [
      { id: 'item/1', kind: 'item', precondition: { id: 'item/1', kind: 'item', bodySha256: BODY_SHA }, metadata: { status: 'active' } },
      { id: 'item-1', kind: 'item', precondition: { id: 'item-1', kind: 'item', bodySha256: BODY_SHA }, metadata: { status: 'blocked' } },
      { id: 'item-1', kind: 'item', precondition: { id: 'other-item', kind: 'item', bodySha256: BODY_SHA }, metadata: { status: 'active' } },
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
