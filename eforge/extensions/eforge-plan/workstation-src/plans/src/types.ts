import type { EforgePlanPlanningBacklogCurationDraft, ExtensionJsonObject } from '@eforge-build/client/browser';

export type JsonObject = ExtensionJsonObject;
export type BacklogCurationDraft = EforgePlanPlanningBacklogCurationDraft;

export interface EforgeBridge {
  version?: number;
  invokeAction<TOutput = unknown>(actionId: string, input?: JsonObject): Promise<TOutput>;
}

export interface LifecycleLinkRow {
  kind: 'session-plan' | 'queue-prd' | 'build-run' | 'build-session' | 'pr' | 'landing' | 'last-event' | string;
  stage?: string;
  status?: string;
  label?: string;
  session?: string;
  sessionId?: string;
  prdId?: string;
  runId?: string;
  buildSessionId?: string;
  prUrl?: string;
  featureBranch?: string;
  branch?: string;
  commitSha?: string;
  timestamp?: string;
  promotedAt?: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  landedAt?: string;
  affectedItemIds?: string[];
  affectedEpicIds?: string[];
  itemRows?: LifecycleItemProgressRow[];
}

export interface LifecycleItemProgressRow {
  itemId: string;
  title?: string;
  status?: string;
  lifecycleState?: string;
  shipped?: boolean;
  evidence?: string;
  rows?: LifecycleLinkRow[];
}

export interface EpicProgress {
  epicId: string;
  title?: string;
  lifecycleState?: string;
  totalItemCount?: number;
  shippedItemCount?: number;
  activeItemCount?: number;
  failedItemCount?: number;
  itemRows?: LifecycleItemProgressRow[];
}

export interface PlanSourceRefs {
  itemIds?: string[];
  epicIds?: string[];
  sourceItemIds?: string[];
  sourceEpicIds?: string[];
  recommendationRef?: string;
  promotedAt?: string;
}

export interface PlanLifecycleProjection {
  sourceRefs: PlanSourceRefs;
  lifecycleState: string;
  itemRows: LifecycleItemProgressRow[];
  linkRows: LifecycleLinkRow[];
  failureEvidence?: LifecycleLinkRow[];
}

export interface PullRequestRef {
  url?: string;
  status?: string;
  branch?: string;
}

export interface LandingRef {
  status?: string;
  branch?: string;
  commitSha?: string;
  landedAt?: string;
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
  sourceRefs?: PlanSourceRefs;
  lifecycleLinks?: LifecycleLinkRow[];
  linkRows?: LifecycleLinkRow[];
  failureEvidence?: LifecycleLinkRow[];
  lifecycleState?: string;
  prRefs?: PullRequestRef[];
  landingRefs?: LandingRef[];
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
  lifecycleLinks?: LifecycleLinkRow[];
  linkRows?: LifecycleLinkRow[];
  failureEvidence?: LifecycleLinkRow[];
  lifecycleState?: string;
  epicProgress?: EpicProgress;
}
export interface BoardLane { lane: string; title: string; items: BoardItem[]; }
export interface Epic { id: string; title?: string; status?: string; }
export interface Board { lanes: BoardLane[]; items: BoardItem[]; epics?: Epic[]; lifecycleLinks?: LifecycleLinkRow[]; epicProgress?: EpicProgress[]; }

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

export type RecommendationStatusState = 'missing' | 'fresh' | 'stale';
export interface RecommendationStaleReason {
  eventType?: string;
  itemIds?: string[];
  correlationKind?: 'single' | 'multi' | 'bootstrapped';
  timestamp?: string;
  summary?: string;
  code?: string;
  message?: string;
  refs?: string[];
  sourceFingerprint?: string;
  lastAppliedSourceFingerprint?: string;
}
export interface RecommendationStatus {
  state: RecommendationStatusState;
  currentPath: string;
  statusPath: string;
  freshAt?: string;
  staleSince?: string;
  lastRefreshedBy?: string;
  sourceFingerprint?: string;
  lastAppliedSourceFingerprint?: string;
  reasons: RecommendationStaleReason[];
  staleReasons: RecommendationStaleReason[];
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
export interface RecommendationReferenceValidationIssue {
  path: string;
  id: string;
  kind: 'item' | 'epic';
  reason: 'unknown' | 'closed' | 'empty';
  status?: string;
  title?: string;
  message: string;
}
export interface RecommendationReferenceValidationResult {
  valid: boolean;
  issues: RecommendationReferenceValidationIssue[];
}
export interface BacklogCurationPreviewValidationError { path: string; message: string; }
export interface BacklogCurationPreviewDetails {
  valid: boolean;
  itemChanges?: number;
  epicChanges?: number;
  noOpRechecks?: number;
  generatedRecommendationValidation?: RecommendationReferenceValidationResult;
  errors?: BacklogCurationPreviewValidationError[];
}
export interface BacklogCurationRecommendationsSkipped {
  reason: 'apply-curation-only' | 'invalid-generated-recommendations';
  generatedRecommendationValidation: RecommendationReferenceValidationResult;
}

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
  backlogCurationDraft?: BacklogCurationDraft;
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
export interface RemovePlanningTaskResponse { taskId: string; removed: boolean; }

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
  purpose?: 'recommendation-refresh' | 'backlog-curation';
  sourceFingerprint?: string;
  appliedAt?: string;
  createdAt: string;
}
export interface PlanningAgentTaskListItem {
  entry: PlanningTaskWorkflowEntry;
  available: boolean;
  status?: AgentTaskStatus;
  task?: PlanningAgentTaskRecord;
  staleReason?: string;
  backlogCurationPreview?: BacklogCurationPreviewDetails;
}
export interface ListPlanningAgentTasksResponse { tasks: PlanningAgentTaskListItem[]; }
export interface PlanningAgentTaskWorkflowStartResponse { task: PlanningAgentTaskRecord; entry: PlanningTaskWorkflowEntry; }
export interface GetRecommendationsResponse {
  recommendations: RecommendationModel | null;
  recommendationSummary?: unknown;
  path: string;
  status: RecommendationStatus;
  activeRefreshTask?: PlanningAgentTaskRecord;
}
export interface AnalyzeAllBacklogResponse {
  task: PlanningAgentTaskRecord;
  entry: PlanningTaskWorkflowEntry;
  sourceFingerprint: string;
  reused?: boolean;
}

export interface AppliedSessionPlanCreationDraft { session: string; relativePath: string; readiness: Readiness; }
export interface ApplyPlanningTaskResponse {
  schemaVersion: 1;
  taskId: string;
  applied: { recommendations: boolean; handoffDrafts: number; sessionPlanSections: number; backlogCuration?: number };
  recommendations?: { path?: string; recommendationSummary?: unknown; recommendations?: RecommendationModel };
  backlogCuration?: {
    itemChanges?: number;
    epicChanges?: number;
    noOpRechecks?: number;
    skippedFreshRechecks?: number;
    changedItemIds?: string[];
    changedEpicIds?: string[];
    recheckedItemIds?: string[];
    recheckedEpicIds?: string[];
    skipped?: BacklogCurationDraft['skipped'];
    needsInput?: BacklogCurationDraft['needsInput'];
    recommendations?: unknown;
    recommendationStatus?: unknown;
    generatedRecommendationValidation?: RecommendationReferenceValidationResult;
    recommendationsSkipped?: BacklogCurationRecommendationsSkipped;
  };
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
  sourceRefs?: PlanSourceRefs;
  lifecycleLinks?: LifecycleLinkRow[];
  linkRows?: LifecycleLinkRow[];
  failureEvidence?: LifecycleLinkRow[];
  lifecycleState?: string;
  itemRows?: LifecycleItemProgressRow[];
  epicProgress?: EpicProgress[];
  prRefs?: PullRequestRef[];
  landingRefs?: LandingRef[];
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
export interface PlanDetail { path?: string; plan?: PlanData; readiness?: Readiness; sourceRefs?: PlanSourceRefs; lifecycle?: PlanLifecycleProjection; }

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

export interface WorkstationData {
  artifacts: Artifact[];
  board: Board;
  recommendations: RecommendationModel | null;
  recommendationStatus: RecommendationStatus | null;
  activeRecommendationRefreshTask: PlanningAgentTaskRecord | null;
}
