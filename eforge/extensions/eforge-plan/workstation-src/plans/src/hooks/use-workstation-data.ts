import * as React from 'react';
import { getBridge } from '@/bridge';
import { boardFromCompact, mergeCompactLanePage } from '@/lib/compact-board-adapter';
import type { AdvisoryResponse, Artifact, Board, CompactBoardResponse, DraftPlanUnit, DraftPlanUnitListItem, DraftUnitAdvisory, DraftUnitResponse, GetRecommendationsResponse, JsonObject, ListDraftUnitsResponse, MergeDraftUnitsInput, MergeDraftUnitsResponse, PlanningAgentTaskRecord, PromoteDraftUnitResponse, RecommendationFreshnessView, RecommendationModel, RecommendationStatus, RefreshRecommendationsResponse, RoadmapStateResponse, SplitDraftUnitInput, SplitDraftUnitResponse, UpdateDraftUnitInput, UpdateRoadmapStateRequest } from '@/types';

const bridge = getBridge();
const emptyBoard: Board = { lanes: [], items: [], epics: [], counts: { total: 0, open: 0, closed: 0 } };
const INITIAL_BOARD_LIMIT = 50;
const CLOSED_LANE_LIMIT = 50;

export interface WorkstationDataState {
  board: Board;
  artifacts: Artifact[];
  recommendations: RecommendationModel | null;
  recommendationStatus: RecommendationStatus | null;
  recommendationFreshness: RecommendationFreshnessView | null;
  activeRecommendationRefreshTask: PlanningAgentTaskRecord | null;
  roadmapState: RoadmapStateResponse | null;
  draftUnits: DraftPlanUnitListItem[];
  saveRoadmapState: (input: UpdateRoadmapStateRequest) => Promise<RoadmapStateResponse>;
  refreshRecommendations: () => Promise<RefreshRecommendationsResponse>;
  forkRecommendationToDraftUnit: (recommendationRef: string, title?: string) => Promise<DraftPlanUnit>;
  updateDraftUnit: (input: UpdateDraftUnitInput) => Promise<DraftPlanUnit>;
  deleteDraftUnit: (unitId: string) => Promise<void>;
  promoteDraftUnit: (unitId: string, options?: { session?: string; status?: 'active' | 'planned' }) => Promise<PromoteDraftUnitResponse>;
  mergeDraftUnits: (input: MergeDraftUnitsInput) => Promise<MergeDraftUnitsResponse>;
  splitDraftUnit: (input: SplitDraftUnitInput) => Promise<SplitDraftUnitResponse>;
  adviseMergeDraftUnits: (unitIds: string[]) => Promise<DraftUnitAdvisory>;
  adviseSplitDraftUnit: (unitId: string, itemIds: string[]) => Promise<DraftUnitAdvisory>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadMoreBoard: () => Promise<void>;
  loadClosedLane: (lane: string) => Promise<void>;
  bridgeVersion?: number;
}

export function useWorkstationData(): WorkstationDataState {
  const [board, setBoard] = React.useState<Board>(emptyBoard);
  const [artifacts, setArtifacts] = React.useState<Artifact[]>([]);
  const [recommendations, setRecommendations] = React.useState<RecommendationModel | null>(null);
  const [recommendationStatus, setRecommendationStatus] = React.useState<RecommendationStatus | null>(null);
  const [recommendationFreshness, setRecommendationFreshness] = React.useState<RecommendationFreshnessView | null>(null);
  const [activeRecommendationRefreshTask, setActiveRecommendationRefreshTask] = React.useState<PlanningAgentTaskRecord | null>(null);
  const [roadmapState, setRoadmapState] = React.useState<RoadmapStateResponse | null>(null);
  const [draftUnits, setDraftUnits] = React.useState<DraftPlanUnitListItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    // Each source is loaded independently: a failure in one (e.g. optional
    // recommendations) must not blank the board or the artifact list.
    const [boardResult, artifactsResult, recommendationsResult, roadmapResult, draftUnitsResult] = await Promise.allSettled([
      bridge.invokeAction<CompactBoardResponse>('list-board-compact', { limit: INITIAL_BOARD_LIMIT, includeArchive: true }),
      bridge.invokeAction<{ artifacts?: Artifact[] }>('list-planning-artifacts', { includeBoard: false }),
      bridge.invokeAction<GetRecommendationsResponse>('get-recommendations', {}),
      bridge.invokeAction<RoadmapStateResponse>('get-roadmap-state', { includeLocalFocusContent: true }),
      bridge.invokeAction<ListDraftUnitsResponse>('list-draft-units', {}),
    ]);
    const failures: string[] = [];
    const recommendationModel = recommendationsResult.status === 'fulfilled' ? recommendationsResult.value.recommendations ?? null : null;
    if (boardResult.status === 'fulfilled') setBoard(boardFromCompact(boardResult.value, recommendationModel));
    else failures.push(reason('board', boardResult.reason));
    if (artifactsResult.status === 'fulfilled') setArtifacts(artifactsResult.value.artifacts ?? []);
    else failures.push(reason('plans', artifactsResult.reason));
    if (recommendationsResult.status === 'fulfilled') {
      setRecommendations(recommendationModel);
      setRecommendationStatus(recommendationsResult.value.status ?? null);
      setRecommendationFreshness(recommendationsResult.value.recommendationFreshness ?? null);
      setActiveRecommendationRefreshTask(recommendationsResult.value.activeRefreshTask ?? null);
    } else failures.push(reason('recommendations', recommendationsResult.reason));
    if (roadmapResult.status === 'fulfilled') setRoadmapState(roadmapResult.value);
    else failures.push(reason('roadmap', roadmapResult.reason));
    if (draftUnitsResult.status === 'fulfilled') setDraftUnits(draftUnitsResult.value.units ?? []);
    else failures.push(reason('drafts', draftUnitsResult.reason));
    setError(failures.length > 0 ? failures.join(' · ') : null);
    setLoading(false);
  }, []);

  const loadMoreBoard = React.useCallback(async () => {
    const pagination = board.pagination;
    if (!pagination?.hasMore || pagination.nextOffset === undefined) return;
    try {
      const response = await bridge.invokeAction<CompactBoardResponse>('list-board-compact', {
        limit: INITIAL_BOARD_LIMIT,
        includeArchive: true,
        offset: pagination.nextOffset,
      });
      setBoard((current) => mergeCompactLanePage(current, response, recommendations, { scope: 'board' }));
      setError(null);
    } catch (caught) {
      setError(reason('board page', caught));
    }
  }, [board.pagination, recommendations]);

  const loadClosedLane = React.useCallback(async (lane: string) => {
    const pagination = board.lanes.find((entry) => entry.lane === lane)?.pagination;
    if (pagination && !pagination.hasMore) return;
    try {
      const response = await bridge.invokeAction<CompactBoardResponse>('list-board-compact', {
        lane,
        includeClosed: true,
        includeArchive: true,
        limit: CLOSED_LANE_LIMIT,
        offset: pagination?.nextOffset ?? 0,
      });
      setBoard((current) => mergeCompactLanePage(current, response, recommendations, { scope: 'lane', lane }));
      setError(null);
    } catch (caught) {
      setError(reason(`closed ${lane}`, caught));
    }
  }, [board.lanes, recommendations]);

  const saveRoadmapState = React.useCallback(async (input: UpdateRoadmapStateRequest) => {
    const response = await bridge.invokeAction<RoadmapStateResponse>('update-roadmap-state', input as unknown as JsonObject);
    setRoadmapState(response);
    await refresh();
    return response;
  }, [refresh]);

  const refreshRecommendations = React.useCallback(async () => {
    const response = await bridge.invokeAction<RefreshRecommendationsResponse>('refresh-recommendations', {});
    setActiveRecommendationRefreshTask(response.task);
    await refresh();
    return response;
  }, [refresh]);

  const forkRecommendationToDraftUnit = React.useCallback(async (recommendationRef: string, title?: string) => {
    const { unit } = await bridge.invokeAction<DraftUnitResponse>('fork-recommendation-to-draft-unit', { recommendationRef, ...(title ? { title } : {}) });
    await refresh();
    return unit;
  }, [refresh]);

  const updateDraftUnit = React.useCallback(async (input: UpdateDraftUnitInput) => {
    const { unit } = await bridge.invokeAction<DraftUnitResponse>('update-draft-unit', input as unknown as JsonObject);
    await refresh();
    return unit;
  }, [refresh]);

  const deleteDraftUnit = React.useCallback(async (unitId: string) => {
    await bridge.invokeAction('delete-draft-unit', { unitId });
    await refresh();
  }, [refresh]);

  const promoteDraftUnit = React.useCallback(async (unitId: string, options?: { session?: string; status?: 'active' | 'planned' }) => {
    const response = await bridge.invokeAction<PromoteDraftUnitResponse>('promote-draft-unit', { unitId, ...(options?.session ? { session: options.session } : {}), ...(options?.status ? { status: options.status } : {}) });
    await refresh();
    return response;
  }, [refresh]);

  const mergeDraftUnits = React.useCallback(async (input: MergeDraftUnitsInput) => {
    const response = await bridge.invokeAction<MergeDraftUnitsResponse>('merge-draft-units', input as unknown as JsonObject);
    await refresh();
    return response;
  }, [refresh]);

  const splitDraftUnit = React.useCallback(async (input: SplitDraftUnitInput) => {
    const response = await bridge.invokeAction<SplitDraftUnitResponse>('split-draft-unit', input as unknown as JsonObject);
    await refresh();
    return response;
  }, [refresh]);

  // Read-only previews: no refresh, used to warn before committing a reshape.
  const adviseMergeDraftUnits = React.useCallback(async (unitIds: string[]) => {
    return (await bridge.invokeAction<AdvisoryResponse>('advise-merge-draft-units', { unitIds })).advisory;
  }, []);

  const adviseSplitDraftUnit = React.useCallback(async (unitId: string, itemIds: string[]) => {
    return (await bridge.invokeAction<AdvisoryResponse>('advise-split-draft-unit', { unitId, itemIds })).advisory;
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  return { board, artifacts, recommendations, recommendationStatus, recommendationFreshness, activeRecommendationRefreshTask, roadmapState, draftUnits, saveRoadmapState, refreshRecommendations, forkRecommendationToDraftUnit, updateDraftUnit, deleteDraftUnit, promoteDraftUnit, mergeDraftUnits, splitDraftUnit, adviseMergeDraftUnits, adviseSplitDraftUnit, loading, error, refresh, loadMoreBoard, loadClosedLane, bridgeVersion: bridge.version };
}

function reason(label: string, caught: unknown): string {
  return `${label}: ${caught instanceof Error ? caught.message : String(caught)}`;
}
