import { eforgeReducer, type RunState } from '@eforge-build/monitor-ui/lib/reducer';
import type { EforgeEvent } from '@eforge-build/client';

export function dispatch(state: RunState, events: Array<{ event: EforgeEvent; eventId: string }>): RunState {
  return events.reduce(
    (s, e) => eforgeReducer(s, { type: 'ADD_EVENT', event: e.event, eventId: e.eventId }),
    state,
  );
}
