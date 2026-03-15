import { useEffect, useMemo } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import type { RunInfo } from '@/lib/types';
import { useApi } from '@/hooks/use-api';
import { groupRunsBySessions, type SessionGroup } from '@/lib/session-utils';
import { formatRelativeTime, formatRunDuration } from '@/lib/format';
import { cn } from '@/lib/utils';

interface SidebarProps {
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  refreshTrigger: number;
}

function StatusIcon({ status }: { status: SessionGroup['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-blue flex-shrink-0 animate-spin" />;
    case 'failed':
      return <XCircle className="w-3.5 h-3.5 text-red flex-shrink-0" />;
    case 'completed':
      return <CheckCircle2 className="w-3.5 h-3.5 text-green flex-shrink-0" />;
  }
}

function SessionItem({ group, isActive, onSelect }: {
  group: SessionGroup;
  isActive: boolean;
  onSelect: () => void;
}) {
  const relative = formatRelativeTime(group.startedAt);
  const duration = formatRunDuration(group.startedAt, group.completedAt);
  const runCount = group.runs.length;

  return (
    <div
      className={cn(
        'px-2.5 py-2 rounded-md cursor-pointer mb-0.5 transition-colors',
        'hover:bg-bg-tertiary',
        isActive && 'bg-bg-tertiary ring-1 ring-cyan/40',
      )}
      onClick={onSelect}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5">
          <StatusIcon status={group.status} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-foreground truncate">
              {group.label}
            </span>
            <span className="text-[11px] text-text-dim">{relative}</span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-1">
            <span className="text-[11px] text-text-dim whitespace-nowrap">{duration}</span>
            {runCount > 1 && (
              <span className="text-[10px] text-text-dim/70 bg-bg-tertiary px-1.5 py-0.5 rounded-sm">
                {runCount} runs
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ currentSessionId, onSelectSession, refreshTrigger }: SidebarProps) {
  const { data: runs, refetch } = useApi<RunInfo[]>('/api/runs');

  // Refetch when trigger changes
  useEffect(() => {
    if (refreshTrigger > 0) {
      refetch();
    }
  }, [refreshTrigger, refetch]);

  const groups = useMemo(() => groupRunsBySessions(runs ?? []), [runs]);

  return (
    <aside className="bg-card border-r border-border overflow-y-auto px-3 py-3">
      <h2 className="text-[11px] uppercase tracking-wider text-text-dim px-2 py-1.5 mb-1">
        Sessions
      </h2>
      {groups.map((group) => (
        <SessionItem
          key={group.key}
          group={group}
          isActive={group.key === currentSessionId}
          onSelect={() => onSelectSession(group.key)}
        />
      ))}
    </aside>
  );
}
