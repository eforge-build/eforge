import { describe, expect, it } from 'vitest';
import {
  hasEforgePlanPlanningDraftOutputSection,
  parseEforgePlanPlanningDraftResult,
  parseExtensionAgentTaskRecord,
  safeParseEforgePlanPlanningDraftResult,
  safeParseExtensionAgentTaskRecord,
  safeParseExtensionAgentTaskStartRequest,
  type ExtensionAgentTaskRecord,
} from '../index.js';

const readyCreationDraft = {
  summary: 'Created a session-plan draft for the topic.',
  assumptionsOpenQuestions: [],
  decision: 'ready' as const,
  sessionPlanCreationDraft: {
    session: 'demo-session',
    topic: 'Ship the workstation',
    planningType: 'feature',
    planningDepth: 'focused',
    profile: 'excursion',
    agentProfile: 'some-profile',
    sections: [{ dimension: 'scope', content: 'Generated scope content.' }],
  },
};

const needsInputResult = {
  summary: 'Cannot draft a ready session plan yet.',
  assumptionsOpenQuestions: [],
  decision: 'needs-input' as const,
  clarificationQuestions: [
    { question: 'Which milestone should this session plan target?', why: 'Scope depends on the milestone.' },
  ],
  rationale: 'The topic does not specify a milestone, which changes the plan scope materially.',
};

function completedRecord(result: unknown): ExtensionAgentTaskRecord {
  return {
    taskId: 'task-creation',
    kind: 'eforge-plan.planning-draft',
    status: 'completed',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:01.000Z',
    completedAt: '2025-01-01T00:00:01.000Z',
    metadata: { summary: 'done', outputSectionCount: 1 },
    result,
  } as ExtensionAgentTaskRecord;
}

describe('eforge-plan session-plan creation drafts and decisions', () => {
  it('accepts sessionPlanCreationDraft as a requested output section', () => {
    expect(safeParseExtensionAgentTaskStartRequest({
      kind: 'eforge-plan.planning-draft',
      input: { topic: 'Ship the workstation', requestedOutputSections: ['sessionPlanCreationDraft'] },
      requestedBy: { host: 'console', surface: 'workstation:eforge-plan' },
    }).success).toBe(true);
  });

  it('parses a completed ready creation draft with one generated section', () => {
    const result = parseEforgePlanPlanningDraftResult(readyCreationDraft);
    const draft = (result as typeof readyCreationDraft).sessionPlanCreationDraft;
    expect(draft.session).toBe('demo-session');
    expect(draft.topic).toBe('Ship the workstation');
    expect(draft.planningType).toBe('feature');
    expect(draft.planningDepth).toBe('focused');
    expect(draft.profile).toBe('excursion');
    expect(draft.agentProfile).toBe('some-profile');
    expect(draft.sections).toHaveLength(1);
    expect(hasEforgePlanPlanningDraftOutputSection(result)).toBe(true);
    expect(safeParseExtensionAgentTaskRecord(completedRecord(readyCreationDraft)).success).toBe(true);
  });

  it('parses a completed needs-input decision with a clarification question and rationale', () => {
    const result = parseEforgePlanPlanningDraftResult(needsInputResult);
    const needsInput = result as typeof needsInputResult;
    expect(needsInput.decision).toBe('needs-input');
    expect(needsInput.clarificationQuestions).toHaveLength(1);
    expect(needsInput.rationale.length).toBeGreaterThan(0);
    expect(hasEforgePlanPlanningDraftOutputSection(result)).toBe(true);
    expect(parseExtensionAgentTaskRecord(completedRecord(needsInputResult)).status).toBe('completed');
    expect(safeParseExtensionAgentTaskRecord(completedRecord(needsInputResult)).success).toBe(true);
  });

  it('rejects invalid creation draft and needs-input payloads', () => {
    expect(safeParseEforgePlanPlanningDraftResult({
      ...readyCreationDraft,
      sessionPlanCreationDraft: { ...readyCreationDraft.sessionPlanCreationDraft, sections: [] },
    }).success).toBe(false);
    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Ready without a draft',
      assumptionsOpenQuestions: [],
      decision: 'ready',
    }).success).toBe(false);
    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Needs input without questions',
      assumptionsOpenQuestions: [],
      decision: 'needs-input',
      clarificationQuestions: [],
      rationale: 'Missing questions.',
    }).success).toBe(false);
    expect(safeParseEforgePlanPlanningDraftResult({
      ...needsInputResult,
      rationale: '',
    }).success).toBe(false);
  });

  it('rejects a needs-input payload that also carries output sections', () => {
    expect(safeParseEforgePlanPlanningDraftResult({
      ...needsInputResult,
      handoffDraft: { selection: {} },
    }).success).toBe(false);
    expect(safeParseEforgePlanPlanningDraftResult({
      ...needsInputResult,
      handoffDrafts: [{ selection: {} }],
    }).success).toBe(false);
    expect(safeParseEforgePlanPlanningDraftResult({
      ...needsInputResult,
      recommendations: {
        schemaVersion: 1,
        activeWork: [],
        readyCandidates: [],
        recommendedNextSequence: [],
        safeParallelizableGroups: [],
        blockedChains: [],
        rationaleAndAssumptions: [],
      },
    }).success).toBe(false);
  });

  it('validates section-progress metadata on a running record', () => {
    expect(safeParseExtensionAgentTaskRecord({
      taskId: 'task-progress',
      kind: 'eforge-plan.planning-draft',
      status: 'running',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:01.000Z',
      startedAt: '2025-01-01T00:00:00.000Z',
      metadata: {
        progressMessage: 'Drafting section: scope',
        sectionProgress: { currentSection: 'scope', coveredSections: ['summary'], remainingSections: ['risks'] },
      },
    }).success).toBe(true);
    expect(safeParseExtensionAgentTaskRecord({
      taskId: 'task-progress',
      kind: 'eforge-plan.planning-draft',
      status: 'running',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:01.000Z',
      startedAt: '2025-01-01T00:00:00.000Z',
      metadata: { sectionProgress: { currentSection: 'scope', unexpected: true } },
    }).success).toBe(false);
  });
});
