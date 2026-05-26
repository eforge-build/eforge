// --- eforge:region runs-build-entrypoints ---
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { RunGroupViewModel } from '@/lib/selectors/runs';
import type { ActiveSessionDetail } from '@/hooks/use-active-session-streams';
import { StatusPill } from './status-pill';
import { formatAbsolute } from './time-format';
import type { EforgeEvent, SessionStreamSnapshot } from '@eforge-build/client/browser';

interface ActiveRunsPanelProps {
  groups: RunGroupViewModel[];
  sessions: Record<string, ActiveSessionDetail>;
  selectedId: string | null;
  onSelect: (detailId: string) => void;
}

/** Grid of active session cards consuming live stream detail without opening subscriptions. */
export function ActiveRunsPanel({
  groups,
  sessions,
  selectedId,
  onSelect,
}: ActiveRunsPanelProps) {
  if (groups.length === 0) return null;

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const sessionDetail = group.sessionId ? sessions[group.sessionId] : undefined;
        return (
          <ActiveRunCard
            key={group.key}
            group={group}
            sessionDetail={sessionDetail}
            isSelected={selectedId === group.detailId}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

interface ActiveRunCardProps {
  group: RunGroupViewModel;
  sessionDetail: ActiveSessionDetail | undefined;
  isSelected: boolean;
  onSelect: (detailId: string) => void;
}

function ActiveRunCard({
  group,
  sessionDetail,
  isSelected,
  onSelect,
}: ActiveRunCardProps) {
  const eventCount =
    sessionDetail != null
      ? sessionDetail.snapshotEvents.length + sessionDetail.liveEventCount
      : null;
  const latestEventType =
    sessionDetail != null
      ? deriveLatestEventType(sessionDetail.snapshotEvents, sessionDetail.liveEvents)
      : null;
  const streamStatus = sessionDetail?.connectionStatus ?? 'connecting';

  return (
    <Card className={`border-2${isSelected ? ' border-primary' : ' border-border'}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <StatusPill status={group.status} />
          <span className="truncate">{group.label}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          {group.commands.map((cmd) => (
            <span
              key={cmd}
              className="bg-secondary text-secondary-foreground rounded px-1 py-0.5"
            >
              {cmd}
            </span>
          ))}
          {group.planCountLabel && (
            <span className="text-muted-foreground">{group.planCountLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-muted-foreground flex-wrap">
          {group.startedAt && (
            <span>started: {formatAbsolute(group.startedAt)}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StreamStatusBadge status={streamStatus} />
          {eventCount != null && (
            <span className="text-muted-foreground">{eventCount} events</span>
          )}
          {latestEventType && (
            <span className="text-muted-foreground">latest:{latestEventType}</span>
          )}
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSelect(group.detailId)}
          >
            Inspect run
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface StreamStatusBadgeProps {
  status: string;
}

function StreamStatusBadge({ status }: StreamStatusBadgeProps) {
  const variant =
    status === 'connected'
      ? 'secondary'
      : status === 'disconnected'
        ? 'destructive'
        : 'outline';
  return (
    <Badge variant={variant} className="font-mono text-xs">
      stream:{status}
    </Badge>
  );
}

function deriveLatestEventType(
  snapshotEvents: SessionStreamSnapshot['events'],
  liveEvents: EforgeEvent[],
): string | null {
  // Live events are EforgeEvent objects with a direct type field
  if (liveEvents.length > 0) {
    return liveEvents[liveEvents.length - 1].type ?? null;
  }
  if (snapshotEvents.length === 0) return null;
  // Snapshot events are persisted rows: { id: number, data: string }
  // where data is a JSON-encoded event payload containing the type field
  const last = snapshotEvents[snapshotEvents.length - 1];
  if (!last) return null;
  try {
    const parsed = JSON.parse((last as { id: number; data: string }).data) as { type?: string };
    return parsed.type ?? null;
  } catch {
    return null;
  }
}
// --- eforge:endregion runs-build-entrypoints ---
