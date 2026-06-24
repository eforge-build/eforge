import * as React from 'react';
import { ClipboardList, GitBranch, Map } from 'lucide-react';
import { useRouter } from '@/router';
import type { WorkstationDataState } from '@/hooks/use-workstation-data';
import { useBacklogSelection } from '@/hooks/use-backlog-selection';
import type { AppliedSessionPlanCreationDraft, ApplyPlanningTaskResponse, JsonObject } from '@/types';
import { buildItemPlanIndex, draftKey, planKey } from '@/lib/plan-links';
import { RoadmapContextRail, RoadmapFocus } from './roadmap/roadmap-panel';
import { sourceSummary } from './roadmap/roadmap-view-model';
import { BoardFocus } from './board-focus';
import { PlansView } from './plans-view';
import { ActivityRail } from './activity-rail';
import { RecommendationsRail } from './recommendations-rail';
import { SelectionRail } from './selection-rail';
import { usePlanningTaskWorkflows } from './backlog/use-planning-task-workflows';

type Focus = 'roadmap' | 'board' | 'plans';

const FOCUSES: { id: Focus; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'roadmap', label: 'Roadmap', icon: Map },
  { id: 'board', label: 'Backlog', icon: GitBranch },
  { id: 'plans', label: 'Plans', icon: ClipboardList },
];

/**
 * Single planning workstation: a focal work pane (Roadmap / Backlog / Plans,
 * switched in the header) beside a context rail that adapts to the focus. One
 * mental model with hierarchy - the work leads, guidance and context support it.
 * The Backlog rail is the AI planning co-pilot (analyze, recommendations,
 * selection, activity); there is no separate planning tab.
 */
export function WorkstationView({ data }: { data: WorkstationDataState }) {
  const router = useRouter();
  const openCreatedSessionPlan = React.useCallback((draft: AppliedSessionPlanCreationDraft) => {
    router.setQuery((params) => { params.set('focus', 'plans'); params.set('plan', planKey(draft.session)); });
  }, [router]);
  const workflows = usePlanningTaskWorkflows(data.refresh, openCreatedSessionPlan);
  const selection = useBacklogSelection(data.board, workflows);

  // The "Analyze all backlog" trigger drives a backlog-curation task; while one
  // is queued/running it should read as working rather than invite a duplicate.
  // `workflows.busy` only covers the in-flight click, so derive the durable
  // running state from the task list the activity rail already polls.
  const curationRunning = React.useMemo(
    () => workflows.items.some((item) => {
      const status = item.task?.status ?? item.status;
      return (status === 'queued' || status === 'running') && item.entry.purpose === 'backlog-curation';
    }),
    [workflows.items],
  );

  const focus: Focus = readFocus(router.query.get('focus'));
  const setFocus = React.useCallback((next: Focus) => {
    router.setQuery((params) => { if (next === 'board') params.delete('focus'); else params.set('focus', next); });
  }, [router]);

  // Applying a generated result that creates a session plan jumps to it on the
  // Plans focus so iteration continues there.
  const applyAndOpenPlan = React.useCallback(async (taskId: string, input: JsonObject): Promise<ApplyPlanningTaskResponse | null> => {
    const response = await workflows.apply(taskId, input);
    if (response?.sessionPlanCreationDraft) openCreatedSessionPlan(response.sessionPlanCreationDraft);
    return response;
  }, [workflows, openCreatedSessionPlan]);
  const panelWorkflows = React.useMemo(() => ({ ...workflows, apply: applyAndOpenPlan }), [workflows, applyAndOpenPlan]);

  const items = data.board.items ?? [];

  // Fork a recommendation lane into an editable draft plan unit, then jump to it
  // on the Plans focus so curation continues there.
  const onForkLane = React.useCallback(async (recommendationRef: string) => {
    const unit = await data.forkRecommendationToDraftUnit(recommendationRef);
    router.setQuery((params) => { params.set('focus', 'plans'); params.set('plan', draftKey(unit.unitId)); });
  }, [data, router]);

  // Reverse index of the plan->item linkage so a board card (and its drawer) can
  // show which plan(s) converged on it, mirroring the source refs a plan shows.
  const itemPlanIndex = React.useMemo(() => buildItemPlanIndex(data.artifacts), [data.artifacts]);

  const roadmapSummary = sourceSummary(data.roadmapState);
  const counts: Record<Focus, number> = {
    roadmap: roadmapSummary.local + roadmapSummary.configuredShared + roadmapSummary.discovered,
    board: data.board.counts?.open ?? items.length,
    plans: data.artifacts.length,
  };

  return (
    <div className="grid gap-4">
      <div className={focus === 'plans' ? 'grid gap-4' : 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start'}>
        <div className="min-w-0">
          <nav className="mb-4 flex flex-wrap gap-1 border-b pb-2">
            {FOCUSES.map((entry) => {
              const Icon = entry.icon;
              const active = entry.id === focus;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setFocus(entry.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-accent text-text-bright' : 'text-muted-foreground hover:bg-accent/60'}`}
                >
                  <Icon className="h-4 w-4" /> <span>{entry.label}</span>
                  <span className={`rounded-full border px-1.5 text-2xs ${active ? 'border-border text-muted-foreground' : 'border-transparent text-muted-foreground/70'}`}>{counts[entry.id]}</span>
                </button>
              );
            })}
          </nav>

          {focus === 'roadmap' ? (
            <RoadmapFocus
              state={data.roadmapState}
              recommendationStatus={data.recommendationStatus}
              recommendationFreshness={data.recommendationFreshness}
              activeRecommendationRefreshTask={data.activeRecommendationRefreshTask}
              onSaveLocalFocus={data.saveRoadmapState}
              onRefreshRecommendations={data.refreshRecommendations}
            />
          ) : focus === 'plans' ? (
            <PlansView
              artifacts={data.artifacts}
              draftUnits={data.draftUnits}
              titles={selection.titles}
              onRefresh={data.refresh}
              onUpdateDraftUnit={data.updateDraftUnit}
              onDeleteDraftUnit={data.deleteDraftUnit}
              onPromoteDraftUnit={(unitId) => data.promoteDraftUnit(unitId)}
              onMergeDraftUnits={data.mergeDraftUnits}
              onSplitDraftUnit={data.splitDraftUnit}
              onAdviseMergeDraftUnits={data.adviseMergeDraftUnits}
              onAdviseSplitDraftUnit={data.adviseSplitDraftUnit}
            />
          ) : (
            <BoardFocus
              board={data.board}
              selection={selection}
              itemPlanIndex={itemPlanIndex}
              onRefresh={data.refresh}
              onLoadMoreBoard={data.loadMoreBoard}
              onLoadClosedLane={data.loadClosedLane}
            />
          )}
        </div>

        {focus !== 'plans' && (
          <aside className="grid min-w-0 gap-3 lg:sticky lg:top-[5.5rem]">
            {focus === 'roadmap' ? (
              <RoadmapContextRail
                state={data.roadmapState}
                loading={data.loading}
                recommendationStatus={data.recommendationStatus}
                recommendationFreshness={data.recommendationFreshness}
                activeRecommendationRefreshTask={data.activeRecommendationRefreshTask}
                onReloadRoadmap={data.refresh}
              />
            ) : (
              <>
                <SelectionRail selection={selection} busy={workflows.busy} />
                <RecommendationsRail
                  recommendations={data.recommendations}
                  actionability={data.recommendationActionability}
                  status={data.recommendationStatus}
                  freshness={data.recommendationFreshness}
                  selection={selection}
                  busy={workflows.busy}
                  analyzing={curationRunning}
                  onAnalyze={workflows.analyzeAllBacklog}
                  onForkLane={onForkLane}
                />
                <ActivityRail workflows={panelWorkflows} titles={selection.titles} />
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function readFocus(value: string | null): Focus {
  return value === 'roadmap' || value === 'plans' ? value : 'board';
}
