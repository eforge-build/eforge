export type * from './types.js';
export { projectionStoreExists, withProjectionStore } from './store.js';
export { paginateProjection, pageMetadata } from './pagination.js';
export { computeEffectiveLifecycle, mapReasonCode, publicLifecycleState, reasonForEvidence } from './lifecycle.js';
export { getAssociatedPlanBuildLinksForItemsFromStore } from './links.js';
export { getItemDetailProjection, getEpicDetailProjection, compactItemFromStore, compactEpicFromRows, hydrateCompactItemSearchResults, listAllCompactEpicsFromStore } from './items.js';
export { listBoardCompactProjection, buildBoardDebugProjection, renderBoardProjection } from './board.js';
export { getRecommendationProjection, buildRecommendationActionability } from './recommendations.js';
export { SESSION_PLAN_STATUS_SOURCE_DISCLOSURE, listPlanningArtifactsProjection, getSessionPlanLifecycleProjection, showSessionPlanProjection } from './session-plans.js';
export { findNonterminalCoverage } from './coverage.js';

import { withProjectionStore } from './store.js';
import { getAssociatedPlanBuildLinksForItemsFromStore } from './links.js';
export async function getAssociatedPlanBuildLinksForItems(cwd: string, input: { itemIds: string[] }) { return withProjectionStore(cwd, (store) => getAssociatedPlanBuildLinksForItemsFromStore(store, input.itemIds), () => []); }
