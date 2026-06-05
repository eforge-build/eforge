import { REVIEW_PERSPECTIVES } from './constants.js';
import type { EforgeEvent, ReviewIssue, ReviewPerspective } from './root.js';

export const SEVERITY_ORDER: Record<ReviewIssue['severity'], number> = {
  critical: 0,
  warning: 1,
  suggestion: 2,
};

/** Returns true when the given string is one of the built-in review perspective names. */
export function isBuiltInReviewPerspective(key: string): key is ReviewPerspective {
  return (REVIEW_PERSPECTIVES as readonly string[]).includes(key);
}

/** Agent event types that runners always yield (not gated on verbose). */
export function isAlwaysYieldedAgentEvent(event: EforgeEvent): boolean {
  return (
    event.type === 'agent:start' ||
    event.type === 'agent:warning' ||
    event.type === 'agent:stop' ||
    event.type === 'agent:result' ||
    event.type === 'agent:activity' ||
    event.type === 'agent:usage' ||
    event.type === 'agent:tool_use' ||
    event.type === 'agent:tool_result' ||
    event.type === 'extension:agent-context:applied' ||
    event.type === 'extension:agent-context:failed' ||
    event.type === 'extension:agent-context:timeout' ||
    event.type === 'extension:agent-context:unsupported' ||
    event.type === 'extension:agent-tools:applied'
  );
}
