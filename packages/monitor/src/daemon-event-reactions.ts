/**
 * Daemon-owned semantic event reaction helper.
 *
 * Maps persisted daemon-stream events to daemon side effects. Decoupled from
 * SSE subscriber delivery — the server calls `reactToDaemonEvent` for each
 * newly persisted DB row it scans, advancing the cursor before or after
 * subscriber delivery so subscriber errors cannot block reactions.
 *
 * The narrow sink interface lets tests inject a stub without a full
 * AutoBuildController instance.
 */

import type { EforgeEvent } from '@eforge-build/engine/events';
import type { AutoBuildQueueMutationReason } from './auto-build-supervisor.js';

/**
 * Minimal sink that the reaction helper calls for side effects.
 * AutoBuildSupervisor satisfies this interface structurally.
 */
export interface DaemonReactionSink {
  notifyQueueMutation(reason: AutoBuildQueueMutationReason): void;
}

/**
 * React to a single parsed daemon-stream event.
 *
 * Currently handles:
 *  - `enqueue:complete` → `sink.notifyQueueMutation('enqueue')`
 *  - `queue:prd:complete` → `sink.notifyQueueMutation('external')`
 *
 * Safe to call when auto-build is disabled; AutoBuildSupervisor.notifyQueueMutation
 * already owns disabled/inert-watcher behaviour and is a no-op when not applicable.
 *
 * @param event - A fully parsed EforgeEvent (null rows are skipped by the caller).
 * @param sink  - The daemon sink to invoke side effects on.
 */
export function reactToDaemonEvent(event: EforgeEvent, sink: DaemonReactionSink): void {
  if (event.type === 'enqueue:complete') {
    sink.notifyQueueMutation('enqueue');
  } else if (event.type === 'queue:prd:complete') {
    sink.notifyQueueMutation('external');
  }
}
