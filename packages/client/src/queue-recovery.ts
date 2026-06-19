/** Shared queue recovery wire contract for daemon, Console, and client helpers. */

export const QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE = 'retry-and-reactivate-descendants' as const;

export type QueueRecoveryStrategy = typeof QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE;
export type QueueRecoveryStrategyWire = QueueRecoveryStrategy | (string & {});

export type QueueRecoveryLocation = 'queue' | 'waiting' | 'failed' | 'skipped';

export type QueueRecoveryNodeRole =
  | 'selected-failed-upstream'
  | 'skipped-descendant'
  | 'related-terminal'
  | 'active-dependency'
  | 'external-dependency';

export interface QueueRecoveryNode {
  id: string;
  title: string;
  location: QueueRecoveryLocation;
  status: QueueRecoveryLocation;
  dependsOn: string[];
  role: QueueRecoveryNodeRole;
}

export interface QueueRecoveryEdge {
  dependentId: string;
  dependencyId: string;
}

export type QueueRecoveryOperationKind = 'move-prd' | 'remove-recovery-sidecars';

export interface QueueRecoveryMovePrdOperation {
  id: string;
  kind: 'move-prd';
  prdId: string;
  expectedSourceLocation: QueueRecoveryLocation;
  targetLocation: QueueRecoveryLocation;
  reason: string;
}

export interface QueueRecoveryRemoveRecoverySidecarsOperation {
  id: string;
  kind: 'remove-recovery-sidecars';
  prdId: string;
  expectedSourceLocation: QueueRecoveryLocation;
  targetLocation?: never;
  reason: string;
}

export type QueueRecoveryOperation = QueueRecoveryMovePrdOperation | QueueRecoveryRemoveRecoverySidecarsOperation;

export type QueueRecoveryOperationStatus = 'planned' | 'applied' | 'blocked' | 'skipped' | 'failed';

export interface QueueRecoveryOperationResult {
  operation: QueueRecoveryOperation;
  status: QueueRecoveryOperationStatus;
  message?: string;
}

export interface QueueRecoveryNotice {
  code: string;
  message: string;
  prdId?: string;
  severity?: 'warning' | 'blocker';
}

export type QueueRecoveryDependencyStatus = 'blocking' | 'satisfied' | 'terminal' | 'stale-historical';

export interface QueueRecoveryDependencyClassification {
  targetPrdId: string;
  dependentPrdId: string;
  dependencyPrdId: string;
  status: QueueRecoveryDependencyStatus;
  reason: string;
  terminalKind?: 'failed' | 'skipped' | 'completed';
  queueStatus?: QueueRecoveryLocation;
  artifactStatus?: 'usable' | 'missing' | 'unusable';
  completedAt?: string;
}

export interface QueueRecoveryDispatchPreflightItem {
  targetPrdId: string;
  canDispatch: boolean;
  blockers: string[];
  warnings: string[];
  stackingEnabled: boolean;
  currentStackParent?: string;
  meaningfulDependencyIds: string[];
  requiresStackParentChoice: boolean;
}

export interface QueueRecoveryDispatchPreflightSummary {
  canApply: boolean;
  blockers: QueueRecoveryNotice[];
  warnings: QueueRecoveryNotice[];
  items: QueueRecoveryDispatchPreflightItem[];
}

export interface QueueRecoveryRemoveDependsOnRepairAction {
  kind: 'remove-depends-on';
  targetPrdId: string;
  dependencyIds: string[];
}

export interface QueueRecoverySetStackParentRepairAction {
  kind: 'set-stack-parent';
  targetPrdId: string;
  selectedParentId: string;
}

export type QueueRecoveryRepairAction = QueueRecoveryRemoveDependsOnRepairAction | QueueRecoverySetStackParentRepairAction;

export interface QueueRecoveryFrontmatterMetadataSummary {
  dependsOn?: string[];
  stackParent?: string;
}

export interface QueueRecoveryRepairResult {
  action: QueueRecoveryRepairAction;
  status: 'applied' | 'blocked' | 'skipped' | 'failed';
  message?: string;
  before?: QueueRecoveryFrontmatterMetadataSummary;
  after?: QueueRecoveryFrontmatterMetadataSummary;
}

export interface QueueRecoveryAnalyzeRequest {
  selectedPrdId: string;
  strategy?: QueueRecoveryStrategyWire;
}

export interface QueueRecoveryAnalyzeResponse {
  selectedPrdId: string;
  strategy: QueueRecoveryStrategyWire;
  eligible: boolean;
  nodes: QueueRecoveryNode[];
  edges: QueueRecoveryEdge[];
  operations: QueueRecoveryOperation[];
  warnings: QueueRecoveryNotice[];
  blockers: QueueRecoveryNotice[];
  dependencyClassifications?: QueueRecoveryDependencyClassification[];
  dispatchPreflight?: QueueRecoveryDispatchPreflightSummary;
  availableRepairActions?: QueueRecoveryRepairAction[];
}

export interface QueueRecoveryApplyRequest {
  selectedPrdId: string;
  strategy?: QueueRecoveryStrategyWire;
  expectedOperations: QueueRecoveryOperation[];
  repairActions?: QueueRecoveryRepairAction[];
  confirmDependencyRemoval?: boolean;
}

export interface QueueRecoveryApplyResponse {
  selectedPrdId: string;
  strategy: QueueRecoveryStrategyWire;
  applied: boolean;
  operationResults: QueueRecoveryOperationResult[];
  warnings: QueueRecoveryNotice[];
  blockers: QueueRecoveryNotice[];
  dispatchPreflight?: QueueRecoveryDispatchPreflightSummary;
  repairResults?: QueueRecoveryRepairResult[];
}

export function isQueueRecoveryStrategy(value: unknown): value is QueueRecoveryStrategy {
  return value === QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE;
}
