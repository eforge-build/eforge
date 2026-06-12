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

const BASE_SHA = '1'.repeat(64);

const answerOnlySubmission = {
  summary: 'Answered the revision question.',
  assumptionsOpenQuestions: [],
  planRevisionTurn: {
    schemaVersion: 1,
    targetSession: 'demo-session',
    assistantMessage: 'No patch is needed because the plan already covers this.',
    basePlanFingerprint: BASE_SHA,
    noPatchReason: 'Already covered by the existing plan.',
  },
};

const patchBearingSubmission = {
  summary: 'Drafted revision patch.',
  assumptionsOpenQuestions: [],
  planRevisionTurn: {
    schemaVersion: 1,
    targetSession: 'demo-session',
    assistantMessage: 'I propose scope and acceptance criteria edits.',
    basePlanFingerprint: BASE_SHA,
    baseSectionHashes: [{ dimension: 'scope', sha256: '2'.repeat(64) }],
    proposedPatch: {
      sections: [
        { dimension: 'scope', content: 'Focus on the shared contract.' },
        { dimension: 'acceptance-criteria', content: 'Accept answer-only and patch-bearing turns.' },
      ],
    },
  },
};

describe('eforge-plan planning draft plan revision turns', () => {
  it('completes answer-only revision turns with read-only tools', async () => {
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: answerOnlySubmission, output: '' }] }]);
    const { result } = await collect(runEforgePlanPlanningDraftTask({ harness, cwd: '/tmp', input: { topic: 'Revise', requestedOutputSections: ['planRevisionTurn'] } }));
    expect(harness.calls[0]?.tools).toBe('read-only');
    expect(result.planRevisionTurn?.targetSession).toBe('demo-session');
  });

  it('exposes the submit schema and prompt guidance for revision turns', async () => {
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: answerOnlySubmission, output: '' }] }]);
    await collect(runEforgePlanPlanningDraftTask({ harness, cwd: '/tmp', input: { topic: 'Revise', requestedOutputSections: ['planRevisionTurn'], existingSessionPlan: '# Scope\nCurrent.' } }));
    const submitTool = harness.customToolSets[0]?.find((tool) => tool.name === 'submit_eforge_plan_planning_result');
    expect((submitTool?.inputSchema as { properties?: Record<string, unknown> }).properties?.planRevisionTurn).toBeDefined();
    expect(harness.prompts[0]).toContain('planRevisionTurn');
    expect(harness.prompts[0]).toContain('basePlanFingerprint');
    expect(harness.prompts[0]).toContain('Answer-only turns are valid');
    expect(harness.prompts[0]).toContain('patch-bearing turns');
    expect(harness.prompts[0]).toContain('Do not claim that the session plan was modified');
  });

  it('completes patch-bearing revision turns with proposed section edits', async () => {
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: patchBearingSubmission, output: '' }] }]);
    const { result } = await collect(runEforgePlanPlanningDraftTask({ harness, cwd: '/tmp', input: { topic: 'Revise', requestedOutputSections: ['planRevisionTurn'] } }));
    expect(result.planRevisionTurn?.proposedPatch?.sections).toHaveLength(2);
  });

  it('completes top-level needs-input revision clarification submissions', async () => {
    const needsInput = {
      summary: 'Need more input before revising.',
      assumptionsOpenQuestions: [],
      decision: 'needs-input',
      clarificationQuestions: [{ question: 'Which dimension should change?' }],
      rationale: 'The target section is ambiguous.',
    };
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: needsInput, output: '' }] }]);
    const { result } = await collect(runEforgePlanPlanningDraftTask({ harness, cwd: '/tmp', input: { topic: 'Revise', requestedOutputSections: ['planRevisionTurn'] } }));
    expect(result.decision).toBe('needs-input');
    expect(result.clarificationQuestions).toHaveLength(1);
  });

  it('rejects malformed revision submissions and does not complete', async () => {
    const malformed = { ...answerOnlySubmission, planRevisionTurn: { ...answerOnlySubmission.planRevisionTurn, basePlanFingerprint: 'not-a-sha' } };
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: malformed, output: '' }], text: 'Rejected.' }]);
    await expect(collect(runEforgePlanPlanningDraftTask({ harness, cwd: '/tmp', input: { topic: 'Revise', requestedOutputSections: ['planRevisionTurn'] } }))).rejects.toThrow('submit_eforge_plan_planning_result');
    expect(harness.calls[0]?.tools).toBe('read-only');
  });
});
