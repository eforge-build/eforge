import type { Artifact, Board, Detail, RecommendationModel } from '@/types';

export const mockBoard: Board = {
  lanes: [
    { lane: 'ready', title: 'Ready', items: [{ id: 'add-import-preview', title: 'Add import preview', status: 'planned' }, { id: 'recommend-next-work', title: 'Maintain next-work recommendations', status: 'planned' }] },
    { lane: 'in-progress', title: 'In progress', items: [{ id: 'plan-workstation', title: 'Move planning into workstation', status: 'active' }] },
    { lane: 'blocked', title: 'Blocked', items: [{ id: 'auto-mode', title: 'Explore auto-mode draining', status: 'planned', reasons: ['Blocked by traceability'] }] },
  ],
  items: [],
  epics: [{ id: 'planning', title: 'Planning workstation', status: 'active' }, { id: 'extensions', title: 'Extension platform', status: 'planned' }],
};
mockBoard.items = mockBoard.lanes.flatMap((lane) => lane.items.map((item) => ({ ...item, lane: lane.lane })));

export const mockRecommendations: RecommendationModel = {
  recommendedNextSequence: [
    { ref: 'next-recommendations', itemId: 'recommend-next-work', rationale: 'Foundation for choosing useful follow-up work.' },
    { ref: 'next-import-preview', itemId: 'add-import-preview', rationale: 'Ready, scoped, and user-visible.' },
  ],
  safeParallelizableGroups: [
    { ref: 'planning-foundations', title: 'Planning foundations', itemIds: ['add-import-preview', 'recommend-next-work'], rationale: 'Shared workflow layer; plan together and implement in sequence.', recommendedProfile: 'excursion' },
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
  return { path: `.eforge/session-plans/${artifact.session}.md`, readiness: { ready: artifact.ready, missingDimensions: artifact.ready ? [] : ['acceptance-criteria'], acDiagnostics: [] }, plan: { session: artifact.session ?? 'mock-session', topic: artifact.title ?? 'Mock plan', status: artifact.status ?? 'planning', profile: 'excursion', planning_type: 'feature', planning_depth: 'focused', open_questions: ['What edge cases matter?'], body: '# Mock plan\n\n## Scope\n\nA friendly fixture for rapid UI iteration.' } };
}
