import type { AgentThread, BuildDecision, DecisionPoint, EforgeEvent, ReviewIssue, StoredEvent } from '@/lib/run-state';

type ReviewStrategyDecision = Extract<BuildDecision, { kind: 'review-strategy' }>;
type CycleTerminatedDecision = Extract<BuildDecision, { kind: 'cycle-terminated' }>;
type EvaluatorStrictnessDecision = Extract<BuildDecision, { kind: 'evaluator-strictness' }>;
type ReviewRespawnDecision = Extract<BuildDecision, { kind: 'perspectives-respawned' }>;

type ReviewCompleteEvent = Extract<EforgeEvent, { type: 'plan:build:review:complete' }>;
type PerspectiveCompleteEvent = Extract<EforgeEvent, { type: 'plan:build:review:parallel:perspective:complete' }>;
type PerspectiveErrorEvent = Extract<EforgeEvent, { type: 'plan:build:review:parallel:perspective:error' }>;
type ReviewFixStartEvent = Extract<EforgeEvent, { type: 'plan:build:review:fix:start' }>;
type ReviewFixContinuationEvent = Extract<EforgeEvent, { type: 'plan:build:review:fix:continuation' }>;
type EvaluateCompleteEvent = Extract<EforgeEvent, { type: 'plan:build:evaluate:complete' }>;

export interface ReviewCycleReviewerDetail {
  perspective: string | null;
  issues: ReviewIssue[];
  threadAgentId?: string;
  threadAssociationInferred?: boolean;
}

export interface ReviewCycleRound {
  round: number;
  roundLabel: string;
  reviewers: ReviewCycleReviewerDetail[];
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
    verdicts: Array<{ file: string; hunk?: number; action: 'accept' | 'reject' | 'review'; issueOutcome?: string; reason: string; retryGuidance?: string }>;
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
    reviewers: [],
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
  const hasExplicitRounds = planEvents.some(({ event }) => eventRound(event) !== undefined);
  if (hasExplicitRounds) {
    return { roundsInferred: false, resolveRound: (event: EforgeEvent) => eventRound(event) ?? 0 };
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
      case 'plan:build:review:fix:complete':
        bucket.reviewFix.ran = true;
        break;
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
    }
  }

  if (rounds.size === 0) getRound(rounds, 0);

  const sortedRounds = [...rounds.values()].sort((a, b) => a.round - b.round);
  attachThreads(sortedRounds, threads.filter((thread) => thread.planId === planId), roundsInferred);

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
