// --- eforge:region runs-build-entrypoints ---
import * as React from 'react';
import type { RunState } from '@eforge-build/client/browser';
import { formatAbsolute } from './time-format';

interface RunEventsPreviewProps {
  events: RunState['events'];
}

/** Renders recent persisted event rows from `RunState.events`. */
export function RunEventsPreview({ events }: RunEventsPreviewProps) {
  if (events.length === 0) {
    return <p className="text-xs text-muted-foreground">No persisted events.</p>;
  }

  return (
    <div className="space-y-1">
      {events.map((ev) => (
        <RunEventRow key={ev.id} event={ev} />
      ))}
    </div>
  );
}

interface RunEventRowProps {
  event: RunState['events'][number];
}

function RunEventRow({ event }: RunEventRowProps) {
  const [expanded, setExpanded] = React.useState(false);
  let parsedData: unknown = null;
  let parseError = false;
  try {
    parsedData = JSON.parse(event.data);
  } catch {
    parseError = true;
  }

  return (
    <div className="border rounded p-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-muted-foreground">
          {formatAbsolute(event.timestamp)}
        </span>
        <span className="font-semibold">{event.type}</span>
        {event.planId && (
          <span className="text-muted-foreground">plan:{event.planId}</span>
        )}
        {event.agent && (
          <span className="text-muted-foreground">agent:{event.agent}</span>
        )}
        {!parseError && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto text-xs underline text-muted-foreground hover:text-foreground"
          >
            {expanded ? 'hide data' : 'show data'}
          </button>
        )}
      </div>
      {expanded && !parseError && (
        <pre className="mt-1 text-xs overflow-auto max-h-40 bg-muted p-1 rounded">
          {JSON.stringify(parsedData, null, 2)}
        </pre>
      )}
    </div>
  );
}
// --- eforge:endregion runs-build-entrypoints ---
