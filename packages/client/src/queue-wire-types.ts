export interface QueueItemCapability { allowed: boolean; reason?: string }
export interface QueueItemCapabilities { priority: QueueItemCapability; remove: QueueItemCapability; dependencyOverride: QueueItemCapability; hold: QueueItemCapability; unhold: QueueItemCapability; cascadeRemove: QueueItemCapability; cancel: QueueItemCapability; cascadeCancel: QueueItemCapability }
export interface QueueItemHold { held: boolean; reason?: string; heldAt?: string }
export interface FailedEnqueueProvenance { label: string }
export interface FailedEnqueueRecoveryCommand { executable: string; args: string[] }
export interface FailedEnqueueInfo { runId: string; sessionId?: string; sourceLabel: string; provenance?: FailedEnqueueProvenance; failureReason: string; failedAt: string; canReenqueue: boolean; disabledReason?: string; nextCommand: FailedEnqueueRecoveryCommand; resolvedAt?: string }
