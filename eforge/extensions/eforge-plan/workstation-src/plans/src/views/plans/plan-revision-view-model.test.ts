import { describe, expect, it } from 'vitest';
import type { PlanData, PlanRevisionTurnProjection } from '@/types';
import { chronologicalTurns, classifyRevisionTurn, currentSectionContent, defaultSelectedSections, revisionSummaryCounts, taskProgressText } from './plan-revision-view-model';

const patchTurn: PlanRevisionTurnProjection = { turnId: 'patch', taskId: 'task-patch', userMessage: 'patch', basePlanFingerprint: 'h', baseSectionHashes: [], createdAt: '2026-01-01T00:02:00.000Z', task: { taskId: 'task-patch', kind: 'k', status: 'completed', createdAt: '', updatedAt: '', result: { summary: '', assumptionsOpenQuestions: [], planRevisionTurn: { schemaVersion: 1, targetSession: 's', assistantMessage: 'Patch', basePlanFingerprint: 'h', proposedPatch: { sections: [{ dimension: 'scope', content: 'new' }] } } } } };
const answerTurn: PlanRevisionTurnProjection = { ...patchTurn, turnId: 'answer', taskId: 'task-answer', createdAt: '2026-01-01T00:01:00.000Z', task: { ...patchTurn.task!, taskId: 'task-answer', result: { summary: '', assumptionsOpenQuestions: [], planRevisionTurn: { schemaVersion: 1, targetSession: 's', assistantMessage: 'Answer', basePlanFingerprint: 'h', noPatchReason: 'answer' } } } };

describe('plan revision view model', () => {
  it('orders newest-first turns chronologically', () => {
    expect(chronologicalTurns([patchTurn, answerTurn]).map((turn) => turn.turnId)).toEqual(['answer', 'patch']);
  });

  it('classifies and summarizes mixed turn states', () => {
    const running = { ...patchTurn, turnId: 'run', task: { ...patchTurn.task!, status: 'running' as const } };
    const needs = { ...patchTurn, turnId: 'need', task: { ...patchTurn.task!, result: { summary: '', assumptionsOpenQuestions: [], decision: 'needs-input' as const, clarificationQuestions: [{ question: '?' }] } } };
    const unavailable = { ...patchTurn, turnId: 'gone', available: false, task: undefined };
    expect(classifyRevisionTurn(answerTurn)).toBe('answer');
    expect(classifyRevisionTurn(patchTurn)).toBe('patch');
    expect(classifyRevisionTurn(needs)).toBe('needs-input');
    expect(classifyRevisionTurn(running)).toBe('running');
    expect(classifyRevisionTurn(unavailable)).toBe('unavailable');
    expect(revisionSummaryCounts([running, patchTurn, needs, unavailable, { ...patchTurn, turnId: 'applied', appliedSections: ['scope'] }])).toMatchObject({ running: 1, patchReady: 2, needsInput: 1, failed: 1, appliedSections: 1 });
  });

  it('looks up acceptance-criteria content from acceptance criteria section keys', () => {
    const plan: PlanData = { session: 's', topic: 't', status: 'planning', sections: { 'acceptance criteria': 'AC body' } };
    expect(currentSectionContent(plan, 'acceptance-criteria')).toBe('AC body');
  });

  it('excludes already-applied sections from defaults', () => {
    expect(defaultSelectedSections({ ...patchTurn, appliedSections: ['scope'] })).toEqual([]);
  });

  it('summarizes running task section progress metadata', () => {
    expect(taskProgressText({ taskId: 'task-progress', kind: 'k', status: 'running', createdAt: '', updatedAt: '', metadata: { progressMessage: 'Drafting', sectionProgress: { currentSection: 'scope', coveredSections: ['problem-statement', 'scope'], remainingSections: ['acceptance-criteria', 'assumptions-and-validation'] } } })).toContain('Covered (2): problem-statement, scope');
  });
});
