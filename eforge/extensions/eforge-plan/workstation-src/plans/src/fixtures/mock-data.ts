import type { Artifact, Board, BoardItem, Detail, RecommendationModel } from '@/types';

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

export const mockArtifacts: Artifact[] = [
  { key: 'plan:2026-06-07-import-preview', kind: 'plan', session: '2026-06-07-import-preview', title: 'Add import preview', status: 'planning', ready: false },
  { key: 'plan:2026-06-07-recommendations', kind: 'plan', session: '2026-06-07-recommendations', title: 'Recommendation engine', status: 'ready', ready: true },
  { key: 'plan-set:planning-foundations', kind: 'plan-set', planSetId: 'planning-foundations', title: 'Planning foundations', status: 'draft', childCount: 3 },
];

export function mockDetail(key: string): Detail {
  if (key.startsWith('plan-set:')) {
    return { planSet: { id: 'planning-foundations', title: 'Planning foundations', status: 'draft', strategy: 'sequential', children: [{ id: 'plan-01', status: 'ready', buildable: true, file: '01.md' }] }, manifestPath: '.eforge/session-plan-sets/planning-foundations/manifest.yaml', validation: { ok: true } };
  }
  const artifact = mockArtifacts.find((entry) => entry.key === key) ?? mockArtifacts[0];
  return {
    path: `.eforge/session-plans/${artifact.session}.md`,
    readiness: { ready: artifact.ready, missingDimensions: artifact.ready ? [] : ['acceptance-criteria'], acDiagnostics: [] },
    plan: {
      session: artifact.session ?? 'mock-session', topic: artifact.title ?? 'Mock plan', status: artifact.status ?? 'planning',
      profile: 'excursion', planning_type: 'feature', planning_depth: 'focused', open_questions: ['What edge cases matter?'],
      sections: { Scope: 'A friendly fixture for rapid UI iteration.', 'Acceptance Criteria': '- It renders.\n- It promotes.' },
      body: '# Mock plan\n\n## Scope\n\nA friendly fixture for rapid UI iteration.',
    },
  };
}
