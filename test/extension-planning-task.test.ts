import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderPromptTemplate } from '@eforge-build/engine/prompts';
import { resolvePlanningAgentTask } from '../eforge/extensions/eforge-plan/agent-task-contributions.js';

const validSubmission = {
  summary: 'Drafted implementation planning content.',
  assumptionsOpenQuestions: ['Assume current session metadata is authoritative.'],
  planDrafts: [{ title: 'Implement planning task runner', body: '# Plan\n\nImplement the runner.' }],
};

describe('eforge-plan planning draft contribution', () => {
  it('declares read-only planning tools and captures submitted planning results', async () => {
    const resolved = resolvePlanningAgentTask({ input: { topic: 'Demo task' }, extensionName: 'eforge-plan', extensionPath: process.cwd(), signal: new AbortController().signal, effectiveCustomToolName: (name) => name });
    expect(resolved.run.role).toBe('planner');
    expect(resolved.run.tools.map((tool) => tool.name)).toEqual(['submit_eforge_plan_planning_result', 'report_eforge_plan_planning_progress']);
    await resolved.run.tools[0]!.handler(validSubmission);
    expect(resolved.getResult()?.summary).toBe(validSubmission.summary);
  });

  it('sanitizes progress updates and exposes backlog curation guidance through the extension asset', async () => {
    const received: unknown[] = [];
    const resolved = resolvePlanningAgentTask({ input: { topic: 'Curate backlog', requestedOutputSections: ['backlogCurationDraft'] }, extensionName: 'eforge-plan', extensionPath: process.cwd(), signal: new AbortController().signal, effectiveCustomToolName: (name) => name, onProgress: (update) => { received.push(update); } });
    await resolved.run.tools[1]!.handler({ currentSection: `Goal\u0000${'x'.repeat(300)}`, remainingSections: ['Validation\nDetails', 12, ''], message: `Working\u0001${'z'.repeat(300)}` });
    expect(received[0]).toMatchObject({ remainingSections: ['Validation Details'], message: expect.stringContaining('Working') });
    const template = await readFile('eforge/extensions/eforge-plan/prompts/eforge-plan-planning-draft.md', 'utf-8');
    const prompt = renderPromptTemplate(template, resolved.variables, undefined, 'eforge-plan-planning-draft');
    expect(prompt).toContain('backlogCurationDraft');
    expect(prompt).toContain('sourceFingerprint');
    expect(prompt).toContain('durable evidence');
  });

  it('rejects submissions without an applicable output section', async () => {
    const resolved = resolvePlanningAgentTask({ input: { topic: 'Demo task' }, extensionName: 'eforge-plan', extensionPath: process.cwd(), signal: new AbortController().signal, effectiveCustomToolName: (name) => name });
    const output = await resolved.run.tools[0]!.handler({ summary: 'Incomplete', assumptionsOpenQuestions: [] });
    expect(output).toContain('Submission rejected');
    expect(resolved.getResult()).toBeUndefined();
  });
});
