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

const BUGFIX_FOCUSED_REQUIRED = [
  'problem-statement',
  'reproduction-steps',
  'root-cause',
  'acceptance-criteria',
  'assumptions-and-validation',
] as const;

const FEATURE_FOCUSED_REQUIRED = [
  'problem-statement',
  'scope',
  'acceptance-criteria',
  'code-impact',
  'design-decisions',
  'assumptions-and-validation',
] as const;

const compactDimensionContract = {
  bugfix: {
    quick: { requiredDimensions: ['problem-statement', 'reproduction-steps', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: ['code-impact', 'risks'] },
    focused: { requiredDimensions: [...BUGFIX_FOCUSED_REQUIRED], optionalDimensions: [] },
    deep: { requiredDimensions: [...BUGFIX_FOCUSED_REQUIRED], optionalDimensions: ['code-impact', 'risks'] },
  },
  feature: {
    quick: { requiredDimensions: ['problem-statement', 'scope', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: ['architecture-impact', 'documentation-impact', 'risks'] },
    focused: { requiredDimensions: [...FEATURE_FOCUSED_REQUIRED], optionalDimensions: [] },
    deep: { requiredDimensions: [...FEATURE_FOCUSED_REQUIRED], optionalDimensions: ['architecture-impact', 'documentation-impact', 'risks'] },
  },
  refactor: {
    quick: { requiredDimensions: ['scope', 'code-impact', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: ['design-decisions', 'risks'] },
    focused: { requiredDimensions: ['scope', 'code-impact', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: [] },
    deep: { requiredDimensions: ['scope', 'code-impact', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: ['design-decisions', 'risks'] },
  },
  architecture: {
    quick: { requiredDimensions: ['scope', 'architecture-impact', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: ['code-impact', 'documentation-impact', 'risks'] },
    focused: { requiredDimensions: ['scope', 'architecture-impact', 'design-decisions', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: [] },
    deep: { requiredDimensions: ['scope', 'architecture-impact', 'design-decisions', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: ['code-impact', 'documentation-impact', 'risks'] },
  },
  docs: {
    quick: { requiredDimensions: ['scope', 'documentation-impact', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: ['code-impact'] },
    focused: { requiredDimensions: ['scope', 'documentation-impact', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: [] },
    deep: { requiredDimensions: ['scope', 'documentation-impact', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: ['code-impact'] },
  },
  maintenance: {
    quick: { requiredDimensions: ['scope', 'code-impact', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: ['risks'] },
    focused: { requiredDimensions: ['scope', 'code-impact', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: [] },
    deep: { requiredDimensions: ['scope', 'code-impact', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: ['risks'] },
  },
  unknown: {
    quick: { requiredDimensions: ['scope', 'code-impact', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: [] },
    focused: { requiredDimensions: ['scope', 'code-impact', 'architecture-impact', 'design-decisions', 'documentation-impact', 'risks', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: [] },
    deep: { requiredDimensions: ['scope', 'code-impact', 'architecture-impact', 'design-decisions', 'documentation-impact', 'risks', 'acceptance-criteria', 'assumptions-and-validation'], optionalDimensions: [] },
  },
} as const;

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

function bugfixReadyCreationDraft(overrides: Record<string, unknown> = {}) {
  return {
    session: 'group-fast-ux-bugfixes',
    topic: 'Group fast UX bugfixes',
    planningType: 'bugfix',
    planningDepth: 'focused',
    sections: [
      { dimension: 'problem-statement', content: 'Grouped fast UX fixes regress dashboard refresh behavior.' },
      { dimension: 'reproduction-steps', content: 'Open the dashboard, apply a filter, and refresh.' },
      { dimension: 'root-cause', content: 'Filter state is reset before the refresh callback reads it.' },
      { dimension: 'acceptance-criteria', content: '- Dashboard preserves selected filters after refresh.' },
      { dimension: 'assumptions-and-validation', content: 'Validate with targeted UI coverage and a smoke check.' },
    ],
    ...overrides,
  };
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
    expect(hasEforgePlanPlanningDraftOutputSection(result)).toBe(false);
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

  it('accepts exact kebab-case readiness ids in creation-draft sections and skipped dimensions', () => {
    const parsed = parseEforgePlanPlanningDraftResult({
      summary: 'Drafted a ready bugfix plan.',
      assumptionsOpenQuestions: [],
      decision: 'ready',
      sessionPlanCreationDraft: bugfixReadyCreationDraft({
        skippedDimensions: [{ dimension: 'root-cause', reason: 'Known from incident notes and tracked for validation.' }],
      }),
    });

    expect(parsed).toMatchObject({
      decision: 'ready',
      sessionPlanCreationDraft: {
        planningType: 'bugfix',
        planningDepth: 'focused',
        sections: expect.arrayContaining([{ dimension: 'problem-statement', content: expect.any(String) }]),
      },
    });
  });

  it('rejects display-heading aliases in creation-draft section dimension fields', () => {
    const legacyAliasResult = {
      summary: 'Drafted a plan with friendly headings.',
      assumptionsOpenQuestions: [],
      decision: 'ready',
      sessionPlanCreationDraft: bugfixReadyCreationDraft({
        sections: [
          { dimension: 'Goal', content: 'Fix the grouped UX bug quickly.' },
          { dimension: 'Scope', content: 'Limit the fix to dashboard refresh behavior.' },
          { dimension: 'Validation', content: 'Run dashboard tests.' },
        ],
      }),
    };
    const result = safeParseEforgePlanPlanningDraftResult(legacyAliasResult);

    expect(result.success).toBe(false);
    expect(safeParseExtensionAgentTaskRecord(completedRecord(legacyAliasResult)).success).toBe(true);
  });

  it('rejects display-heading aliases in creation-draft skipped dimension fields', () => {
    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Drafted a plan with a friendly skip.',
      assumptionsOpenQuestions: [],
      decision: 'ready',
      sessionPlanCreationDraft: bugfixReadyCreationDraft({
        skippedDimensions: [{ dimension: 'Validation', reason: 'Covered elsewhere.' }],
      }),
    }).success).toBe(false);
  });

  it('keeps sessionPlanPatch dimensions flexible for non-creation and revision flows', () => {
    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Patch arbitrary section headings.',
      assumptionsOpenQuestions: [],
      sessionPlanPatch: {
        sections: [{ dimension: 'Validation Notes', content: 'Keep this free-form patch section.' }],
        skippedDimensions: [{ dimension: 'Friendly Skip', reason: 'Existing patch semantics allow arbitrary names.' }],
      },
    }).success).toBe(true);
  });

  it('accepts sessionPlanCreationReadiness task input context with full and resolved contracts', () => {
    expect(safeParseExtensionAgentTaskStartRequest({
      kind: 'eforge-plan.planning-draft',
      input: {
        topic: 'Plan grouped UX bugfixes',
        planningType: 'bugfix',
        planningDepth: 'focused',
        requestedOutputSections: ['sessionPlanCreationDraft'],
        sessionPlanCreationReadiness: {
          dimensionContract: compactDimensionContract,
          resolved: {
            planningType: 'bugfix',
            planningDepth: 'focused',
            requiredDimensions: [...BUGFIX_FOCUSED_REQUIRED],
            optionalDimensions: [],
          },
        },
      },
      requestedBy: { host: 'console', surface: 'workstation:eforge-plan' },
    }).success).toBe(true);
  });
});
