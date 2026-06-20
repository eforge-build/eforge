// Draft plan units: the editable convergence layer between a recommendation lane
// and a session plan. Shape mirrors the backend DraftPlanUnit exactly. Split out
// of types.ts to keep that barrel under the file-size cap; re-exported from
// `@/types` so consumers import from one place.
export type DraftPlanUnitProvenance = 'recommendation' | 'user';
export type DraftPlanUnitItemOrigin = 'recommendation' | 'user';
// Mirrors the backend PlanningProfileSchema enum. Kept as a single source of
// truth so the type and the UI option list cannot drift from each other.
export const PLANNING_PROFILES = ['errand', 'excursion', 'expedition'] as const;
export type PlanningProfile = (typeof PLANNING_PROFILES)[number];
export interface DraftPlanUnitItem { itemId: string; origin: DraftPlanUnitItemOrigin; }
export interface DraftPlanUnit {
  unitId: string;
  title: string;
  intent?: string;
  provenance: DraftPlanUnitProvenance;
  sourceRecommendationRef?: string;
  profile?: PlanningProfile;
  items: DraftPlanUnitItem[];
  status: 'draft' | 'promoted';
  promotedSession?: string;
  promotedAt?: string;
  createdAt: string;
  updatedAt: string;
}
// `profile: ''` clears a previously-set profile (mirrors the backend
// UpdateDraftUnitInputSchema, which accepts PlanningProfile | '').
export interface UpdateDraftUnitInput { unitId: string; title?: string; intent?: string; profile?: PlanningProfile | ''; addItemIds?: string[]; removeItemIds?: string[]; itemOrder?: string[]; }
export interface ListDraftUnitsResponse { units: DraftPlanUnit[]; }
export interface DraftUnitResponse { unit: DraftPlanUnit; }
export interface PromoteDraftUnitResponse { unit: DraftPlanUnit; promotion: { session: string; sessionPlanPath: string } & Record<string, unknown>; }

// Dependency-graph advisory for merge/split. Mirrors the backend DraftUnitAdvisory
// exactly. Non-blocking: 'caution' means the reshape works against the dependency
// structure, 'ok' confirms it is consistent.
export type DraftUnitAdvisorySeverity = 'ok' | 'caution';
export type DraftUnitAdvisoryFindingCode = 'split-crosses-dependency' | 'split-respects-dependencies' | 'merge-justified-by-dependency' | 'merge-independent-units';
export interface DraftUnitAdvisoryFinding { code: DraftUnitAdvisoryFindingCode; message: string; itemIds: string[]; }
export interface DraftUnitAdvisory { severity: DraftUnitAdvisorySeverity; findings: DraftUnitAdvisoryFinding[]; }
export interface MergeDraftUnitsInput { unitIds: string[]; title?: string; intent?: string; profile?: PlanningProfile; }
export interface MergeDraftUnitsResponse { unit: DraftPlanUnit; removedUnitIds: string[]; advisory: DraftUnitAdvisory; }
export interface SplitDraftUnitInput { unitId: string; itemIds: string[]; title: string; intent?: string; profile?: PlanningProfile; }
export interface SplitDraftUnitResponse { original: DraftPlanUnit; created: DraftPlanUnit; advisory: DraftUnitAdvisory; }
export interface AdvisoryResponse { advisory: DraftUnitAdvisory; }
