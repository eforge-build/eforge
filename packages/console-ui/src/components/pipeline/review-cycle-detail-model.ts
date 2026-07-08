import type { AgentThread, BuildDecision, DecisionPoint, EforgeEvent, ReviewIssue, StoredEvent } from '@/lib/run-state';

type ReviewStrategyDecision = Extract<BuildDecision, { kind: 'review-strategy' }>;
type CycleTerminatedDecision = Extract<BuildDecision, { kind: 'cycle-terminated' }>;
type EvaluatorStrictnessDecision = Extract<BuildDecision, { kind: 'evaluator-strictness' }>;
type ReviewRespawnDecision = Extract<BuildDecision, { kind: 'perspectives-respawned' }>;

type ReviewCompleteEvent = Extract<EforgeEvent, { type: 'plan:build:review:complete' }>;
type PerspectiveCompleteEvent = Extract<EforgeEvent, { type: 'plan:build:review:parallel:perspective:complete' }>;
type PerspectiveErrorEvent = Extract<EforgeEvent, { type: 'plan:build:review:parallel:perspective:error' }>;
type ReviewFixStartEvent = Extract<EforgeEvent, { type: 'plan:build:review:fix:start' }>;
type ReviewFixCompleteEvent = Extract<EforgeEvent, { type: 'plan:build:review:fix:complete' }>;
type ReviewFixContinuationEvent = Extract<EforgeEvent, { type: 'plan:build:review:fix:continuation' }>;
type EvaluateCompleteEvent = Extract<EforgeEvent, { type: 'plan:build:evaluate:complete' }>;
type RecoveryStartEvent = Extract<EforgeEvent, { type: 'plan:build:recovery:start' }>;
type RecoveryAttemptStartEvent = Extract<EforgeEvent, { type: 'plan:build:recovery:attempt:start' }>;
type RecoveryAttemptResultEvent = Extract<EforgeEvent, { type: 'plan:build:recovery:attempt:result' }>;
type RecoverySkipEvent = Extract<EforgeEvent, { type: 'plan:build:recovery:skip' }>;
type RecoveryExhaustedEvent = Extract<EforgeEvent, { type: 'plan:build:recovery:exhausted' }>;
type ReviewFixIssueReference = NonNullable<ReviewFixCompleteEvent['issueReferences']>[number];
type EvaluatorVerdict = NonNullable<EvaluateCompleteEvent['verdicts']>[number];

export interface ReviewCycleReviewerDetail {
  perspective: string | null;
  issues: ReviewIssue[];
  threadAgentId?: string;
  threadAssociationInferred?: boolean;
}

export interface ReviewCycleIssueTrace {
  issueId: string;
  reviewer?: {
    perspective: string | null;
    issue: ReviewIssue;
    threadAgentId?: string;
    threadAssociationInferred?: boolean;
  };
  fixerReferences: ReviewFixIssueReference[];
  evaluatorVerdicts: EvaluatorVerdict[];
  danglingReferenceSources: Array<'fixer' | 'evaluator'>;
}

export interface ReviewCycleRecoveryAttempt {
  status: 'started' | 'running' | 'cleared' | 'blocked' | 'skipped' | 'exhausted';
  blockerKind: 'review' | 'test';
  attempt?: number;
  maxAttempts: number;
  attemptsRemaining?: number;
  issueCount?: number;
  reason?: string;
  details?: string;
}

export interface ReviewCycleRound {
  round: number;
  roundLabel: string;
  recoveryAttempts: ReviewCycleRecoveryAttempt[];
  reviewers: ReviewCycleReviewerDetail[];
  linkedTraces: ReviewCycleIssueTrace[];
  unlinkedFixerReferences: ReviewFixIssueReference[];
  perspectiveErrors: Array<{ perspective: string; error: string }>;
  reviewFix: {
    ran: boolean;
    issueCount?: number;
    continuations: Array<{ attempt: number; maxContinuations: number }>;
    threadAgentId?: string;
    threadAssociationInferred?: boolean;
    activity?: AgentThread['activity'];
  };
  evaluator: {
    ran: boolean;
    accepted?: number;
    rejected?: number;
    verdicts: EvaluatorVerdict[];
    threadAgentId?: string;
    threadAssociationInferred?: boolean;
  };
}

export interface ReviewCycleDetail {
  planId: string;
  roundsInferred: boolean;
  summary: {
    terminated?: CycleTerminatedDecision;
    reviewStrategy?: ReviewStrategyDecision;
    evaluatorStrictness?: EvaluatorStrictnessDecision;
    finalAccepted?: number;
    finalRejected?: number;
  };
  rounds: ReviewCycleRound[];
}

interface RoundBucket extends ReviewCycleRound {
  eventTimes: number[];
}

const REVIEW_EVENT_TYPES = new Set<string>([
  'plan:build:review:start',
  'plan:build:review:complete',
  'plan:build:review:parallel:start',
  'plan:build:review:parallel:perspective:start',
  'plan:build:review:parallel:perspective:complete',
  'plan:build:review:parallel:perspective:error',
  'plan:build:review:fix:start',
  'plan:build:review:fix:complete',
  'plan:build:review:fix:continuation',
  'plan:build:evaluate:start',
  'plan:build:evaluate:continuation',
  'plan:build:evaluate:complete',
  'plan:build:recovery:start',
  'plan:build:recovery:attempt:start',
  'plan:build:recovery:attempt:result',
  'plan:build:recovery:skip',
  'plan:build:recovery:exhausted',
]);

function eventPlanId(event: EforgeEvent): string | undefined {
  return 'planId' in event ? event.planId : undefined;
}

function eventRound(event: EforgeEvent): number | undefined {
  return 'round' in event && typeof event.round === 'number' ? event.round : undefined;
}

function timestampMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function makeRound(round: number): RoundBucket {
  return {
    round,
    roundLabel: `Round ${round + 1}`,
    recoveryAttempts: [],
    reviewers: [],
    linkedTraces: [],
    unlinkedFixerReferences: [],
    perspectiveErrors: [],
    reviewFix: { ran: false, continuations: [] },
    evaluator: { ran: false, verdicts: [] },
    eventTimes: [],
  };
}

function getRound(map: Map<number, RoundBucket>, round: number): RoundBucket {
  let bucket = map.get(round);
  if (!bucket) {
    bucket = makeRound(round);
    map.set(round, bucket);
  }
  return bucket;
}

function buildRoundResolver(planEvents: StoredEvent[], decisions: DecisionPoint[]) {
  const explicitEventRounds = planEvents
    .map(({ event }) => ({ time: timestampMs(event.timestamp), round: eventRound(event) }))
    .filter((entry): entry is { time: number; round: number } => entry.round !== undefined)
    .sort((a, b) => a.time - b.time);
  if (explicitEventRounds.length > 0) {
    return {
      roundsInferred: false,
      resolveRound: (event: EforgeEvent) => {
        const explicit = eventRound(event);
        if (explicit !== undefined) return explicit;
        const time = timestampMs(event.timestamp);
        let round = explicitEventRounds[0].round;
        for (const boundary of explicitEventRounds) {
          if (boundary.time <= time) round = boundary.round;
        }
        return round;
      },
    };
  }

  const boundaries = decisions
    .filter((dp): dp is DecisionPoint & { decision: ReviewRespawnDecision } => dp.decision.kind === 'perspectives-respawned')
    .map((dp) => ({ time: timestampMs(dp.timestamp), round: dp.decision.round }))
    .sort((a, b) => a.time - b.time);

  return {
    roundsInferred: true,
    resolveRound: (event: EforgeEvent) => {
      let round = 0;
      const time = timestampMs(event.timestamp);
      for (const boundary of boundaries) {
        if (boundary.time <= time) round = boundary.round;
      }
      return round;
    },
  };
}

function addReviewer(bucket: RoundBucket, perspective: string | null, issues: ReviewIssue[]) {
  const existing = bucket.reviewers.find((r) => r.perspective === perspective);
  if (existing) {
    existing.issues.push(...issues);
  } else {
    bucket.reviewers.push({ perspective, issues: [...issues] });
  }
}

function matchingThread(threads: AgentThread[], agent: string, bounds: { start: number; end: number }, allowInferredFallback: boolean, perspective?: string | null) {
  const candidates = threads.filter((thread) => {
    if (thread.agent !== agent) return false;
    if (perspective !== undefined && (thread.perspective ?? null) !== perspective) return false;
    return true;
  });
  const timed = candidates.find((thread) => {
    const start = timestampMs(thread.startedAt);
    const end = thread.endedAt ? timestampMs(thread.endedAt) : start;
    return end >= bounds.start && start <= bounds.end;
  });
  if (timed) return { thread: timed, inferred: false };
  return allowInferredFallback && candidates.length === 1 ? { thread: candidates[0], inferred: true } : undefined;
}

function validIssueId(value: unknown): value is string {
  return typeof value === 'string' && /\S/.test(value);
}

function ensureTrace(traces: Map<string, ReviewCycleIssueTrace>, issueId: string): ReviewCycleIssueTrace {
  let trace = traces.get(issueId);
  if (!trace) {
    trace = { issueId, fixerReferences: [], evaluatorVerdicts: [], danglingReferenceSources: [] };
    traces.set(issueId, trace);
  }
  return trace;
}

function deriveLinkedTraces(round: RoundBucket) {
  const traces = new Map<string, ReviewCycleIssueTrace>();
  const unlinkedReviewers: ReviewCycleReviewerDetail[] = [];

  for (const reviewer of round.reviewers) {
    const unlinkedIssues: ReviewIssue[] = [];
    for (const issue of reviewer.issues) {
      if (validIssueId(issue.issueId)) {
        const trace = ensureTrace(traces, issue.issueId);
        trace.reviewer ??= {
          perspective: reviewer.perspective,
          issue,
          threadAgentId: reviewer.threadAgentId,
          threadAssociationInferred: reviewer.threadAssociationInferred,
        };
      } else {
        unlinkedIssues.push(issue);
      }
    }
    if (unlinkedIssues.length > 0 || reviewer.issues.length === 0) {
      unlinkedReviewers.push({ ...reviewer, issues: unlinkedIssues });
    }
  }

  const fixReferences = round.unlinkedFixerReferences;
  round.unlinkedFixerReferences = [];
  for (const reference of fixReferences) {
    if (validIssueId(reference.issueId)) {
      const trace = ensureTrace(traces, reference.issueId);
      trace.fixerReferences.push(reference);
      if (!trace.reviewer && !trace.danglingReferenceSources.includes('fixer')) trace.danglingReferenceSources.push('fixer');
    } else {
      round.unlinkedFixerReferences.push(reference);
    }
  }

  const verdicts = round.evaluator.verdicts;
  round.evaluator.verdicts = [];
  for (const verdict of verdicts) {
    const issueIds = (verdict.issueIds ?? []).filter(validIssueId);
    if (issueIds.length === 0) {
      round.evaluator.verdicts.push(verdict);
      continue;
    }
    for (const issueId of issueIds) {
      const trace = ensureTrace(traces, issueId);
      trace.evaluatorVerdicts.push(verdict);
      if (!trace.reviewer && !trace.danglingReferenceSources.includes('evaluator')) trace.danglingReferenceSources.push('evaluator');
    }
  }

  round.reviewers = unlinkedReviewers;
  round.linkedTraces = [...traces.values()];
}

function attachThreads(rounds: RoundBucket[], threads: AgentThread[], inferred: boolean) {
  const allowInferredFallback = inferred && rounds.length === 1;
  for (const round of rounds) {
    const start = round.eventTimes.length > 0 ? Math.min(...round.eventTimes) : 0;
    const end = round.eventTimes.length > 0 ? Math.max(...round.eventTimes) : Number.MAX_SAFE_INTEGER;
    const bounds = { start, end };

    for (const reviewer of round.reviewers) {
      const match = matchingThread(threads, 'reviewer', bounds, allowInferredFallback, reviewer.perspective);
      if (match) {
        reviewer.threadAgentId = match.thread.agentId;
        reviewer.threadAssociationInferred = inferred || match.inferred;
      }
    }

    const fixer = matchingThread(threads, 'review-fixer', bounds, allowInferredFallback);
    if (fixer) {
      round.reviewFix.threadAgentId = fixer.thread.agentId;
      round.reviewFix.threadAssociationInferred = inferred || fixer.inferred;
      round.reviewFix.activity = fixer.thread.activity;
    }

    const evaluator = matchingThread(threads, 'evaluator', bounds, allowInferredFallback);
    if (evaluator) {
      round.evaluator.threadAgentId = evaluator.thread.agentId;
      round.evaluator.threadAssociationInferred = inferred || evaluator.inferred;
    }
  }
}

export function buildReviewCycleDetail(
  events: StoredEvent[],
  threads: AgentThread[],
  planId: string,
  decisions: DecisionPoint[],
): ReviewCycleDetail {
  const planEvents = events.filter(({ event }) => eventPlanId(event) === planId && REVIEW_EVENT_TYPES.has(event.type));
  const { roundsInferred, resolveRound } = buildRoundResolver(planEvents, decisions);
  const rounds = new Map<number, RoundBucket>();

  for (const stored of planEvents) {
    const { event } = stored;
    const round = resolveRound(event);
    const bucket = getRound(rounds, round);
    bucket.eventTimes.push(timestampMs(event.timestamp));

    switch (event.type) {
      case 'plan:build:review:complete':
        addReviewer(bucket, null, (event as ReviewCompleteEvent).issues);
        break;
      case 'plan:build:review:parallel:perspective:complete': {
        const complete = event as PerspectiveCompleteEvent;
        addReviewer(bucket, complete.perspective, complete.issues);
        break;
      }
      case 'plan:build:review:parallel:perspective:error': {
        const error = event as PerspectiveErrorEvent;
        bucket.perspectiveErrors.push({ perspective: error.perspective, error: error.error });
        break;
      }
      case 'plan:build:review:fix:start':
        bucket.reviewFix.ran = true;
        bucket.reviewFix.issueCount = (event as ReviewFixStartEvent).issueCount;
        break;
      case 'plan:build:review:fix:complete': {
        const complete = event as ReviewFixCompleteEvent;
        bucket.reviewFix.ran = true;
        bucket.unlinkedFixerReferences.push(...(complete.issueReferences ?? []));
        break;
      }
      case 'plan:build:review:fix:continuation': {
        const continuation = event as ReviewFixContinuationEvent;
        bucket.reviewFix.ran = true;
        bucket.reviewFix.continuations.push({ attempt: continuation.attempt, maxContinuations: continuation.maxContinuations });
        break;
      }
      case 'plan:build:evaluate:start':
        bucket.evaluator.ran = true;
        break;
      case 'plan:build:evaluate:complete': {
        const complete = event as EvaluateCompleteEvent;
        bucket.evaluator.ran = true;
        bucket.evaluator.accepted = complete.accepted;
        bucket.evaluator.rejected = complete.rejected;
        bucket.evaluator.verdicts.push(...(complete.verdicts ?? []));
        break;
      }
      case 'plan:build:recovery:start': {
        const recovery = event as RecoveryStartEvent;
        bucket.recoveryAttempts.push({ status: 'started', blockerKind: recovery.blockerKind, issueCount: recovery.issueCount, maxAttempts: recovery.maxAttempts, attemptsRemaining: recovery.attemptsRemaining });
        break;
      }
      case 'plan:build:recovery:attempt:start': {
        const recovery = event as RecoveryAttemptStartEvent;
        bucket.recoveryAttempts.push({ status: 'running', blockerKind: recovery.blockerKind, attempt: recovery.attempt, maxAttempts: recovery.maxAttempts, attemptsRemaining: recovery.attemptsRemaining });
        break;
      }
      case 'plan:build:recovery:attempt:result': {
        const recovery = event as RecoveryAttemptResultEvent;
        bucket.recoveryAttempts.push({ status: recovery.blockersCleared ? 'cleared' : 'blocked', blockerKind: recovery.blockerKind, attempt: recovery.attempt, maxAttempts: recovery.maxAttempts, attemptsRemaining: recovery.attemptsRemaining });
        break;
      }
      case 'plan:build:recovery:skip': {
        const recovery = event as RecoverySkipEvent;
        const latestRecovery = [...bucket.recoveryAttempts].reverse().find((attempt) => attempt.blockerKind === recovery.blockerKind);
        bucket.recoveryAttempts.push({ status: 'skipped', blockerKind: recovery.blockerKind, maxAttempts: latestRecovery?.maxAttempts ?? recovery.attemptsRemaining, attemptsRemaining: recovery.attemptsRemaining, reason: recovery.reason, details: recovery.details });
        break;
      }
      case 'plan:build:recovery:exhausted': {
        const recovery = event as RecoveryExhaustedEvent;
        bucket.recoveryAttempts.push({ status: 'exhausted', blockerKind: recovery.blockerKind, attempt: recovery.attemptsUsed, maxAttempts: recovery.maxAttempts, attemptsRemaining: 0, details: recovery.details });
        break;
      }
    }
  }

  if (rounds.size === 0) getRound(rounds, 0);

  const sortedRounds = [...rounds.values()].sort((a, b) => a.round - b.round);
  attachThreads(sortedRounds, threads.filter((thread) => thread.planId === planId), roundsInferred);
  for (const round of sortedRounds) deriveLinkedTraces(round);

  const reviewStrategy = decisions.find((dp): dp is DecisionPoint & { decision: ReviewStrategyDecision } => dp.decision.kind === 'review-strategy')?.decision;
  const terminated = decisions.find((dp): dp is DecisionPoint & { decision: CycleTerminatedDecision } => dp.decision.kind === 'cycle-terminated')?.decision;
  const evaluatorStrictness = decisions.find((dp): dp is DecisionPoint & { decision: EvaluatorStrictnessDecision } => dp.decision.kind === 'evaluator-strictness')?.decision;
  const latestEvaluator = [...sortedRounds].reverse().find((round) => round.evaluator.accepted !== undefined || round.evaluator.rejected !== undefined)?.evaluator;

  return {
    planId,
    roundsInferred,
    summary: {
      terminated,
      reviewStrategy,
      evaluatorStrictness,
      finalAccepted: terminated?.finalEvaluationAccepted ?? latestEvaluator?.accepted,
      finalRejected: terminated?.finalEvaluationRejected ?? latestEvaluator?.rejected,
    },
    rounds: sortedRounds.map(({ eventTimes: _eventTimes, ...round }) => round),
  };
}
