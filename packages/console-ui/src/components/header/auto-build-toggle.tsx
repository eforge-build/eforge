import * as React from 'react';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface AutoBuildToggleProps {
  enabled: boolean | null;
}

export function AutoBuildToggle({ enabled }: AutoBuildToggleProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center">
            <Switch
              checked={enabled === true}
              disabled={enabled === null}
              aria-label="auto-build toggle"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Auto-build:{' '}
          {enabled === null ? 'unknown' : enabled ? 'on' : 'off'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
