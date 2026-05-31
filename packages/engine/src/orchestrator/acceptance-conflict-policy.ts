import type { EforgeEvent } from '../events.js';
import type { PhaseContext } from './phases.js';

export type AcceptanceValidationEvent = Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>;

export function acceptanceEventPassed(event: AcceptanceValidationEvent): boolean {
  const allVerdictsPass = event.verdicts.length > 0 && event.verdicts.every((v) => v.verdict === 'pass');
  const hasWaiver = (event.waivers ?? []).some((waiver) => waiver.trim().length > 0);
  return event.passed && event.verdicts.length > 0 && (allVerdictsPass || hasWaiver);
}

export function buildAcceptanceValidationEvents(
  event: AcceptanceValidationEvent,
  ctx: PhaseContext,
): { events: EforgeEvent[]; passed: boolean } {
  const adjusted = applyAcceptanceConflictPolicy(event, ctx);
  const events: EforgeEvent[] = adjusted.progressMessage
    ? [{ timestamp: new Date().toISOString(), type: 'planning:progress', message: adjusted.progressMessage }, adjusted.event]
    : [adjusted.event];
  return { events, passed: acceptanceEventPassed(adjusted.event) };
}

function applyAcceptanceConflictPolicy(
  event: AcceptanceValidationEvent,
  ctx: PhaseContext,
): { event: AcceptanceValidationEvent; progressMessage?: string } {
  const nonPassing = event.verdicts.filter((verdict) => verdict.verdict !== 'pass');
  const conflicts = event.acceptanceConflicts ?? [];
  if (nonPassing.length === 0 || conflicts.length === 0 || acceptanceEventPassed(event)) return { event };

  const policy = ctx.validationPolicy?.acceptanceConflictPolicy ?? 'manual';
  if (policy === 'auto-waive-narrow' && canAutoWaiveAcceptanceConflicts(event, ctx)) {
    const conflictWaivers = conflicts.map(
      (conflict) => `Acceptance criterion conflict (${conflict.criterion}): ${conflict.evidence} Conflicts with: ${conflict.conflictsWith}`,
    );
    return {
      event: { ...event, passed: true, waivers: [...(event.waivers ?? []), ...conflictWaivers] },
      progressMessage: `Acceptance criteria conflict auto-waived for ${conflictWaivers.length} narrow criterion/criteria`,
    };
  }

  if (policy === 'manual') {
    return {
      event,
      progressMessage: 'Acceptance criteria conflict detected — manual review required before the build can pass',
    };
  }

  return { event };
}

function canAutoWaiveAcceptanceConflicts(event: AcceptanceValidationEvent, ctx: PhaseContext): boolean {
  const commands = ctx.validationCommandEvidence ?? [];
  if (commands.length === 0 || commands.some((command) => command.exitCode !== 0)) return false;

  const conflictByCriterion = new Map((event.acceptanceConflicts ?? []).map((conflict) => [conflict.criterion, conflict]));
  const nonPassing = event.verdicts.filter((verdict) => verdict.verdict !== 'pass');
  return nonPassing.length > 0 && nonPassing.every((verdict) => {
    const conflict = conflictByCriterion.get(verdict.criterion);
    return conflict?.scope === 'narrow' && conflict.recommendedAction === 'revise_acceptance_criteria';
  });
}
