/**
 * Derived handler registry from `eventRegistry` project functions.
 *
 * Rather than copying daemon event mutation rules into Console, this module
 * derives a handler map from the `eventRegistry` exported by
 * `@eforge-build/client/browser`. Each entry in the derived registry is a
 * projection function that accepts a narrowed event and the current projectable
 * state, returning a partial delta or undefined.
 */
import { eventRegistry } from '@eforge-build/client/browser';
import type { EforgeEvent } from '@eforge-build/client/browser';
import type { ProjectableState } from '@eforge-build/client/browser';

type ProjectFn = (
  event: EforgeEvent,
  state: Readonly<ProjectableState>,
) => Partial<ProjectableState> | undefined;

/**
 * A flat map from event type string to the `project` function defined in
 * `eventRegistry`. Only entries that have a `project` function are included.
 * Handlers receive an `EforgeEvent` union so callers do not need to narrow
 * before dispatching — each project function already narrows internally.
 */
export type DaemonEventProjectorRegistry = Record<string, ProjectFn | undefined>;

function buildProjectorRegistry(): DaemonEventProjectorRegistry {
  const registry: DaemonEventProjectorRegistry = {};
  for (const [type, meta] of Object.entries(eventRegistry) as Array<
    [string, { project?: (...args: unknown[]) => unknown }]
  >) {
    if (typeof meta.project === 'function') {
      registry[type] = meta.project as ProjectFn;
    }
  }
  return registry;
}

/** Singleton registry derived from eventRegistry at module load time. */
export const daemonEventProjectorRegistry: DaemonEventProjectorRegistry =
  buildProjectorRegistry();
