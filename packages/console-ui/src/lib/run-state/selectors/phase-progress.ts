/**
 * Shared build-phase progress selector.
 *
 * The Now dashboard and run-detail pipeline both render high-level lifecycle
 * phases. This selector derives those phase states from the same reduced
 * RunState signals that feed the detailed timeline: plan statuses, agent
 * threads, map/reduce orchestration, validation command spans, and landing
 * events. Keeping this projection centralized prevents compact views from
 * declaring a phase done while detailed lanes still have running work.
 */
import type { RunState, ValidationCommandSpan } from '../types';
import { earliestGapCloseCompleteMs, selectPlanStatusCounts } from './plan-progress';

export type PhaseProgressStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface BuildPhaseProgress {
  prd: PhaseProgressStatus;
  plans: PhaseProgressStatus;
  prdValidation: PhaseProgressStatus;
  gapClose: PhaseProgressStatus;
  finalValidation: PhaseProgressStatus;
  landing: PhaseProgressStatus;
}

const PENDING_PROGRESS: BuildPhaseProgress = {
  prd: 'pending',
  plans: 'pending',
  prdValidation: 'pending',
  gapClose: 'pending',
  finalValidation: 'pending',
  landing: 'pending',
};

function hasRunningThread(state: RunState, planIds: ReadonlySet<string>): boolean {
  return state.agentThreads.some((thread) => thread.planId !== undefined && planIds.has(thread.planId) && thread.endedAt === null);
}

/**
 * True when `timestamp` falls on the final-validation side of the gap-close
 * boundary. Uses the same comparison as `validationLaneForStart` in
 * plan-progress.ts (including NaN classifying as after) so the compact rail
 * and the swimlane/pipeline lanes always agree on which side a span is on.
 */
function isAfterGapClose(timestamp: string, gapCloseMs: number | null): boolean {
  if (gapCloseMs === null) return false;
  return !(gapCloseMs > Date.parse(timestamp));
}

function commandSpansForSide(
  spans: ValidationCommandSpan[],
  gapCloseMs: number | null,
  side: 'before-gap-close' | 'after-gap-close',
): ValidationCommandSpan[] {
  return spans.filter((span) => isAfterGapClose(span.startedAt, gapCloseMs) === (side === 'after-gap-close'));
}

function commandSpanStatus(spans: ValidationCommandSpan[]): PhaseProgressStatus {
  if (spans.length === 0) return 'pending';
  if (spans.some((span) => span.endedAt === null || span.status === 'running')) return 'running';

  const latest = [...spans].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1);
  if (!latest) return 'pending';
  if (latest.status === 'failed' || latest.status === 'timeout') return 'failed';
  return 'passed';
}

function planningStatus(state: RunState): PhaseProgressStatus {
  let sawPlanningEvent = false;
  let terminal: PhaseProgressStatus | null = null;

  for (const { event } of state.events) {
    if (!event.type.startsWith('planning:')) continue;
    sawPlanningEvent = true;
    if (event.type === 'planning:error') terminal = 'failed';
    if (event.type === 'planning:skip') terminal = 'skipped';
    if (event.type === 'planning:complete') terminal = 'passed';
  }

  if (terminal === 'failed') return 'failed';

  const mapReduce = state.mapReduce;
  const mapReduceRunning = mapReduce !== null && (
    Object.values(mapReduce.atoms).some((atom) => atom.status === 'queued' || atom.status === 'running') ||
    Object.values(mapReduce.reduceNodes).some((node) => node.status === 'queued' || node.status === 'running')
  );

  const planningThreadRunning = hasRunningThread(state, new Set(['planning', 'satisfaction-gate', 'repository-exploration']));
  const mapReduceThreadRunning = mapReduce !== null && hasRunningThread(
    state,
    new Set([...mapReduce.atomOrder, ...mapReduce.reduceOrder]),
  );

  if (mapReduceRunning || planningThreadRunning || mapReduceThreadRunning) return 'running';
  if (terminal) return terminal;
  if (state.earlyOrchestration !== null) return 'passed';
  if (sawPlanningEvent || mapReduce !== null) return 'running';
  return 'pending';
}

function plansStatus(state: RunState): PhaseProgressStatus {
  const counts = selectPlanStatusCounts(state);
  if (counts.failed > 0) return 'failed';
  if (counts.total === 0) return 'pending';
  if (counts.running > 0) return 'running';
  if (counts.complete === counts.total) return 'passed';
  // Some plans finished but none are currently running (e.g. the next plan is
  // waiting on scheduling or dependencies): the phase is still in flight — it
  // must not fall back to pending after showing progress.
  if (counts.complete > 0) return 'running';
  return 'pending';
}

function prdValidationStatus(state: RunState, gapCloseMs: number | null): PhaseProgressStatus {
  const commandStatus = commandSpanStatus(commandSpansForSide(state.validationCommands, gapCloseMs, 'before-gap-close'));
  const validationThreadRunning = hasRunningThread(state, new Set(['validation']));
  let prdStarted = false;
  let prdCompleted = false;

  for (const { event } of state.events) {
    if ((event.type === 'prd_validation:start' || event.type === 'prd_validation:complete') && isAfterGapClose(event.timestamp, gapCloseMs)) continue;
    if (event.type === 'prd_validation:start') prdStarted = true;
    if (event.type === 'prd_validation:complete') prdCompleted = true;
  }

  if (validationThreadRunning || commandStatus === 'running' || (prdStarted && !prdCompleted)) return 'running';
  if (commandStatus === 'failed') return 'failed';
  // Deliberate: a completed first-round check reads 'passed' even when it
  // found gaps (event.passed === false). Gaps are the expected discovery
  // outcome of this phase — the follow-up work renders as the gap-close phase,
  // not as a PRD-check failure.
  if (prdCompleted) return 'passed';
  if (commandStatus === 'passed') return 'running';
  return 'pending';
}

function gapCloseStatus(state: RunState): PhaseProgressStatus {
  let status: PhaseProgressStatus = 'pending';
  for (const { event } of state.events) {
    if (event.type === 'gap_close:start' || event.type === 'gap_close:plan_ready') status = 'running';
    if (event.type === 'gap_close:complete') status = event.passed ? 'passed' : 'failed';
  }
  if (hasRunningThread(state, new Set(['gap-close']))) return 'running';
  return status;
}

function finalValidationStatus(state: RunState, gapCloseMs: number | null): PhaseProgressStatus {
  if (gapCloseMs === null) return 'pending';
  const commandStatus = commandSpanStatus(commandSpansForSide(state.validationCommands, gapCloseMs, 'after-gap-close'));
  const finalThreadRunning = hasRunningThread(state, new Set(['final-validation']));
  let prdStarted = false;
  let prdCompleted = false;
  let lastPassed = false;

  for (const { event } of state.events) {
    if ((event.type === 'prd_validation:start' || event.type === 'prd_validation:complete') && !isAfterGapClose(event.timestamp, gapCloseMs)) continue;
    if (event.type === 'prd_validation:start') prdStarted = true;
    if (event.type === 'prd_validation:complete') {
      prdCompleted = true;
      lastPassed = event.passed;
    }
  }

  if (finalThreadRunning || commandStatus === 'running' || (prdStarted && !prdCompleted)) return 'running';
  if (commandStatus === 'failed') return 'failed';
  // Unlike the first-round check, gaps remaining after gap close mean the
  // final check did not pass — honor the event's verdict. A later passing
  // re-validation (lastPassed reflects the newest complete event) supersedes
  // an earlier failure.
  if (prdCompleted) return lastPassed ? 'passed' : 'failed';
  if (commandStatus === 'passed') return 'running';
  return 'pending';
}

function landingStatus(state: RunState): PhaseProgressStatus {
  let status: PhaseProgressStatus = 'pending';
  for (const { event } of state.events) {
    switch (event.type) {
      case 'landing:start':
      case 'landing:auto-merge:start':
        status = 'running';
        break;
      case 'landing:complete':
      case 'landing:auto-merge:complete':
        status = 'passed';
        break;
      case 'landing:skipped':
      case 'landing:auto-merge:skipped':
        status = 'skipped';
        break;
      case 'stack:landing:update':
        status = event.status === 'started' ? 'running' : event.status === 'complete' ? 'passed' : event.status === 'skipped' ? 'skipped' : event.status === 'failed' ? 'failed' : status;
        break;
      default:
        break;
    }
  }
  return status;
}

/**
 * Backfill for phases that precede a started landing: anything not terminal
 * reads as passed (landing only starts after the earlier phases finished),
 * while failed and skipped verdicts are preserved — a skipped phase must not
 * grow a phantom green check just because the build reached landing.
 */
function backfillForLanding(status: PhaseProgressStatus): PhaseProgressStatus {
  return status === 'failed' || status === 'skipped' ? status : 'passed';
}

export function selectBuildPhaseProgress(state: RunState): BuildPhaseProgress {
  const gapCloseMs = earliestGapCloseCompleteMs(state.events);
  const landing = landingStatus(state);
  const progress = {
    prd: planningStatus(state),
    plans: plansStatus(state),
    prdValidation: prdValidationStatus(state, gapCloseMs),
    gapClose: gapCloseStatus(state),
    finalValidation: finalValidationStatus(state, gapCloseMs),
    landing,
  } satisfies BuildPhaseProgress;

  // Once landing has started, earlier phases should remain visually complete
  // even if their underlying lanes are no longer active. Gap close and final
  // validation legitimately never run on gap-free builds, so pending is
  // preserved for them.
  if (landing !== 'pending') {
    return {
      ...progress,
      prd: backfillForLanding(progress.prd),
      plans: backfillForLanding(progress.plans),
      prdValidation: backfillForLanding(progress.prdValidation),
      gapClose: progress.gapClose === 'pending' ? progress.gapClose : backfillForLanding(progress.gapClose),
      finalValidation: progress.finalValidation === 'pending' ? progress.finalValidation : backfillForLanding(progress.finalValidation),
    };
  }

  return progress;
}

export const EMPTY_BUILD_PHASE_PROGRESS: BuildPhaseProgress = PENDING_PROGRESS;
