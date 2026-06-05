/**
 * Event types re-exported from `@eforge-build/client`.
 *
 * Event wire shapes are owned by `@eforge-build/client` (facade:
 * `packages/client/src/events.schemas.ts`; implementation modules:
 * `packages/client/src/events/`). The SDK re-exports them here so extension
 * authors have a single import path. Do NOT redefine event shapes in this package.
 */

export type { EforgeEvent, AgentRole } from '@eforge-build/client';
export { EforgeEventSchema, safeParseEforgeEvent } from '@eforge-build/client';

/**
 * Narrow an `EforgeEvent` union to the specific variant identified by `TType`.
 *
 * @example
 * ```ts
 * type FailedEvent = EventOfType<'plan:build:failed'>;
 * // -> Extract<EforgeEvent, { type: 'plan:build:failed' }>
 * ```
 */
export type EventOfType<TType extends import('@eforge-build/client').EforgeEvent['type']> = Extract<
  import('@eforge-build/client').EforgeEvent,
  { type: TType }
>;
