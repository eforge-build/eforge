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

export interface DependencyRef { id: string; title: string; status?: string; missing: boolean; blocking: boolean; }
export interface EpicRef { id: string; title: string; status?: string; missing: boolean; }
export interface CardNotes { claim: string; evidence: string; recheck: string; promotionPaths: string; }
export interface BoardItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  tags: string[];
  lane: string;
  reasons: string[];
  unresolvedDependsOn: string[];
  activeTraceReasons: string[];
  blocked: boolean;
  ready: boolean;
  reviewDue: boolean;
  closed: boolean;
  epic?: string;
  epicRef?: EpicRef;
  dependencies: DependencyRef[];
  dependents: DependencyRef[];
  notes: CardNotes;
  recRank?: number;
  recLanes: string[];
  recUnblock?: string;
}
export interface BoardLane { lane: string; title: string; items: BoardItem[]; }
export interface Epic { id: string; title?: string; status?: string; }
export interface Board { lanes: BoardLane[]; items: BoardItem[]; epics?: Epic[]; }

export interface RecommendationEntry { ref?: string; itemId: string; rationale?: string; title?: string; }
export interface RecommendationGroup { ref: string; title?: string; itemIds: string[]; epicIds?: string[]; rationale?: string; recommendedProfile?: string; }
export interface RecommendationBlockedChain { ref?: string; itemIds: string[]; blockedBy: string[]; rationale?: string; }
export interface RecommendationModel {
  schemaVersion?: 1;
  activeWork?: RecommendationEntry[];
  readyCandidates?: RecommendationEntry[];
  recommendedNextSequence: RecommendationEntry[];
  safeParallelizableGroups: RecommendationGroup[];
  blockedChains?: RecommendationBlockedChain[];
  rationaleAndAssumptions?: string[];
}

export type AgentTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type PlanningTaskDecision = 'ready' | 'needs-input';
export interface PlanningTaskPlanDraft { title: string; body: string; }
export interface PlanningTaskPlaybookDraft { name: string; body: string; }
export interface PlanningTaskSessionPlanSection { dimension: string; content: string; }
export interface PlanningTaskSkippedDimension { dimension: string; reason: string; }
export interface PlanningTaskSessionPlanPatch { sections: PlanningTaskSessionPlanSection[]; skippedDimensions?: PlanningTaskSkippedDimension[]; }
export interface PlanningTaskSessionPlanCreationDraft {
  session: string;
  topic: string;
  planningType: string;
  planningDepth: string;
  profile?: string;
  agentProfile?: string;
  sections: PlanningTaskSessionPlanSection[];
  skippedDimensions?: PlanningTaskSkippedDimension[];
}
export interface PlanningTaskClarificationQuestion { question: string; why?: string; options?: string[]; }
export interface PlanningTaskHandoffDraft { selection: JsonObject; session?: string; title?: string; profile?: string; }
export interface PlanningTaskSectionProgress { currentSection?: string; coveredSections?: string[]; remainingSections?: string[]; }
export interface PlanningTaskResult {
  summary: string;
  assumptionsOpenQuestions: string[];
  nextSteps?: string[];
  decision?: PlanningTaskDecision;
  rationale?: string;
  clarificationQuestions?: PlanningTaskClarificationQuestion[];
  recommendations?: RecommendationModel;
  handoffDraft?: PlanningTaskHandoffDraft;
  handoffDrafts?: PlanningTaskHandoffDraft[];
  planDrafts?: PlanningTaskPlanDraft[];
  playbookDraft?: PlanningTaskPlaybookDraft;
  sessionPlanPatch?: PlanningTaskSessionPlanPatch;
  sessionPlanCreationDraft?: PlanningTaskSessionPlanCreationDraft;
}
export interface PlanningAgentTaskMetadata {
  label?: string;
  summary?: string;
  progressMessage?: string;
  outputSectionCount?: number;
  warningCount?: number;
  sectionProgress?: PlanningTaskSectionProgress;
}
export interface PlanningAgentTaskRecord {
  taskId: string;
  kind: string;
  status: AgentTaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: PlanningAgentTaskMetadata;
  result?: PlanningTaskResult;
}
export interface PlanningAgentTaskResponse { task: PlanningAgentTaskRecord; }

// Durable planning task workflow projections (extension-owned index joined with daemon task records).
export interface PlanningTaskWorkflowSelection { itemIds?: string[]; epicId?: string; recommendationRef?: string; }
export interface PlanningTaskWorkflowEntry {
  taskId: string;
  parentTaskId?: string;
  originalRequest: string;
  derivedRequest: string;
  selection: PlanningTaskWorkflowSelection;
  requestedOutputSections: string[];
  session?: string;
  planningType?: string;
  planningDepth?: string;
  includeRoadmap?: boolean;
  createdAt: string;
}
export interface PlanningAgentTaskListItem {
  entry: PlanningTaskWorkflowEntry;
  available: boolean;
  status?: AgentTaskStatus;
  task?: PlanningAgentTaskRecord;
  staleReason?: string;
}
export interface ListPlanningAgentTasksResponse { tasks: PlanningAgentTaskListItem[]; }
export interface PlanningAgentTaskWorkflowStartResponse { task: PlanningAgentTaskRecord; entry: PlanningTaskWorkflowEntry; }

export interface AppliedSessionPlanCreationDraft { session: string; relativePath: string; readiness: Readiness; }
export interface ApplyPlanningTaskResponse {
  schemaVersion: 1;
  taskId: string;
  applied: { recommendations: boolean; handoffDrafts: number; sessionPlanSections: number };
  recommendations?: { path?: string; recommendationSummary?: unknown; recommendations?: RecommendationModel };
  handoffs?: unknown[];
  sessionPlanDrafts?: Array<{ session: string; sections: string[] }>;
  sessionPlanCreationDraft?: AppliedSessionPlanCreationDraft;
}

export interface SkippedDimension { name: string; reason: string; }
export interface PlanData {
  session: string;
  topic: string;
  status: string;
  ready?: boolean;
  confidence?: string;
  profile?: string | null;
  agent_profile?: string | null;
  planning_type?: string;
  planning_depth?: string;
  required_dimensions?: string[];
  optional_dimensions?: string[];
  skipped_dimensions?: SkippedDimension[];
  open_questions?: string[];
  body?: string;
  sections?: Record<string, string>;
}

export interface AcDiagnostic { kind?: string; line?: string; message?: string; suggestion?: string; }
export interface Readiness {
  ready?: boolean;
  missingDimensions?: string[];
  coveredDimensions?: string[];
  skippedDimensions?: string[];
  acDiagnostics?: AcDiagnostic[];
}
export interface PlanDetail { path?: string; plan?: PlanData; readiness?: Readiness; }

export interface PlanSetChild {
  id: string;
  file?: string;
  kind?: string;
  status: string;
  buildable?: boolean;
  profile?: string;
  dependsOn?: string[];
  exists?: boolean;
  validation?: { ok?: boolean; diagnosticCount?: number };
}
export interface PlanSetDiagnostic {
  severity?: string;
  code?: string;
  message?: string;
  childId?: string;
  file?: string;
  dependency?: string;
  path?: string;
}
export interface PlanSetSummary {
  id: string;
  title?: string;
  status?: string;
  strategy?: string;
  children?: PlanSetChild[];
  diagnostics?: PlanSetDiagnostic[];
}
export interface PlanSetDetail {
  planSet?: PlanSetSummary;
  validation?: { ok?: boolean; diagnostics?: PlanSetDiagnostic[] };
  dir?: string;
  manifestPath?: string;
  anchorContent?: string;
}
export type Detail = PlanDetail | PlanSetDetail | null;

export interface WorkstationData { artifacts: Artifact[]; board: Board; recommendations: RecommendationModel | null; }
