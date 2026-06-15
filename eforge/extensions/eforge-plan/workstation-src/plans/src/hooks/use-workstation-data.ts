import * as React from 'react';
import { getBridge } from '@/bridge';
import { boardFromCompact, mergeCompactLanePage } from '@/lib/compact-board-adapter';
import type { Artifact, Board, CompactBoardResponse, GetRecommendationsResponse, PlanningAgentTaskRecord, RecommendationModel, RecommendationStatus } from '@/types';

const bridge = getBridge();
const emptyBoard: Board = { lanes: [], items: [], epics: [], counts: { total: 0, open: 0, closed: 0 } };
const INITIAL_BOARD_LIMIT = 50;
const CLOSED_LANE_LIMIT = 50;

export interface WorkstationDataState {
  board: Board;
  artifacts: Artifact[];
  recommendations: RecommendationModel | null;
  recommendationStatus: RecommendationStatus | null;
  activeRecommendationRefreshTask: PlanningAgentTaskRecord | null;
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
  const [activeRecommendationRefreshTask, setActiveRecommendationRefreshTask] = React.useState<PlanningAgentTaskRecord | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    // Each source is loaded independently: a failure in one (e.g. optional
    // recommendations) must not blank the board or the artifact list.
    const [boardResult, artifactsResult, recommendationsResult] = await Promise.allSettled([
      bridge.invokeAction<CompactBoardResponse>('list-board-compact', { limit: INITIAL_BOARD_LIMIT, includeArchive: true }),
      bridge.invokeAction<{ artifacts?: Artifact[] }>('list-planning-artifacts', {}),
      bridge.invokeAction<GetRecommendationsResponse>('get-recommendations', {}),
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
      setActiveRecommendationRefreshTask(recommendationsResult.value.activeRefreshTask ?? null);
    } else failures.push(reason('recommendations', recommendationsResult.reason));
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
      setBoard((current) => mergeCompactLanePage(current, response, recommendations));
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
      setBoard((current) => mergeCompactLanePage(current, response, recommendations));
      setError(null);
    } catch (caught) {
      setError(reason(`closed ${lane}`, caught));
    }
  }, [board.lanes, recommendations]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  return { board, artifacts, recommendations, recommendationStatus, activeRecommendationRefreshTask, loading, error, refresh, loadMoreBoard, loadClosedLane, bridgeVersion: bridge.version };
}

function reason(label: string, caught: unknown): string {
  return `${label}: ${caught instanceof Error ? caught.message : String(caught)}`;
}
