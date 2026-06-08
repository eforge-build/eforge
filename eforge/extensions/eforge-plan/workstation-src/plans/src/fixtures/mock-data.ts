import type { AppliedSessionPlanCreationDraft, Artifact, Board, BoardItem, Detail, GetRecommendationsResponse, JsonObject, PlanData, PlanDetail, PlanningAgentTaskListItem, PlanningAgentTaskRecord, PlanningTaskWorkflowEntry, PlanningTaskWorkflowSelection, Readiness, RecommendationModel, RecommendationStatus, RefreshRecommendationsResponse } from '@/types';

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

export const mockRecommendationStatusMissing: RecommendationStatus = {
  state: 'missing',
  currentPath: 'mock://recommendations/current.json',
  statusPath: 'mock://recommendations/status.json',
  staleReasons: [],
};

export const mockRecommendationStatusFresh: RecommendationStatus = {
  state: 'fresh',
  currentPath: 'mock://recommendations/current.json',
  statusPath: 'mock://recommendations/status.json',
  sourceFingerprint: 'fresh-source-fingerprint',
  lastAppliedSourceFingerprint: 'fresh-source-fingerprint',
  staleReasons: [],
};

export const mockRecommendationStatusStale: RecommendationStatus = {
  state: 'stale',
  currentPath: 'mock://recommendations/current.json',
  statusPath: 'mock://recommendations/status.json',
  sourceFingerprint: 'current-source-fingerprint',
  lastAppliedSourceFingerprint: 'old-source-fingerprint',
  staleReasons: [
    { code: 'source-fingerprint-drift', message: 'Recommendation source fingerprint drifted since the model was last applied.', sourceFingerprint: 'current-source-fingerprint', lastAppliedSourceFingerprint: 'old-source-fingerprint' },
    { code: 'backlog-mutation:update-item', message: 'Recommendations are stale after eforge-plan backlog mutation update-item for add-import-preview.' },
  ],
};

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

export const mockActiveRecommendationRefreshTask: PlanningAgentTaskRecord = {
  taskId: 'task-refresh-recommendations',
  kind: 'eforge-plan.planning-draft',
  status: 'running',
  createdAt: '2026-06-07T00:20:00.000Z',
  updatedAt: '2026-06-07T00:20:04.000Z',
  startedAt: '2026-06-07T00:20:01.000Z',
  metadata: { progressMessage: 'Refreshing recommendations…', sectionProgress: { currentSection: 'recommendations', coveredSections: [], remainingSections: [] } },
};

export const mockGetRecommendationsFreshResponse: GetRecommendationsResponse = {
  recommendations: mockRecommendations,
  recommendationSummary: { recommendedNextItemIds: ['recommend-next-work', 'add-import-preview'], safeParallelizableGroups: [{ ref: 'planning-foundations', itemIds: ['add-import-preview', 'recommend-next-work'] }], blockedChainCount: 1, rationaleAndAssumptions: mockRecommendations.rationaleAndAssumptions ?? [] },
  path: 'mock://recommendations/current.json',
  status: mockRecommendationStatusFresh,
};

export const mockGetRecommendationsMissingResponse: GetRecommendationsResponse = {
  recommendations: null,
  path: 'mock://recommendations/current.json',
  status: mockRecommendationStatusMissing,
};

export const mockGetRecommendationsStaleResponse: GetRecommendationsResponse = {
  recommendations: mockRecommendations,
  path: 'mock://recommendations/current.json',
  status: mockRecommendationStatusStale,
  activeRefreshTask: mockActiveRecommendationRefreshTask,
};

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

// --- Durable planning task workflow fixtures ---
//
// These fixtures keep the mock bridge stateful enough to exercise the AI-first
// workstation flow during local UI development: a running task with section
// progress, a failed task that can be retried, a needs-input clarification task
// that can be redrafted, and a ready creation-draft task whose apply refreshes
// the Plans artifact list.

const TASK_KIND = 'eforge-plan.planning-draft';
export const MOCK_CREATION_DRAFT_SESSION = '2026-06-07-ai-promoted-plan';

function workflowEntry(input: Partial<PlanningTaskWorkflowEntry> & Pick<PlanningTaskWorkflowEntry, 'taskId'>): PlanningTaskWorkflowEntry {
  return {
    originalRequest: '',
    derivedRequest: 'Draft a session plan for the selected backlog work.',
    selection: { itemIds: ['add-import-preview'] },
    requestedOutputSections: ['sessionPlanCreationDraft'],
    createdAt: '2026-06-07T00:00:00.000Z',
    ...input,
  };
}

const mockRunningTask: PlanningAgentTaskRecord = {
  taskId: 'task-running-creation', kind: TASK_KIND, status: 'running',
  createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:00:02.000Z', startedAt: '2026-06-07T00:00:01.000Z',
  metadata: {
    progressMessage: 'Drafting session-plan sections…',
    sectionProgress: { currentSection: 'acceptance-criteria', coveredSections: ['scope'], remainingSections: ['assumptions-and-validation'] },
  },
};

const mockFailedTask: PlanningAgentTaskRecord = {
  taskId: 'task-failed-creation', kind: TASK_KIND, status: 'failed',
  createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:00:05.000Z', startedAt: '2026-06-07T00:00:01.000Z', completedAt: '2026-06-07T00:00:05.000Z',
  errorCode: 'planning-agent-error', errorMessage: 'The planning agent run failed before drafting a session plan.',
};

const mockNeedsInputTask: PlanningAgentTaskRecord = {
  taskId: 'task-needs-input', kind: TASK_KIND, status: 'completed',
  createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:00:04.000Z', startedAt: '2026-06-07T00:00:01.000Z', completedAt: '2026-06-07T00:00:04.000Z',
  metadata: { summary: 'Needs input before drafting.' },
  result: {
    summary: 'A few questions before drafting the session plan.',
    assumptionsOpenQuestions: [],
    decision: 'needs-input',
    rationale: 'The selected items leave the scope of import preview ambiguous.',
    clarificationQuestions: [
      { question: 'Should import preview be CLI-only or also workstation-visible?', why: 'Determines UI scope and acceptance criteria.', options: ['CLI-only', 'CLI + workstation'] },
      { question: 'Is a dry-run preview required before any writes?' },
    ],
  },
};

const mockReadyCreationDraftTask: PlanningAgentTaskRecord = {
  taskId: 'task-ready-creation', kind: TASK_KIND, status: 'completed',
  createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:00:06.000Z', startedAt: '2026-06-07T00:00:01.000Z', completedAt: '2026-06-07T00:00:06.000Z',
  metadata: { summary: 'Drafted a ready session plan.', outputSectionCount: 2 },
  result: {
    summary: 'Drafted a ready session plan for the selected backlog work.',
    assumptionsOpenQuestions: ['Confirm rollout order with the planning epic owner.'],
    nextSteps: ['Review the drafted sections.', 'Create the session plan when ready.'],
    decision: 'ready',
    sessionPlanCreationDraft: {
      session: MOCK_CREATION_DRAFT_SESSION,
      topic: 'Add import preview',
      planningType: 'feature',
      planningDepth: 'focused',
      sections: [
        { dimension: 'scope', content: 'Add a bounded import preview flow that shows generated changes before writing.' },
        { dimension: 'acceptance-criteria', content: '- Preview renders without writing files.\n- Apply requires explicit user action.' },
      ],
    },
  },
};

export const mockPlanningTaskList: PlanningAgentTaskListItem[] = [
  { entry: workflowEntry({ taskId: mockRunningTask.taskId, derivedRequest: 'Draft a session plan for Add import preview.' }), available: true, status: 'running', task: mockRunningTask },
  { entry: workflowEntry({ taskId: mockNeedsInputTask.taskId, derivedRequest: 'Draft a session plan for an ambiguous selection.' }), available: true, status: 'completed', task: mockNeedsInputTask },
  { entry: workflowEntry({ taskId: mockReadyCreationDraftTask.taskId, derivedRequest: 'Draft a session plan for Add import preview.', session: MOCK_CREATION_DRAFT_SESSION }), available: true, status: 'completed', task: mockReadyCreationDraftTask },
  { entry: workflowEntry({ taskId: mockFailedTask.taskId, derivedRequest: 'Draft a session plan that failed.' }), available: true, status: 'failed', task: mockFailedTask },
];

const dynamicPlanningTasks: PlanningAgentTaskListItem[] = [];
const appliedCreationDraftArtifacts: Artifact[] = [];
let dynamicTaskCounter = 0;
let activeRecommendationRefreshTask: PlanningAgentTaskRecord | null = null;

function selectionFromMockInput(input: JsonObject): PlanningTaskWorkflowSelection {
  return {
    ...(Array.isArray(input.itemIds) && { itemIds: input.itemIds as string[] }),
    ...(typeof input.epicId === 'string' && { epicId: input.epicId }),
    ...(typeof input.recommendationRef === 'string' && { recommendationRef: input.recommendationRef }),
  };
}

function describeSelection(selection: PlanningTaskWorkflowSelection): string {
  if (selection.recommendationRef) return `Draft a session plan for recommendation ${selection.recommendationRef}.`;
  if (selection.epicId) return `Draft a session plan for epic ${selection.epicId}.`;
  if (selection.itemIds && selection.itemIds.length > 0) return `Draft a session plan for ${selection.itemIds.join(', ')}.`;
  return 'Draft a session plan for the open backlog.';
}

function pushDynamicTask(params: { selection?: PlanningTaskWorkflowSelection; derivedRequest: string; parentTaskId?: string; idPrefix: string; entryPatch?: Partial<PlanningTaskWorkflowEntry> }): { task: PlanningAgentTaskRecord; entry: PlanningTaskWorkflowEntry } {
  dynamicTaskCounter += 1;
  const taskId = `${params.idPrefix}-${dynamicTaskCounter}`;
  const now = '2026-06-07T00:10:00.000Z';
  const task: PlanningAgentTaskRecord = {
    taskId, kind: TASK_KIND, status: 'running', createdAt: now, updatedAt: now, startedAt: now,
    metadata: { progressMessage: params.entryPatch?.purpose === 'recommendation-refresh' ? 'Refreshing recommendations…' : 'Preparing planner context…', sectionProgress: { currentSection: params.entryPatch?.purpose === 'recommendation-refresh' ? 'recommendations' : 'scope', coveredSections: [], remainingSections: params.entryPatch?.purpose === 'recommendation-refresh' ? [] : ['acceptance-criteria'] } },
  };
  const entry = workflowEntry({
    taskId,
    derivedRequest: params.derivedRequest,
    ...(params.parentTaskId && { parentTaskId: params.parentTaskId }),
    ...(params.selection && { selection: params.selection }),
    ...params.entryPatch,
  });
  dynamicPlanningTasks.unshift({ entry, available: true, status: 'running', task });
  return { task, entry };
}

export function listMockPlanningTasks(): PlanningAgentTaskListItem[] {
  return [...dynamicPlanningTasks, ...mockPlanningTaskList];
}

export function startMockPlanningTaskFromInput(input: JsonObject): { task: PlanningAgentTaskRecord; entry: PlanningTaskWorkflowEntry } {
  const selection = selectionFromMockInput(input);
  return pushDynamicTask({ selection, derivedRequest: describeSelection(selection), idPrefix: 'task-started' });
}

export function getMockRecommendationsResponse(): GetRecommendationsResponse {
  return {
    ...mockGetRecommendationsFreshResponse,
    ...(activeRecommendationRefreshTask ? { activeRefreshTask: activeRecommendationRefreshTask } : {}),
  };
}

export function refreshMockRecommendations(): RefreshRecommendationsResponse {
  if (activeRecommendationRefreshTask && (activeRecommendationRefreshTask.status === 'queued' || activeRecommendationRefreshTask.status === 'running')) {
    const entry = listMockPlanningTasks().find((item) => item.entry.taskId === activeRecommendationRefreshTask?.taskId)?.entry
      ?? workflowEntry({ taskId: activeRecommendationRefreshTask.taskId, derivedRequest: 'Refresh eforge-plan recommendations for the current open backlog.', requestedOutputSections: ['recommendations'], purpose: 'recommendation-refresh', sourceFingerprint: mockRecommendationStatusFresh.sourceFingerprint });
    return { task: activeRecommendationRefreshTask, entry, sourceFingerprint: mockRecommendationStatusFresh.sourceFingerprint ?? 'fresh-source-fingerprint', reused: true };
  }
  const response = pushDynamicTask({
    selection: {},
    derivedRequest: 'Refresh eforge-plan recommendations for the current open backlog.',
    idPrefix: 'task-refresh-recommendations',
    entryPatch: { requestedOutputSections: ['recommendations'], purpose: 'recommendation-refresh', sourceFingerprint: mockRecommendationStatusFresh.sourceFingerprint },
  });
  activeRecommendationRefreshTask = response.task;
  return { ...response, sourceFingerprint: mockRecommendationStatusFresh.sourceFingerprint ?? 'fresh-source-fingerprint' };
}

export function relinkMockPlanningTask(parentTaskId: string, mode: 'retry' | 'redraft'): { task: PlanningAgentTaskRecord; entry: PlanningTaskWorkflowEntry } {
  return pushDynamicTask({ parentTaskId, derivedRequest: `${mode === 'retry' ? 'Retry' : 'Redraft'} of ${parentTaskId}`, idPrefix: `task-${mode}` });
}

export function cancelMockPlanningTask(taskId: string, reason?: string): PlanningAgentTaskRecord {
  const cancelled: PlanningAgentTaskRecord = {
    taskId, kind: TASK_KIND, status: 'cancelled',
    createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:10:00.000Z', startedAt: '2026-06-07T00:00:01.000Z', cancelledAt: '2026-06-07T00:10:00.000Z',
    errorMessage: reason ?? 'cancelled',
  };
  const existing = dynamicPlanningTasks.find((item) => item.entry.taskId === taskId);
  if (existing) { existing.task = cancelled; existing.status = 'cancelled'; }
  return cancelled;
}

export function getMockArtifacts(): Artifact[] {
  return [...mockArtifacts, ...appliedCreationDraftArtifacts];
}

export function applyMockCreationDraft(session: string): AppliedSessionPlanCreationDraft {
  if (!appliedCreationDraftArtifacts.some((entry) => entry.session === session)) {
    appliedCreationDraftArtifacts.push({ key: `plan:${session}`, kind: 'plan', session, title: 'AI-promoted session plan', status: 'planning', ready: false });
  }
  return {
    session,
    relativePath: `.eforge/session-plans/${session}.md`,
    readiness: { ready: false, missingDimensions: [], coveredDimensions: ['scope', 'acceptance-criteria'], skippedDimensions: ['assumptions-and-validation'] },
  };
}
