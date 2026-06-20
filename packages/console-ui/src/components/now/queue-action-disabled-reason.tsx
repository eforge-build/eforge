import * as React from 'react';

export function QueueActionDisabledReason({ id, reason }: { id?: string; reason: string }) {
  if (!reason) return null;
  return (
    <span id={id} className="text-xs text-muted-foreground" role="note">
      {reason}
    </span>
  );
}
