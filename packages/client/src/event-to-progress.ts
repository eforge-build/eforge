/**
 * Shared event -> progress mapping for `eforge_follow` consumers.
 *
 * The MCP proxy (`packages/eforge/src/cli/mcp-proxy.ts`) and the Pi extension
 * (`packages/pi-eforge/extensions/eforge/index.ts`) both follow a running
 * eforge session and surface high-signal events to the caller: MCP via
 * `notifications/progress`, Pi via the tool's `onUpdate(message)` callback.
 *
 * To prevent the two consumer surfaces from drifting on event messages, the
 * mapping lives here — a single source of truth for which daemon events are
 * high-signal and how they render as human-readable strings.
 *
 * Rich rendering paths (phase labels, counter accumulation, severity filtering)
 * are kept as explicit cases. EforgeEvent types without a custom case fall
 * through to the registry summary lookup; legacy DaemonStreamEvent types not
 * in the registry are filtered (return null).
 */
import type { DaemonStreamEvent } from './session-stream.js';
import type { EforgeEvent } from './events.js';
import { getEventSummary } from './event-registry.js';

/** Running counters accumulated across events in a single follow subscription. */
export interface FollowCounters {
  filesChanged: number;
}

/** A single progress update derived from a daemon event. */
export interface ProgressUpdate {
  message: string;
  /** Updated counters after this event; callers advance their own monotonic progress index. */
  counters: FollowCounters;
}

/**
 * Map a daemon event to a progress update. Returns `null` for events that
 * should be filtered (noisy `agent:*` events, low-severity review issues, or
 * any type not in the high-signal set).
 *
 * Callers pass the current `counters` and receive back the updated counters so
 * running totals (e.g. files changed) can be surfaced in the message.
 */
export function eventToProgress(
  event: DaemonStreamEvent,
  counters: FollowCounters,
): ProgressUpdate | null {
  const type = event.type;
  if (typeof type !== 'string') return null;

  // Explicitly filter the noisy agent event family.
  if (type.startsWith('agent:')) return null;

  switch (type) {
    case 'phase:start': {
      const phase = (event.phase ?? event.command ?? event.planSet) as string | undefined;
      const label = phase ?? 'unknown';
      return { message: `Phase: ${label} starting`, counters };
    }
    case 'phase:end': {
      const phase = (event.phase ?? event.command ?? event.planSet) as string | undefined;
      const label = phase ?? 'unknown';
      return { message: `Phase: ${label} complete`, counters };
    }
    case 'plan:build:files_changed': {
      const files = (event as { files?: unknown }).files;
      const delta = Array.isArray(files) ? files.length : 0;
      const nextCounters: FollowCounters = {
        ...counters,
        filesChanged: counters.filesChanged + delta,
      };
      return {
        message: `Files changed: ${delta} (total ${nextCounters.filesChanged})`,
        counters: nextCounters,
      };
    }
    case 'review:issue': {
      const severity = (event as { severity?: unknown }).severity;
      if (severity !== 'high' && severity !== 'critical') return null;
      const summary = ((event as { summary?: unknown }).summary
        ?? (event as { description?: unknown }).description
        ?? (event as { message?: unknown }).message
        ?? 'review issue') as string;
      return { message: `Issue (${severity}): ${summary}`, counters };
    }
    case 'session:end':
      // Session end is the terminal event — return null to avoid a spurious
      // progress update. The caller handles session:end as a completion signal.
      return null;
    case 'plan:build:failed': {
      const planId = (event as { planId?: unknown }).planId as string | undefined;
      const error = (event as { error?: unknown }).error as string | undefined;
      const label = planId ? `${planId}: ${error ?? 'failed'}` : (error ?? 'failed');
      return { message: `Build failed: ${label}`, counters };
    }
    case 'phase:error': {
      const error = (event as { error?: unknown }).error as string | undefined;
      return { message: `Phase error: ${error ?? 'failed'}`, counters };
    }
    // --- eforge:region plan-02-validation-provider-projections-ui-docs ---
    case 'extension:validation-provider:error': {
      const providerName = (event as { providerName?: unknown }).providerName as string | undefined;
      const extensionName = (event as { extensionName?: unknown }).extensionName as string | undefined;
      const message = (event as { message?: unknown }).message as string | undefined;
      const label = providerName && extensionName ? `${providerName} (${extensionName})` : (providerName ?? 'unknown');
      return { message: `Validation provider ${label} failed: ${message ?? 'unknown error'}`, counters };
    }
    case 'extension:validation-provider:timeout': {
      const providerName = (event as { providerName?: unknown }).providerName as string | undefined;
      const timeoutMs = (event as { timeoutMs?: unknown }).timeoutMs as number | undefined;
      return { message: `Validation provider ${providerName ?? 'unknown'} timed out after ${timeoutMs ?? '?'}ms`, counters };
    }
    case 'extension:validation-provider:complete': {
      const status = (event as { status?: unknown }).status;
      // filter passed (low-signal) — only surface skipped or unexpected statuses
      if (status === 'passed') return null;
      const providerName = (event as { providerName?: unknown }).providerName as string | undefined;
      return { message: `Validation provider ${providerName ?? 'unknown'} ${String(status)}`, counters };
    }
    case 'extension:validation-provider:start':
      // filtered — provider start events are low-signal for consumers
      return null;
    // --- eforge:endregion plan-02-validation-provider-projections-ui-docs ---
    default: {
      // For recognized EforgeEvent types, look up the registry summary.
      // Legacy DaemonStreamEvent types not in the registry return null.
      const summary = getEventSummary(event as unknown as EforgeEvent);
      if (!summary) return null;
      return { message: summary, counters };
    }
  }
}
