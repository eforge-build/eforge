import * as React from 'react';

// ---------------------------------------------------------------------------
// Connecting panel
// ---------------------------------------------------------------------------

export function QueueConnectingPanel() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <p className="text-sm text-muted-foreground">Connecting to daemon queue stream…</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty panel (connected, no items)
// ---------------------------------------------------------------------------

export function QueueEmptyPanel() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <p className="text-sm font-medium text-foreground">No items in the queue</p>
      <p className="text-xs text-muted-foreground mt-1">
        Enqueue a build to see it here.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unavailable panel (disconnected, no snapshot)
// ---------------------------------------------------------------------------

interface QueueUnavailablePanelProps {
  error: string | null;
}

export function QueueUnavailablePanel({ error }: QueueUnavailablePanelProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="text-sm font-medium text-destructive">Queue data unavailable</p>
      {error && (
        <p className="text-xs text-muted-foreground max-w-sm">{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stale snapshot banner (disconnected, but has data)
// ---------------------------------------------------------------------------

interface QueueStaleSnapshotBannerProps {
  lastSnapshotAt: number;
}

export function QueueStaleSnapshotBanner({ lastSnapshotAt }: QueueStaleSnapshotBannerProps) {
  const snapshotTime = new Date(lastSnapshotAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return (
    <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
      Stream disconnected; showing snapshot from {snapshotTime}.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Partial-data banner (connected, but first snapshot not yet received)
// ---------------------------------------------------------------------------

export function QueuePartialDataBanner() {
  return (
    <div className="rounded-md border border-muted-foreground/30 bg-muted px-3 py-2 text-xs text-muted-foreground">
      Queue data is loading; some items may be missing.
    </div>
  );
}
