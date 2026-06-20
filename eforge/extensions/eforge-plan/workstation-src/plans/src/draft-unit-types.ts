// Draft plan units: the editable convergence layer between a recommendation lane
// and a session plan. Shape mirrors the backend DraftPlanUnit exactly. Split out
// of types.ts to keep that barrel under the file-size cap; re-exported from
// `@/types` so consumers import from one place.
export type DraftPlanUnitProvenance = 'recommendation' | 'user';
export type DraftPlanUnitItemOrigin = 'recommendation' | 'user';
export interface DraftPlanUnitItem { itemId: string; origin: DraftPlanUnitItemOrigin; }
export interface DraftPlanUnit {
  unitId: string;
  title: string;
  intent?: string;
  provenance: DraftPlanUnitProvenance;
  sourceRecommendationRef?: string;
  profile?: string;
  items: DraftPlanUnitItem[];
  status: 'draft' | 'promoted';
  promotedSession?: string;
  promotedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface UpdateDraftUnitInput { unitId: string; title?: string; intent?: string; profile?: string; addItemIds?: string[]; removeItemIds?: string[]; itemOrder?: string[]; }
export interface ListDraftUnitsResponse { units: DraftPlanUnit[]; }
export interface DraftUnitResponse { unit: DraftPlanUnit; }
export interface PromoteDraftUnitResponse { unit: DraftPlanUnit; promotion: { session: string; sessionPlanPath: string } & Record<string, unknown>; }
