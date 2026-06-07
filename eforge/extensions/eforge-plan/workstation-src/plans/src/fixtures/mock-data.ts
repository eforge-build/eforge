import type { Artifact, Board, BoardItem, Detail, PlanData, PlanDetail, PlanningAgentTaskRecord, Readiness, RecommendationModel } from '@/types';

function card(input: Partial<BoardItem> & Pick<BoardItem, 'id' | 'title' | 'status' | 'lane'>): BoardItem {
  return {
    priority: 'medium',
    tags: [],
    reasons: [],
    unresolvedDependsOn: [],
    activeTraceReasons: [],
    blocked: false,
    ready: false,
    reviewDue: false,
    closed: false,
    dependencies: [],
    dependents: [],
    notes: { claim: '', evidence: '', recheck: '', promotionPaths: '' },
    recLanes: [],
    ...input,
  };
}

const items: BoardItem[] = [
  card({
    id: 'add-import-preview', title: 'Add import preview', status: 'planned', lane: 'ready', priority: 'high',
    tags: ['ux', 'cli'], ready: true, recRank: 2, epic: 'planning', epicRef: { id: 'planning', title: 'Planning workstation', status: 'active', missing: false },
    notes: { claim: 'Users want a dry-run preview before importing.', evidence: '', recheck: '', promotionPaths: '' },
  }),
  card({
    id: 'recommend-next-work', title: 'Maintain next-work recommendations', status: 'planned', lane: 'ready', priority: 'medium',
    ready: true, recRank: 1, recLanes: ['Planning foundations'], epic: 'planning', epicRef: { id: 'planning', title: 'Planning workstation', status: 'active', missing: false },
    dependents: [{ id: 'add-import-preview', title: 'Add import preview', status: 'planned', missing: false, blocking: false }],
  }),
  card({
    id: 'plan-workstation', title: 'Move planning into workstation', status: 'active', lane: 'in-progress', priority: 'high',
    activeTraceReasons: ['active build run trace run-12'], reasons: ['active build run trace run-12'],
    epic: 'planning', epicRef: { id: 'planning', title: 'Planning workstation', status: 'active', missing: false },
  }),
  card({
    id: 'auto-mode', title: 'Explore auto-mode draining', status: 'planned', lane: 'blocked', priority: 'low',
    blocked: true, unresolvedDependsOn: ['traceability'], recUnblock: 'Land traceability first, then re-scope.',
    dependencies: [{ id: 'traceability', title: 'Trace sidecars', status: 'planned', missing: false, blocking: true }],
    epic: 'extensions', epicRef: { id: 'extensions', title: 'Extension platform', status: 'planned', missing: false },
  }),
  card({
    id: 'traceability', title: 'Trace sidecars', status: 'planned', lane: 'ready', priority: 'medium', ready: true,
    dependents: [{ id: 'auto-mode', title: 'Explore auto-mode draining', status: 'planned', missing: false, blocking: true }],
  }),
  card({
    id: 'legacy-cleanup', title: 'Remove legacy board renderer', status: 'shipped', lane: 'done', priority: 'low', closed: true,
  }),
  card({
    id: 'stale-idea', title: 'Revisit cron triggers', status: 'planned', lane: 'inbox', priority: 'low', reviewDue: true,
  }),
];

export const mockBoard: Board = {
  lanes: ['inbox', 'ready', 'blocked', 'in-progress', 'done'].map((lane) => ({
    lane,
    title: lane.replace(/(^|-)([a-z])/g, (_match, _sep, char: string) => (lane === 'in-progress' ? 'In progress' : char.toUpperCase())),
    items: items.filter((item) => item.lane === lane),
  })),
  items,
  epics: [
    { id: 'planning', title: 'Planning workstation', status: 'active' },
    { id: 'extensions', title: 'Extension platform', status: 'planned' },
  ],
};

export const mockRecommendations: RecommendationModel = {
  schemaVersion: 1,
  activeWork: [],
  readyCandidates: [],
  recommendedNextSequence: [
    { ref: 'next-recommendations', itemId: 'recommend-next-work', rationale: 'Foundation for choosing useful follow-up work.' },
    { ref: 'next-import-preview', itemId: 'add-import-preview', rationale: 'Ready, scoped, and user-visible.' },
  ],
  safeParallelizableGroups: [
    { ref: 'planning-foundations', title: 'Planning foundations', itemIds: ['add-import-preview', 'recommend-next-work'], rationale: 'Shared workflow layer; plan together and implement in sequence.', recommendedProfile: 'excursion' },
  ],
  blockedChains: [
    { ref: 'auto-mode-chain', itemIds: ['auto-mode'], blockedBy: ['traceability'], rationale: 'Land traceability first, then re-scope.' },
  ],
  rationaleAndAssumptions: ['Favor extension-owned workflow UX over engine changes.', 'Keep recommendations in private extension storage.'],
};

// --- eforge:region plan-03-eforge-plan-ai-workstation-flow ---
export const mockPlanningTask: PlanningAgentTaskRecord = {
  taskId: 'task-mock-planning-draft',
  kind: 'eforge-plan.planning-draft',
  status: 'completed',
  createdAt: '2026-06-07T00:00:00.000Z',
  updatedAt: '2026-06-07T00:00:04.000Z',
  startedAt: '2026-06-07T00:00:01.000Z',
  completedAt: '2026-06-07T00:00:04.000Z',
  metadata: { progressMessage: 'Planner task completed', summary: 'Drafted focused planning output.', outputSectionCount: 2, warningCount: 1 },
  result: {
    summary: 'Drafted recommendations and a session-plan patch for the selected backlog work.',
    assumptionsOpenQuestions: ['Confirm whether import preview should be CLI-only or workstation-visible too.'],
    nextSteps: ['Preview the generated sections.', 'Apply only the pieces you want to keep.'],
    recommendations: mockRecommendations,
    handoffDrafts: [{ selection: { itemIds: ['import-preview'], status: 'active' }, session: '2026-06-07-import-preview' }],
    planDrafts: [{ title: 'Import preview plan', body: '# Import preview plan\n\n## Scope\n\nAdd an explicit preview before import writes.' }],
    playbookDraft: { name: 'planning-import-preview', body: '# Playbook\n\nUse this when import preview planning repeats.' },
    sessionPlanPatch: {
      sections: [
        { dimension: 'scope', content: 'Add a bounded import preview flow that shows generated changes before writing.' },
        { dimension: 'acceptance-criteria', content: '- Preview renders without writing files.\n- Apply requires explicit user action.' },
      ],
    },
  },
};
// --- eforge:endregion plan-03-eforge-plan-ai-workstation-flow ---

export const mockArtifacts: Artifact[] = [
  { key: 'plan:2026-06-07-import-preview', kind: 'plan', session: '2026-06-07-import-preview', title: 'Add import preview', status: 'planning', ready: false },
  { key: 'plan:2026-06-07-recommendations', kind: 'plan', session: '2026-06-07-recommendations', title: 'Recommendation engine', status: 'ready', ready: true },
  { key: 'plan-set:planning-foundations', kind: 'plan-set', planSetId: 'planning-foundations', title: 'Planning foundations', status: 'draft', childCount: 3 },
];

export function mockDetail(key: string): Detail {
  if (key.startsWith('plan-set:')) {
    return {
      planSet: {
        id: 'planning-foundations', title: 'Planning foundations', status: 'planning', strategy: 'dag',
        children: [
          { id: 'recommendations', file: 'recommendations.md', kind: 'plan', status: 'ready', buildable: true, exists: true, dependsOn: [], validation: { ok: true, diagnosticCount: 0 } },
          { id: 'import-preview', file: 'import-preview.md', kind: 'plan', status: 'planning', buildable: true, exists: true, dependsOn: ['recommendations'], validation: { ok: true, diagnosticCount: 0 } },
          { id: 'design-notes', file: 'design-notes.md', kind: 'note', status: 'planning', buildable: false, exists: false, dependsOn: [], validation: { ok: false, diagnosticCount: 1 } },
        ],
        diagnostics: [{ severity: 'error', code: 'missing-child-file', message: 'Child file design-notes.md does not exist.', childId: 'design-notes', file: 'design-notes.md' }],
      },
      validation: { ok: false, diagnostics: [{ severity: 'error', code: 'missing-child-file', message: 'Child file design-notes.md does not exist.', childId: 'design-notes', file: 'design-notes.md' }] },
      dir: '.eforge/session-plan-sets/planning-foundations',
      manifestPath: '.eforge/session-plan-sets/planning-foundations/manifest.yaml',
    };
  }
  const artifact = mockArtifacts.find((entry) => entry.key === key) ?? mockArtifacts[0];
  const ready = Boolean(artifact.ready);
  return {
    path: `.eforge/session-plans/${artifact.session}.md`,
    readiness: {
      ready,
      missingDimensions: ready ? [] : ['scope'],
      coveredDimensions: ready ? ['scope', 'acceptance-criteria'] : ['acceptance-criteria'],
      skippedDimensions: ['assumptions-and-validation'],
      acDiagnostics: ready ? [] : [{ kind: 'vague', line: '- It works well', message: 'Criterion is not objectively verifiable.', suggestion: 'State a measurable, testable outcome.' }],
    },
    plan: {
      session: artifact.session ?? 'mock-session', topic: artifact.title ?? 'Mock plan', status: artifact.status ?? 'planning',
      profile: 'excursion', planning_type: 'feature', planning_depth: 'focused', confidence: 'medium',
      required_dimensions: ['scope', 'acceptance-criteria', 'assumptions-and-validation'],
      optional_dimensions: [],
      skipped_dimensions: [{ name: 'assumptions-and-validation', reason: 'No external dependencies.' }],
      open_questions: ['What edge cases matter?'],
      sections: { scope: 'A friendly fixture for rapid UI iteration.', 'acceptance criteria': '- It renders.\n- It promotes.' },
      body: '# Mock plan\n\n## Scope\n\nA friendly fixture for rapid UI iteration.',
    },
  };
}

/**
 * Mutation result for the section/dimension/metadata actions in the mock bridge.
 * Returns a now-ready plan so the inline editors demonstrate the success path.
 */
export function mockMutationResult(session: string, patch: Partial<PlanData> = {}): { session: string; path: string; plan: PlanData; readiness: Readiness } {
  const detail = mockDetail(`plan:${session}`) as PlanDetail;
  const plan = detail.plan ?? { session, topic: 'Mock plan', status: 'planning' };
  return {
    session,
    path: detail.path ?? `.eforge/session-plans/${session}.md`,
    plan: { ...plan, status: 'ready', ...patch },
    readiness: { ready: true, missingDimensions: [], coveredDimensions: plan.required_dimensions ?? [], skippedDimensions: ['assumptions-and-validation'], acDiagnostics: [] },
  };
}
