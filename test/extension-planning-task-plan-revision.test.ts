import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderPromptTemplate } from '@eforge-build/engine/prompts';
import { resolvePlanningAgentTask } from '../eforge/extensions/eforge-plan/agent-task-contributions.js';

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

describe('eforge-plan planning draft plan revision contribution', () => {
  it('accepts answer-only revision turns and exposes revision guidance', async () => {
    const resolved = resolvePlanningAgentTask({ input: { topic: 'Revise', requestedOutputSections: ['planRevisionTurn'], existingSessionPlan: '# Scope\nCurrent.' }, extensionName: 'eforge-plan', extensionPath: process.cwd(), signal: new AbortController().signal, effectiveCustomToolName: (name) => name });
    await resolved.run.tools[0]!.handler(answerOnlySubmission);
    expect(resolved.getResult()?.planRevisionTurn?.targetSession).toBe('demo-session');
    const template = await readFile('eforge/extensions/eforge-plan/prompts/eforge-plan-planning-draft.md', 'utf-8');
    const prompt = renderPromptTemplate(template, resolved.variables, undefined, 'eforge-plan-planning-draft');
    expect(prompt).toContain('planRevisionTurn');
    expect(prompt).toContain('basePlanFingerprint');
    expect(prompt).toContain('Answer-only turns are valid');
    expect(prompt).toContain('patch-bearing turns');
    expect(prompt).toContain('Do not claim that the session plan was modified');
  });

  it('rejects malformed revision submissions', async () => {
    const resolved = resolvePlanningAgentTask({ input: { topic: 'Revise', requestedOutputSections: ['planRevisionTurn'] }, extensionName: 'eforge-plan', extensionPath: process.cwd(), signal: new AbortController().signal, effectiveCustomToolName: (name) => name });
    const malformed = { ...answerOnlySubmission, planRevisionTurn: { ...answerOnlySubmission.planRevisionTurn, basePlanFingerprint: 'not-a-sha' } };
    const output = await resolved.run.tools[0]!.handler(malformed);
    expect(output).toContain('Submission rejected');
    expect(resolved.getResult()).toBeUndefined();
  });
});
