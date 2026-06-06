/**
 * Runtime terminal failure tracker for EforgeEngine.build().
 *
 * Observes orchestrator events as they are yielded and retains the latest
 * terminal failure evidence. Call toEvent() after the build loop completes
 * to produce a single authoritative `build:terminal-failure` event for
 * failed builds.
 *
 * Precedence (later evidence can supersede earlier):
 *   plan:build:failed → scope: 'plan'
 *   validation:complete passed=false → scope: 'post-merge-validation'
 *   prd_validation:complete passed=false → scope: 'prd-validation'
 *   acceptance_validation:complete passed=false → scope: 'acceptance-validation'
 *   daemon:error source=stack:artifact-recording → scope: 'artifact-recording'
 *   stack:landing:update status=failed → scope: 'landing'
 *   landing:skipped (after a failed status or related evidence) → scope: 'landing'
 *   other daemon:error → scope: 'daemon'
 */

import type { AgentTerminalSubtype, EforgeEvent, TerminalFailureScope } from './events.js';

// ---------------------------------------------------------------------------
// Internal evidence shape
// ---------------------------------------------------------------------------

interface FailureEvidence {
  scope: TerminalFailureScope;
  message: string;
  planId?: string;
  terminalSubtype?: AgentTerminalSubtype;
  sourceEventType?: string;
  sourceEventTimestamp?: string;
  landing?: { status: string; action?: string; reason?: string };
  validationPassed?: boolean;
  prdValidationPassed?: boolean;
  acceptanceValidationPassed?: boolean;
}

// Priority order: higher index = higher priority (can supersede)
const SCOPE_PRIORITY: TerminalFailureScope[] = [
  'unknown', 'daemon', 'plan', 'compile',
  'post-merge-validation', 'prd-validation', 'acceptance-validation',
  'landing', 'artifact-recording',
];

function scopePriority(scope: TerminalFailureScope): number {
  return SCOPE_PRIORITY.indexOf(scope);
}

// ---------------------------------------------------------------------------
// Tracker factory
// ---------------------------------------------------------------------------

export interface BuildTerminalFailureTracker {
  observe(event: EforgeEvent): void;
  toEvent(status: 'completed' | 'failed', summary: string): EforgeEvent | undefined;
}

export function createBuildTerminalFailureTracker(runId: string): BuildTerminalFailureTracker {
  let evidence: FailureEvidence | undefined;
  let emitted = false;

  function update(candidate: FailureEvidence): void {
    if (!evidence || scopePriority(candidate.scope) >= scopePriority(evidence.scope)) {
      evidence = candidate;
    }
  }

  return {
    observe(event: EforgeEvent): void {
      if (event.type === 'plan:build:failed') {
        update({ scope: 'plan', message: event.error, planId: event.planId, ...(event.terminalSubtype !== undefined ? { terminalSubtype: event.terminalSubtype } : {}), sourceEventType: event.type, sourceEventTimestamp: event.timestamp });
      } else if (event.type === 'validation:complete' && !event.passed) {
        update({ scope: 'post-merge-validation', message: 'Post-merge validation failed', sourceEventType: event.type, sourceEventTimestamp: event.timestamp, validationPassed: false });
      } else if (event.type === 'prd_validation:complete' && !event.passed) {
        update({ scope: 'prd-validation', message: `PRD validation failed: ${(event.gaps ?? []).length} gap(s) found`, sourceEventType: event.type, sourceEventTimestamp: event.timestamp, prdValidationPassed: false });
      } else if (event.type === 'acceptance_validation:complete' && !event.passed) {
        update({ scope: 'acceptance-validation', message: 'Acceptance criteria validation failed', sourceEventType: event.type, sourceEventTimestamp: event.timestamp, acceptanceValidationPassed: false });
      } else if (event.type === 'daemon:error' && event.source === 'stack:artifact-recording') {
        update({ scope: 'artifact-recording', message: event.message, sourceEventType: event.type, sourceEventTimestamp: event.timestamp });
      } else if (event.type === 'stack:landing:update' && event.status === 'failed') {
        update({ scope: 'landing', message: event.reason ?? 'Stack landing failed', sourceEventType: event.type, sourceEventTimestamp: event.timestamp, landing: { status: 'failed', action: event.action, reason: event.reason } });
      } else if (event.type === 'landing:skipped') {
        update({ scope: 'landing', message: event.reason ?? 'Landing skipped', sourceEventType: event.type, sourceEventTimestamp: event.timestamp, landing: { status: 'skipped', action: event.action, ...(event.reason !== undefined ? { reason: event.reason } : {}) } });
      } else if (event.type === 'daemon:error' && (!evidence || evidence.scope === 'unknown')) {
        update({ scope: 'daemon', message: event.message, sourceEventType: event.type, sourceEventTimestamp: event.timestamp });
      }
    },
    toEvent(status: 'completed' | 'failed', summary: string): EforgeEvent | undefined {
      if (status !== 'failed' || emitted) return undefined;
      emitted = true;
      const ev = evidence ?? { scope: 'unknown' as TerminalFailureScope, message: summary };
      return {
        type: 'build:terminal-failure',
        runId,
        failure: {
          scope: ev.scope,
          message: ev.message,
          authoritative: true,
          ...(ev.planId !== undefined ? { planId: ev.planId } : {}),
          ...(ev.terminalSubtype !== undefined ? { terminalSubtype: ev.terminalSubtype } : {}),
          ...(ev.sourceEventType !== undefined ? { sourceEventType: ev.sourceEventType } : {}),
          ...(ev.sourceEventTimestamp !== undefined ? { sourceEventTimestamp: ev.sourceEventTimestamp } : {}),
          ...(ev.landing !== undefined ? { landing: ev.landing } : {}),
          ...(ev.validationPassed !== undefined ? { validationPassed: ev.validationPassed } : {}),
          ...(ev.prdValidationPassed !== undefined ? { prdValidationPassed: ev.prdValidationPassed } : {}),
          ...(ev.acceptanceValidationPassed !== undefined ? { acceptanceValidationPassed: ev.acceptanceValidationPassed } : {}),
        },
        timestamp: new Date().toISOString(),
      };
    },
  };
}
