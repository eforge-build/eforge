/**
 * Re-export browser-safe client wire types and define local Console-specific
 * wrapper types. Does not duplicate daemon response interfaces.
 */

// Wire types from @eforge-build/client/browser
export type {
  RunInfo,
  QueueItem,
  SessionMetadata,
  AutoBuildState,
  StackLayerWire,
  EforgeEvent,
} from '@eforge-build/client/browser';

export type {
  DaemonStreamSnapshot,
  SessionStreamSnapshot,
} from '@eforge-build/client/browser';

export type {
  ProjectableState,
} from '@eforge-build/client/browser';

/** Connection status for an SSE stream. */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/** A single entry in the Console activity ring buffer. */
export interface ConsoleActivityEntry {
  /** The SSE event ID, or empty string for live-only events. */
  id: string;
  /** The full EforgeEvent that was received. */
  event: import('@eforge-build/client/browser').EforgeEvent;
  /** Wall-clock time (Date.now()) when the event arrived. */
  receivedAt: number;
}
