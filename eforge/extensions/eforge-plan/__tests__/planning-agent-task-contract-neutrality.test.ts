import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { StartPlanningAgentTaskInputSchema } from '../planning-agent-task-schemas.js';
import { createPlanningDraftSubmitTool } from '../planning-agent-tools.js';

const removedSection = ['play', 'book', 'Draft'].join('');

describe('planning agent task contract neutrality', () => {
  it('accepts remaining start requested-output sections and rejects the removed one', () => {
    for (const section of ['recommendations', 'handoffDrafts', 'planDrafts', 'sessionPlanPatch', 'sessionPlanCreationDraft']) {
      expect(Value.Check(StartPlanningAgentTaskInputSchema, { userGoal: 'Plan it', requestedOutputSections: [section] }), section).toBe(true);
    }
    expect(Value.Check(StartPlanningAgentTaskInputSchema, { userGoal: 'Plan it', requestedOutputSections: [removedSection] })).toBe(false);
  });

  it('rejects final submissions carrying the removed result field', async () => {
    const { tool, getSubmitted, getRejections } = createPlanningDraftSubmitTool({});
    const response = await tool.handler({
      summary: 'Drafted output.',
      assumptionsOpenQuestions: [],
      planDrafts: [{ title: 'Plan', body: 'Body.' }],
      [removedSection]: { name: 'Draft', body: 'Body.' },
    });
    expect(String(response)).toContain('Submission rejected');
    expect(getSubmitted()).toBeUndefined();
    expect(getRejections()).toHaveLength(1);
  });

  it('omits the removed section from planning prompt guidance', () => {
    const prompt = readFileSync(new URL('../prompts/eforge-plan-planning-draft.md', import.meta.url), 'utf8');
    expect(prompt).not.toContain(removedSection);
  });
});
