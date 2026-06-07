import * as React from 'react';
import { getBridge } from '@/bridge';
import type { Artifact, Board, RecommendationModel } from '@/types';

const bridge = getBridge();
const emptyBoard: Board = { lanes: [], items: [], epics: [] };

export interface WorkstationDataState {
  board: Board;
  artifacts: Artifact[];
  recommendations: RecommendationModel | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  bridgeVersion?: number;
}

export function useWorkstationData(): WorkstationDataState {
  const [board, setBoard] = React.useState<Board>(emptyBoard);
  const [artifacts, setArtifacts] = React.useState<Artifact[]>([]);
  const [recommendations, setRecommendations] = React.useState<RecommendationModel | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    // Each source is loaded independently: a failure in one (e.g. optional
    // recommendations) must not blank the board or the artifact list.
    const [boardResult, artifactsResult, recommendationsResult] = await Promise.allSettled([
      bridge.invokeAction<Board>('list-board', {}),
      bridge.invokeAction<{ artifacts?: Artifact[] }>('list-planning-artifacts', {}),
      bridge.invokeAction<{ recommendations?: RecommendationModel | null }>('get-recommendations', {}),
    ]);
    const failures: string[] = [];
    if (boardResult.status === 'fulfilled') {
      // The engine returns raw backlog items in `items`; the enriched kanban
      // cards live inside `lanes[].items`. Flatten the lanes for card rendering.
      const lanes = boardResult.value.lanes ?? [];
      setBoard({ lanes, items: lanes.flatMap((lane) => lane.items ?? []), epics: boardResult.value.epics ?? [] });
    } else failures.push(reason('board', boardResult.reason));
    if (artifactsResult.status === 'fulfilled') setArtifacts(artifactsResult.value.artifacts ?? []);
    else failures.push(reason('plans', artifactsResult.reason));
    if (recommendationsResult.status === 'fulfilled') setRecommendations(recommendationsResult.value.recommendations ?? null);
    else failures.push(reason('recommendations', recommendationsResult.reason));
    setError(failures.length > 0 ? failures.join(' · ') : null);
    setLoading(false);
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  return { board, artifacts, recommendations, loading, error, refresh, bridgeVersion: bridge.version };
}

function reason(label: string, caught: unknown): string {
  return `${label}: ${caught instanceof Error ? caught.message : String(caught)}`;
}
