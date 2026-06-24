export type * from './types.js';
export { projectionStoreExists, withProjectionStore } from './store.js';
export { paginateProjection, pageMetadata } from './pagination.js';
export { computeEffectiveLifecycle, mapReasonCode, publicLifecycleState, reasonForEvidence } from './lifecycle.js';
export { getAssociatedPlanBuildLinksForItemsFromStore } from './links.js';
export { getItemDetailProjection, getEpicDetailProjection, compactItemFromStore, compactEpicFromRows } from './items.js';
export { listBoardCompactProjection, buildBoardDebugProjection, renderBoardProjection } from './board.js';
export { getRecommendationProjection, buildRecommendationActionability } from './recommendations.js';
export { listPlanningArtifactsProjection, getSessionPlanLifecycleProjection, showSessionPlanProjection } from './session-plans.js';
export { findNonterminalCoverage } from './coverage.js';

import { withProjectionStore } from './store.js';
import { getAssociatedPlanBuildLinksForItemsFromStore } from './links.js';
export async function getAssociatedPlanBuildLinksForItems(cwd: string, input: { itemIds: string[] }) { return withProjectionStore(cwd, (store) => getAssociatedPlanBuildLinksForItemsFromStore(store, input.itemIds), () => []); }
