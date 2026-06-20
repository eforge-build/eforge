import * as React from 'react';
import type { AutoBuildState } from '@eforge-build/client/browser';
import { Button } from '@/components/ui/button';

interface SchedulerPauseControlProps {
  autoBuild: AutoBuildState | null;
  pending: boolean;
  error: string | null;
  onPause: () => void;
  onResume: () => void;
}

export function SchedulerPauseControl({ autoBuild, pending, error, onPause, onResume }: SchedulerPauseControlProps) {
  if (!autoBuild) return null;
  const desiredEnabled = autoBuild.desired === 'enabled';
  const paused = autoBuild.scheduler?.paused === true || autoBuild.mode === 'paused';
  const disabledReason = desiredEnabled ? '' : 'Enable auto-build before pausing the scheduler.';
  const label = paused ? 'Resume scheduler' : 'Pause scheduler';

  return (
    <div className="flex items-center gap-2">
      {paused && <span className="text-xs text-yellow">Scheduler paused</span>}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || !desiredEnabled}
        onClick={paused ? onResume : onPause}
      >
        {pending ? 'Updating scheduler…' : label}
      </Button>
      {disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
