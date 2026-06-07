import type { ExtensionJsonObject } from '@eforge-build/client/browser';

export type JsonObject = ExtensionJsonObject;

export interface EforgeBridge {
  version?: number;
  invokeAction<TOutput = unknown>(actionId: string, input?: JsonObject): Promise<TOutput>;
}

export interface Artifact {
  key: string;
  kind: 'plan' | 'plan-set';
  title?: string;
  status?: string;
  ready?: boolean;
  session?: string;
  planSetId?: string;
  childCount?: number;
}

export interface BoardItem { id: string; title: string; status: string; lane?: string; reasons?: string[]; }
export interface BoardLane { lane: string; title: string; items: BoardItem[]; }
export interface Epic { id: string; title?: string; status?: string; }
export interface Board { lanes: BoardLane[]; items: BoardItem[]; epics?: Epic[]; }

export interface RecommendationEntry { ref?: string; itemId: string; rationale?: string; title?: string; }
export interface RecommendationGroup { ref: string; title?: string; itemIds: string[]; epicIds?: string[]; rationale?: string; recommendedProfile?: string; }
export interface RecommendationModel {
  recommendedNextSequence: RecommendationEntry[];
  safeParallelizableGroups: RecommendationGroup[];
  rationaleAndAssumptions?: string[];
}

export interface PlanData {
  session: string;
  topic: string;
  status: string;
  ready?: boolean;
  profile?: string | null;
  agent_profile?: string | null;
  planning_type?: string;
  planning_depth?: string;
  open_questions?: string[];
  body?: string;
}

export interface Readiness { ready?: boolean; missingDimensions?: string[]; acDiagnostics?: { message?: string }[]; }
export interface PlanDetail { path?: string; plan?: PlanData; readiness?: Readiness; }
export interface PlanSetDetail { planSet?: { id: string; title?: string; status?: string; strategy?: string; children?: { id: string; status: string; buildable?: boolean; file?: string }[] }; manifestPath?: string; validation?: { ok?: boolean }; anchorContent?: string; }
export type Detail = PlanDetail | PlanSetDetail | null;

export interface WorkstationData { artifacts: Artifact[]; board: Board; recommendations: RecommendationModel | null; }
