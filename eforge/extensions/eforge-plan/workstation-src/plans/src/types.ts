import type { EforgePlanPlanningBacklogCurationDraft, EforgePlanPlanningPlanRevisionTurn, ExtensionJsonObject } from '@eforge-build/client/browser';
import type { BacklogCurationPreviewDetails, BacklogCurationRecommendationProjection, BacklogCurationRecommendationsSkipped, RecommendationReferenceValidationResult } from './backlog-curation-types';

export type JsonObject = ExtensionJsonObject;
export type BacklogCurationDraft = EforgePlanPlanningBacklogCurationDraft;
export type PlanRevisionTurnResult = EforgePlanPlanningPlanRevisionTurn;

export type BacklogCurationScanMode = 'delta' | 'full-implementation-audit';

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
export interface BoardPagination { limit: number; offset: number; returned: number; hasMore: boolean; nextOffset?: number; }
export interface BoardCounts { total: number; open: number; closed: number; }
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
export interface BoardLane { lane: string; title: string; items: BoardItem[]; count?: number; openCount?: number; closedCount?: number; pagination?: BoardPagination; }
export interface Epic { id: string; title?: string; status?: string; priority?: string; tags?: string[]; itemCount?: number; openItemCount?: number; hasBody?: boolean; }
export interface Board { lanes: BoardLane[]; items: BoardItem[]; epics?: Epic[]; lifecycleLinks?: LifecycleLinkRow[]; epicProgress?: EpicProgress[]; counts?: BoardCounts; pagination?: BoardPagination; }

export interface CompactBoardItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  tags: string[];
  lane: string;
  reasons: string[];
  dependsOn: string[];
  unresolvedDependsOn: string[];
  activeTraceReasons?: string[];
  blocked: boolean;
  ready: boolean;
  reviewDue: boolean;
  closed: boolean;
  epic?: string;
  lifecycleState?: string;
}
export interface CompactItemDetail extends CompactBoardItem {
  path: string;
  sections: Record<string, string>;
  linkRows: LifecycleLinkRow[];
  failureEvidence: LifecycleLinkRow[];
  body?: string;
}
export interface CompactEpic extends Epic { tags: string[]; itemCount: number; openItemCount: number; sections?: Record<string, string>; path?: string; body?: string; }
export interface CompactLaneSummary { lane: string; title: string; count: number; openCount: number; closedCount: number; pagination?: BoardPagination; }
export interface CompactBoardResponse { schemaVersion: 1; items: CompactBoardItem[]; total: number; limit: number; offset: number; lanes: CompactLaneSummary[]; epics: CompactEpic[]; counts: BoardCounts; pagination: BoardPagination; }
export interface CompactBoardDetailResponse { schemaVersion: 1; item: CompactItemDetail; epic?: CompactEpic; dependencies: CompactBoardItem[]; dependents: CompactBoardItem[]; }
export type DetailLoadingState = { state: 'idle' } | { state: 'loading' } | { state: 'loaded'; item: BoardItem } | { state: 'error'; message: string };

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

// Draft plan unit shapes live in a sibling module to keep this barrel under the
// file-size cap; re-export so `@/types` stays the single import surface.
export type { DraftPlanUnitProvenance, DraftPlanUnitItemOrigin, DraftPlanUnitItem, DraftPlanUnit, PlanningProfile, UpdateDraftUnitInput, ListDraftUnitsResponse, DraftUnitResponse, PromoteDraftUnitResponse, DraftUnitAdvisorySeverity, DraftUnitAdvisoryFindingCode, DraftUnitAdvisoryFinding, DraftUnitAdvisory, MergeDraftUnitsInput, MergeDraftUnitsResponse, SplitDraftUnitInput, SplitDraftUnitResponse, AdvisoryResponse } from './draft-unit-types';
export { PLANNING_PROFILES } from './draft-unit-types';

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

export interface RecommendationFreshnessView { state: 'missing' | 'fresh' | 'stale'; reason: string; storedSourceFingerprint?: string; comparedSourceFingerprint: string; baselineTaskId?: string; }
export interface RecommendationSummary { recommendedNextItemIds?: string[]; safeParallelizableGroups?: Array<{ ref: string; itemIds: string[]; epicIds?: string[] }>; blockedChainCount?: number; rationaleAndAssumptions?: string[]; }

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
export type { BacklogCurationFullAuditCitation, BacklogCurationFullAuditDiagnostic, BacklogCurationFullAuditEvidenceSummary, BacklogCurationFullAuditHistoricalHint, BacklogCurationFullAuditItemSummary, BacklogCurationFullAuditPreview, BacklogCurationGitDeltaCandidate, BacklogCurationGitDeltaDiagnostic, BacklogCurationGitDeltaPreview, BacklogCurationPreviewDetails, BacklogCurationPreviewValidationError, BacklogCurationRecommendationProjection, BacklogCurationRecommendationsSkipped, BacklogCurationSourceFirstResult, RecommendationReferenceValidationIssue, RecommendationReferenceValidationResult } from './backlog-curation-types';

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
  planRevisionTurn?: PlanRevisionTurnResult;
}

export interface PlanRevisionSectionHash { dimension: string; sha256: string; }
export type PlanRevisionAnnotationTargetKind = 'selection' | 'block' | 'section' | 'whole-plan';
export interface PlanRevisionAnnotationQuoteContext { exact: string; prefix?: string; suffix?: string; }
export interface PlanRevisionAnnotationTarget {
  kind: PlanRevisionAnnotationTargetKind;
  dimension?: string;
  label?: string;
  capturedText: string;
  quoteContext: PlanRevisionAnnotationQuoteContext;
}
export interface PlanRevisionAnnotation {
  annotationId: string;
  targetSession: string;
  body?: string;
  target: PlanRevisionAnnotationTarget;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedByTurnId?: string;
  dismissedAt?: string;
}
export type PlanRevisionTurnSnapshotReason = 'selected' | 'open' | 'selected-and-open';
export interface PlanRevisionTurnSnapshotAnnotation extends PlanRevisionAnnotation {
  snapshotAt: string;
  snapshotReason: PlanRevisionTurnSnapshotReason;
}
export interface PlanRevisionTurnAnnotationSnapshot {
  steering?: string;
  selectedAnnotationIds: string[];
  openAnnotationIds: string[];
  includeOpenAnnotations: boolean;
  annotations: PlanRevisionTurnSnapshotAnnotation[];
}
export interface PlanRevisionAnnotationMutationInput { annotationId: string; body?: string; }
export interface SubmitAnnotationRevisionInput { annotationIds?: string[]; includeOpenAnnotations?: boolean; steering?: string; }
export interface PlanRevisionTurnProjection {
  turnId: string;
  taskId: string;
  parentTaskId?: string;
  retryOfTaskId?: string;
  redraftOfTaskId?: string;
  userMessage: string;
  basePlanFingerprint: string;
  baseSectionHashes: PlanRevisionSectionHash[];
  createdAt: string;
  appliedAt?: string;
  appliedSections?: string[];
  task?: PlanningAgentTaskRecord;
  available?: boolean;
  staleReason?: string;
  status?: AgentTaskStatus;
  annotationSnapshot?: PlanRevisionTurnAnnotationSnapshot;
}
export interface PlanRevisionSessionProjection {
  threadId: string;
  targetSession: string;
  createdAt: string;
  updatedAt: string;
  dismissedAt?: string;
  summary?: string;
  path?: string;
  plan?: PlanData;
  readiness?: Readiness;
  sourceRefs?: PlanSourceRefs;
  lifecycle?: PlanLifecycleProjection;
  annotations?: PlanRevisionAnnotation[];
  turns: PlanRevisionTurnProjection[];
}
export type PlanRevisionApplyOutput =
  | { kind: 'applied'; session: string; turnId: string; taskId: string; appliedSections: string[]; plan?: PlanData; readiness?: Readiness; path?: string; message: string }
  | { kind: 'not-applicable'; session: string; turnId?: string; taskId?: string; message: string };
export interface PlanRevisionRedraftAnswer { questionId?: string; prompt?: string; answer: string; }
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
export interface PlanningTaskWorkflowSelection { itemIds?: string[]; epicId?: string; recommendationRef?: string; sourceRecommendationRef?: string; }
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
  scanMode?: BacklogCurationScanMode;
  itemAuditConcurrency?: number;
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
  recommendationSummary?: RecommendationSummary;
  path: string;
  status: RecommendationStatus;
  recommendationFreshness?: RecommendationFreshnessView;
  activeRefreshTask?: PlanningAgentTaskRecord;
}

export type RoadmapSourceKind = 'local-focus' | 'configured-shared' | 'discovered-conventional';
export type RoadmapSourceRole = 'local-steering' | 'shared-context';
export interface ConfiguredRoadmapSource { id: string; path: string; label?: string; enabled?: boolean; }
export interface RoadmapConfig { schemaVersion: 1; sharedSources: ConfiguredRoadmapSource[]; }
export interface RoadmapSourceProjection {
  kind: RoadmapSourceKind;
  role: RoadmapSourceRole;
  path: string;
  id?: string;
  label?: string;
  configured: boolean;
  editable: boolean;
  exists: boolean;
  sha256?: string;
  headings: string[];
  excerpts: string[];
  content?: string;
  contentTruncated?: boolean;
  readError?: string;
  updatedAt?: string;
  maxContentBytes?: number;
}
export interface RoadmapConflict { code: 'configured-source-missing' | 'duplicate-source' | 'source-read-error' | 'invalid-config' | string; message: string; path?: string; sourceId?: string; }
export interface RoadmapContext {
  schemaVersion: 1;
  localSteering: RoadmapSourceProjection;
  sharedContextSources: RoadmapSourceProjection[];
  discoveredContextSources: RoadmapSourceProjection[];
  assumptions: string[];
  conflicts: RoadmapConflict[];
  truncation: { sourceExcerpts: number; sourceContent: number };
}
export interface RoadmapStateResponse {
  schemaVersion: 1;
  config: RoadmapConfig;
  context: RoadmapContext;
  storagePaths: { localFocus: string; config: string };
}
export interface UpdateRoadmapStateRequest {
  localFocusContent?: string;
  expectedLocalFocusSha256?: string;
  sharedSources?: ConfiguredRoadmapSource[];
}
export interface RefreshRecommendationsResponse {
  task: PlanningAgentTaskRecord;
  entry: PlanningTaskWorkflowEntry;
  sourceFingerprint: string;
  reused?: boolean;
}

export interface AnalyzeAllBacklogResponse {
  task: PlanningAgentTaskRecord;
  entry: PlanningTaskWorkflowEntry;
  sourceFingerprint?: string;
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
    recommendationProjection?: BacklogCurationRecommendationProjection;
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
  recommendationFreshness: RecommendationFreshnessView | null;
  activeRecommendationRefreshTask: PlanningAgentTaskRecord | null;
  roadmapState: RoadmapStateResponse | null;
}
