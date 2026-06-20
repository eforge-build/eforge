import * as React from 'react';
import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import type { AutoBuildState } from '@eforge-build/client/browser';
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
  onSetEnabled: (enabled: boolean) => void;
}

export function AutoBuildToggle({ enabled, autoBuild, toggling, onSetEnabled }: AutoBuildToggleProps) {
  const [enableDialogOpen, setEnableDialogOpen] = useState(false);
  const disabled = enabled === null || toggling;
  const schedulerPaused = autoBuild?.scheduler?.paused === true || autoBuild?.mode === 'paused';

  function handleSwitchChange(checked: boolean) {
    if (checked) {
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
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center">
              <Switch
                checked={enabled === true}
                disabled={disabled}
                onCheckedChange={handleSwitchChange}
                aria-label="auto-build toggle"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Auto-build:{' '}
            {enabled === null ? 'unknown' : enabled ? (schedulerPaused ? 'on (scheduler paused)' : 'on') : 'off'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <AlertDialog open={enableDialogOpen} onOpenChange={setEnableDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable auto-build?</AlertDialogTitle>
            <AlertDialogDescription>
              Queued builds may start immediately if auto-build is enabled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmEnable}>Enable</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
