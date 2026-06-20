import type { QueueItemCapability, QueueItemHold } from '@eforge-build/client/browser';

export const CAPABILITY_UNAVAILABLE_REASON = 'Capability metadata unavailable from daemon.';

export function capabilityOrUnavailable(capability: QueueItemCapability | undefined): QueueItemCapability {
  return capability ?? { allowed: false, reason: CAPABILITY_UNAVAILABLE_REASON };
}

export function capabilityReason(capability: QueueItemCapability | undefined): string {
  const resolved = capabilityOrUnavailable(capability);
  return resolved.allowed ? '' : (resolved.reason?.trim() || 'Action is not available.');
}

export function isHeld(hold: QueueItemHold | undefined): boolean {
  return hold?.held === true;
}
