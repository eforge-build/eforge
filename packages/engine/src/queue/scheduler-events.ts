/**
 * Internal scheduler child result.
 * `'already-claimed'` is non-terminal: the scheduler does not emit
 * `queue:prd:complete` and leaves the PRD in `running` state until
 * the original worker emits a real terminal completion.
 */
export type QueueSchedulerChildStatus = 'completed' | 'failed' | 'skipped' | 'already-claimed';

/** Events the scheduler reacts to on the bus. */
export type SchedulerInputEvent =
  | { type: 'queue:mutation'; reason: 'enqueue' | 'apply-recovery' | 'external'; timestamp: string }
  | { type: 'queue:prd:complete'; prdId: string; status: 'completed' | 'failed' | 'skipped'; timestamp: string };

/**
 * Set of event type strings the scheduler subscribes to on the bus.
 * The watcher pump uses this set to decide which events to re-emit.
 */
export const SCHEDULER_INPUT_TYPES = new Set<string>(['queue:mutation', 'queue:prd:complete']);
