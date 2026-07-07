import * as React from 'react';
import { useState } from 'react';
import type { AutoBuildState } from '@eforge-build/client/browser';
import { isAutoStartActive } from '@/lib/auto-start';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface AutoBuildToggleProps {
  enabled: boolean | null;
  autoBuild?: AutoBuildState | null;
  toggling: boolean;
  error?: string | null;
  onSetEnabled: (enabled: boolean) => void;
}

export function AutoBuildToggle({ enabled, autoBuild, toggling, error, onSetEnabled }: AutoBuildToggleProps) {
  const [enableDialogOpen, setEnableDialogOpen] = useState(false);
  const effectiveEnabled = isAutoStartActive(autoBuild) ?? enabled;
  const disabled = effectiveEnabled === null || toggling;
  const statusLabel = effectiveEnabled === null ? 'Unknown' : effectiveEnabled ? 'On' : 'Off';
  const recoveryAutoResume = autoBuild?.recoveryAutoResume;
  const recoveryDecisionLabel = recoveryAutoResume?.lastDecision === 'queued'
    ? `Automatic recovery queued (${recoveryAutoResume.attempts}/${recoveryAutoResume.maxAttempts})`
    : recoveryAutoResume?.lastDecision === 'stopped'
      ? `Automatic recovery stopped: ${recoveryAutoResume.stopReason ?? 'unknown'} (${recoveryAutoResume.attempts}/${recoveryAutoResume.maxAttempts})`
      : recoveryAutoResume
        ? `Automatic recovery ${recoveryAutoResume.enabled ? 'enabled' : 'disabled'} (${recoveryAutoResume.attempts}/${recoveryAutoResume.maxAttempts})`
        : null;

  function handleToggleClick() {
    if (disabled) return;
    if (effectiveEnabled !== true) {
      setEnableDialogOpen(true);
      return;
    }
    onSetEnabled(false);
  }

  function handleConfirmEnable() {
    setEnableDialogOpen(false);
    onSetEnabled(true);
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="switch"
                aria-checked={effectiveEnabled === true}
                aria-label={`Auto-start queued builds ${statusLabel}`}
                disabled={disabled}
                onClick={handleToggleClick}
                className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-muted/30 px-2 py-1 text-xs text-foreground shadow-sm transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>Auto-start queued builds</span>
                <span className="rounded-full bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {toggling ? 'Updating…' : statusLabel}
                </span>
                <span
                  aria-hidden="true"
                  className={effectiveEnabled === true
                    ? 'relative inline-flex h-5 w-9 items-center rounded-full border border-primary bg-primary transition-colors'
                    : 'relative inline-flex h-5 w-9 items-center rounded-full border border-border bg-muted transition-colors'}
                >
                  <span
                    className={effectiveEnabled === true
                      ? 'inline-block h-4 w-4 translate-x-4 rounded-full bg-primary-foreground shadow transition-transform'
                      : 'inline-block h-4 w-4 translate-x-0.5 rounded-full bg-background shadow transition-transform'}
                  />
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              When on, queued builds start automatically. Turn off to stop launching new queued builds; running builds continue.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {recoveryDecisionLabel && <span className="text-xs text-muted-foreground">{recoveryDecisionLabel}</span>}
        {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
      </div>

      <AlertDialog open={enableDialogOpen} onOpenChange={setEnableDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on auto-start?</AlertDialogTitle>
            <AlertDialogDescription>
              Queued builds may start immediately when this is turned on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmEnable}>Turn on</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
