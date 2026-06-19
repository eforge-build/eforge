import type { EforgeEvent, QueueDispatchFailureStage } from '@eforge-build/client';
import type { QueuedPrd } from '../prd-queue.js';
import { setQueuedPrdStackParent } from '../prd-queue.js';

export interface StackedDispatchValidationInput {
  prdId: string;
  title: string;
  dependsOn: string[];
  stackParent?: string;
  stackingEnabled: boolean;
}

export interface StackedDispatchValidationResult {
  canDispatch: boolean;
  blockers: string[];
  warnings: string[];
  inferredStackParent?: string;
  requiresStackParentChoice: boolean;
  meaningfulDependencyIds: string[];
}

export function multipleDependsOnStackParentMessage(prdId: string): string {
  return `Cannot dispatch stacked PRD '${prdId}' with multiple depends_on entries without explicit stack_parent. Add stack_parent to disambiguate the parent layer.`;
}

export function validateStackedDispatch(input: StackedDispatchValidationInput): StackedDispatchValidationResult {
  const meaningfulDependencyIds = [...new Set(input.dependsOn.filter((dep) => dep.length > 0))];
  if (!input.stackingEnabled) return ok(meaningfulDependencyIds);
  if (input.stackParent) {
    if (!meaningfulDependencyIds.includes(input.stackParent)) {
      return {
        canDispatch: false,
        blockers: [`stack_parent '${input.stackParent}' is not listed in depends_on for PRD '${input.prdId}'.`],
        warnings: [],
        requiresStackParentChoice: false,
        meaningfulDependencyIds,
      };
    }
    return ok(meaningfulDependencyIds);
  }
  if (meaningfulDependencyIds.length === 1) return { ...ok(meaningfulDependencyIds), inferredStackParent: meaningfulDependencyIds[0] };
  if (meaningfulDependencyIds.length > 1) {
    return {
      canDispatch: false,
      blockers: [multipleDependsOnStackParentMessage(input.prdId)],
      warnings: [],
      requiresStackParentChoice: true,
      meaningfulDependencyIds,
    };
  }
  return ok(meaningfulDependencyIds);
}

function ok(meaningfulDependencyIds: string[]): StackedDispatchValidationResult {
  return { canDispatch: true, blockers: [], warnings: [], requiresStackParentChoice: false, meaningfulDependencyIds };
}

export function makeQueuePrdDispatchFailedEvent(params: {
  prdId: string;
  title: string;
  reason: string;
  stage: QueueDispatchFailureStage;
  timestamp?: string;
}): EforgeEvent {
  return {
    type: 'queue:prd:dispatch-failed',
    timestamp: params.timestamp ?? new Date().toISOString(),
    prdId: params.prdId,
    title: params.title,
    reason: params.reason,
    stage: params.stage,
  } as EforgeEvent;
}

export async function applyStackedDispatchValidation(params: {
  prd: QueuedPrd;
  cwd: string;
  stackingEnabled: boolean;
}): Promise<{ prd: QueuedPrd } | { error: string }> {
  const validation = validateStackedDispatch({
    prdId: params.prd.id,
    title: params.prd.frontmatter.title,
    dependsOn: params.prd.frontmatter.depends_on ?? [],
    stackParent: params.prd.frontmatter.stack_parent,
    stackingEnabled: params.stackingEnabled,
  });
  if (!validation.canDispatch) return { error: validation.blockers[0] ?? 'Stacked dispatch validation failed' };
  if (!validation.inferredStackParent) return { prd: params.prd };
  try {
    return { prd: await setQueuedPrdStackParent(params.prd, validation.inferredStackParent, params.cwd) };
  } catch (err) {
    return { error: `Failed to persist inferred stack_parent '${validation.inferredStackParent}' for PRD '${params.prd.id}': ${err instanceof Error ? err.message : String(err)}` };
  }
}
