import type { QueueItemCapabilities, QueueItemCapability } from '@eforge-build/client';
import type { QueueCascadeRunningOwnership } from '@eforge-build/client';
import type { QueueControlRecord, QueueControlSnapshot } from './snapshot.js';
import { findCascadeDependents } from './snapshot.js';

const allowed: QueueItemCapability = { allowed: true };
const denied = (reason: string): QueueItemCapability => ({ allowed: false, reason });

export const CAPABILITY_REASONS = {
  terminalPriority: 'Priority can only be changed for pending or waiting queue items.',
  noDependency: 'Dependency override requires at least one dependency.',
  alreadyHeld: 'Queue item is already held.',
  notHeld: 'Queue item is not held.',
  holdTerminal: 'Only pending or waiting queue items can be held.',
  unholdTerminal: 'Only held pending or waiting queue items can be unheld.',
  runningRemove: 'Running queue items cannot be removed; cancel them first.',
  dependentRemove: 'This queue item has live dependents; use cascade remove to remove them together.',
  terminalCancel: 'Failed or skipped queue items cannot be cancelled.',
  runningCancelUnowned: 'Running queue item cannot be cancelled without daemon ownership evidence.',
  cascadeCancelUnowned: 'Cascade cancel requires ownership evidence for every running affected item.',
} as const;

function canPriority(record: QueueControlRecord): QueueItemCapability {
  return record.status === 'pending' || record.status === 'waiting' ? allowed : denied(CAPABILITY_REASONS.terminalPriority);
}

function canDependencyOverride(record: QueueControlRecord): QueueItemCapability {
  if (record.status !== 'pending' && record.status !== 'waiting') return denied('Dependency override can only be used for pending or waiting queue items.');
  return record.dependsOn.length > 0 ? allowed : denied(CAPABILITY_REASONS.noDependency);
}

function canHold(record: QueueControlRecord): QueueItemCapability {
  if (record.status !== 'pending' && record.status !== 'waiting') return denied(CAPABILITY_REASONS.holdTerminal);
  return record.frontmatter.held === true ? denied(CAPABILITY_REASONS.alreadyHeld) : allowed;
}

function canUnhold(record: QueueControlRecord): QueueItemCapability {
  if (record.status !== 'pending' && record.status !== 'waiting') return denied(CAPABILITY_REASONS.unholdTerminal);
  return record.frontmatter.held === true ? allowed : denied(CAPABILITY_REASONS.notHeld);
}

function canRemove(record: QueueControlRecord, dependents: number): QueueItemCapability {
  if (record.status === 'running') return denied(CAPABILITY_REASONS.runningRemove);
  if (dependents > 0) return denied(CAPABILITY_REASONS.dependentRemove);
  return allowed;
}

function canCascadeRemove(record: QueueControlRecord): QueueItemCapability {
  return record.status === 'running' ? denied(CAPABILITY_REASONS.runningRemove) : allowed;
}

function canCancel(record: QueueControlRecord, ownership?: QueueCascadeRunningOwnership): QueueItemCapability {
  if (record.status === 'failed' || record.status === 'skipped') return denied(CAPABILITY_REASONS.terminalCancel);
  if (record.status === 'running' && ownership?.owned !== true) return denied(ownership?.reason ?? CAPABILITY_REASONS.runningCancelUnowned);
  return allowed;
}

function canCascadeCancel(record: QueueControlRecord, snapshot: QueueControlSnapshot, ownershipByPrdId?: Map<string, QueueCascadeRunningOwnership>): QueueItemCapability {
  if (record.status === 'failed' || record.status === 'skipped') return denied(CAPABILITY_REASONS.terminalCancel);
  const affected = [record, ...findCascadeDependents(record.id, snapshot.records).map((d) => d.record)];
  for (const item of affected) {
    if (item.status === 'running' && ownershipByPrdId?.get(item.id)?.owned !== true) {
      return denied(CAPABILITY_REASONS.cascadeCancelUnowned);
    }
  }
  return allowed;
}

export function deriveQueueItemCapabilities(record: QueueControlRecord, snapshot: QueueControlSnapshot, ownership?: QueueCascadeRunningOwnership): QueueItemCapabilities {
  const ownershipMap = ownership ? new Map([[record.id, ownership]]) : undefined;
  const dependentCount = findCascadeDependents(record.id, snapshot.records).length;
  return {
    priority: canPriority(record),
    remove: canRemove(record, dependentCount),
    dependencyOverride: canDependencyOverride(record),
    hold: canHold(record),
    unhold: canUnhold(record),
    cascadeRemove: canCascadeRemove(record),
    cancel: canCancel(record, ownership),
    cascadeCancel: canCascadeCancel(record, snapshot, ownershipMap),
  };
}

export function deriveQueueCapabilitiesForSnapshot(snapshot: QueueControlSnapshot, ownershipByPrdId?: Map<string, QueueCascadeRunningOwnership>): Map<string, QueueItemCapabilities> {
  const result = new Map<string, QueueItemCapabilities>();
  for (const record of snapshot.records) {
    const ownership = ownershipByPrdId?.get(record.id);
    const dependentCount = findCascadeDependents(record.id, snapshot.records).length;
    result.set(record.id, {
      priority: canPriority(record),
      remove: canRemove(record, dependentCount),
      dependencyOverride: canDependencyOverride(record),
      hold: canHold(record),
      unhold: canUnhold(record),
      cascadeRemove: canCascadeRemove(record),
      cancel: canCancel(record, ownership),
      cascadeCancel: canCascadeCancel(record, snapshot, ownershipByPrdId),
    });
  }
  return result;
}
