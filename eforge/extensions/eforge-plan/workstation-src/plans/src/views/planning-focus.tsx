import type { PlanningAgentTaskRecord, RecommendationFreshnessView, RecommendationModel, RecommendationStatus } from '@/types';
import { PlanWithAiPanel } from './backlog/plan-with-ai-panel';
import { RecommendationsPanel } from './backlog/recommendations-panel';
import type { PlanningTaskWorkflowsApi } from './backlog/use-planning-task-workflows';
import type { BacklogSelection } from '@/hooks/use-backlog-selection';

interface PlanningFocusProps {
  workflows: PlanningTaskWorkflowsApi;
  selection: BacklogSelection;
  recommendations: RecommendationModel | null;
  recommendationStatus: RecommendationStatus | null;
  recommendationFreshness: RecommendationFreshnessView | null;
  activeRecommendationRefreshTask: PlanningAgentTaskRecord | null;
  lensTag: string;
  lensItemIds: Set<string>;
}

/**
 * The roomy planning workspace: the durable Plan-with-AI task monitor plus the
 * full recommendation model (lanes, sequence, blocked chains, rationale). This
 * is where the rich, scroll-heavy guidance lives so it never crowds the board.
 */
export function PlanningFocus({ workflows, selection, recommendations, recommendationStatus, recommendationFreshness, activeRecommendationRefreshTask, lensTag, lensItemIds }: PlanningFocusProps) {
  return (
    <div className="grid gap-4">
      <PlanWithAiPanel workflows={workflows} />
      <RecommendationsPanel
        recommendations={recommendations}
        status={recommendationStatus}
        freshness={recommendationFreshness}
        activeRefreshTask={activeRecommendationRefreshTask}
        titles={selection.titles}
        selected={selection.selected}
        readyIds={selection.readyIds}
        lensTag={lensTag}
        lensItemIds={lensItemIds}
        onPickItem={selection.pickItem}
        onPickItems={selection.pickItems}
        onPlanItems={selection.planLane}
        busy={workflows.busy}
      />
    </div>
  );
}
