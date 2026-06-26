import { mockGetRecommendationsFreshResponse, mockRecommendationActionability, mockRecommendationFreshnessStale, mockRecommendationStatusStale, mockRecommendations } from '@/fixtures/mock-data';
import type { GetRecommendationsResponse, JsonObject, PlanningAgentTaskRecord, RefreshRecommendationsResponse, RoadmapStateResponse, UpdateRoadmapStateRequest } from '@/types';

const MAX_CONTENT_BYTES = 40_000;
let localFocusContent = '# Local focus\n\nPrioritize workstation roadmap editing and recommendation refresh UX.\n\n- Keep the workstation read-first.\n- Link to [docs](https://example.test/docs) and mention `roadmap`.\n';
let localFocusSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let activeRefreshTask: PlanningAgentTaskRecord | null = null;

export function getMockRoadmapState(): RoadmapStateResponse {
  const now = '2026-06-07T00:30:00.000Z';
  return {
    schemaVersion: 1,
    storagePaths: { localFocus: '.eforge/storage/extensions/eforge-plan/roadmaps/local-focus.md', config: '.eforge/storage/extensions/eforge-plan/roadmaps/config.json' },
    config: { schemaVersion: 1, sharedSources: [{ id: 'shared-platform', path: 'docs/shared-roadmap.md', label: 'Shared platform roadmap' }] },
    context: {
      schemaVersion: 1,
      localSteering: localSource(now),
      sharedContextSources: [{
        kind: 'configured-shared', role: 'shared-context', id: 'shared-platform', label: 'Shared platform roadmap', path: 'docs/shared-roadmap.md', configured: true, editable: false, exists: true,
        sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', headings: ['Shared priorities'], excerpts: ['Keep shared roadmap files read-only from the workstation.'], content: '# Shared priorities\n\n- Keep shared roadmap files read-only from the workstation.\n- Preserve `source` metadata.\n', updatedAt: now,
      }],
      discoveredContextSources: [{
        kind: 'discovered-conventional', role: 'shared-context', path: 'docs/roadmap.md', configured: false, editable: false, exists: true,
        sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', headings: ['Roadmap'], excerpts: ['Discovered conventional context remains read-only.'], content: '# Roadmap\n\nDiscovered conventional context remains **read-only**.\n', updatedAt: now,
      }],
      assumptions: ['Local focus is private extension storage.'],
      conflicts: [{ code: 'configured-source-missing', message: 'Optional configured roadmap is missing.', path: 'docs/missing-roadmap.md', sourceId: 'missing' }],
      truncation: { sourceExcerpts: 1, sourceContent: 0 },
    },
  };
}

export function updateMockRoadmapState(input: JsonObject): RoadmapStateResponse {
  const request = input as unknown as UpdateRoadmapStateRequest;
  if (request.localFocusContent === undefined) throw new Error('mock update-roadmap-state requires localFocusContent.');
  if (request.expectedLocalFocusSha256 && request.expectedLocalFocusSha256 !== localFocusSha) throw new Error('Local focus roadmap changed; reload before saving.');
  localFocusContent = request.localFocusContent;
  localFocusSha = localFocusSha === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    ? 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    : 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  return getMockRoadmapState();
}

export function refreshMockRecommendations(): RefreshRecommendationsResponse {
  activeRefreshTask = {
    taskId: 'task-roadmap-refresh-recommendations', kind: 'eforge-plan.planning-draft', status: 'running', createdAt: '2026-06-07T00:31:00.000Z', updatedAt: '2026-06-07T00:31:03.000Z', startedAt: '2026-06-07T00:31:01.000Z',
    metadata: { progressMessage: 'Refreshing recommendations from roadmap changes…', sectionProgress: { currentSection: 'recommendations', coveredSections: [], remainingSections: [] } },
  };
  return { task: activeRefreshTask, entry: { taskId: activeRefreshTask.taskId, originalRequest: 'Refresh recommendations from roadmap.', derivedRequest: 'Refresh recommendations from saved roadmap state.', selection: {}, requestedOutputSections: ['recommendations'], purpose: 'recommendation-refresh', sourceFingerprint: 'roadmap-source-fingerprint', createdAt: activeRefreshTask.createdAt }, sourceFingerprint: 'roadmap-source-fingerprint', reused: false };
}

export function getMockRecommendationsWithRoadmapRefresh(): GetRecommendationsResponse {
  if (!activeRefreshTask) return mockGetRecommendationsFreshResponse;
  return { recommendations: mockRecommendations, recommendationActionability: mockRecommendationActionability, path: 'mock://recommendations/current.json', status: mockRecommendationStatusStale, recommendationFreshness: mockRecommendationFreshnessStale, activeRefreshTask };
}

function localSource(updatedAt: string) {
  return {
    kind: 'local-focus' as const,
    role: 'local-steering' as const,
    path: '.eforge/storage/extensions/eforge-plan/roadmaps/local-focus.md',
    label: 'Local focus roadmap',
    configured: true,
    editable: true,
    exists: localFocusContent.length > 0,
    sha256: localFocusSha,
    headings: ['Local focus'],
    excerpts: ['Prioritize workstation roadmap editing and recommendation refresh UX.'],
    content: localFocusContent,
    updatedAt,
    maxContentBytes: MAX_CONTENT_BYTES,
  };
}
