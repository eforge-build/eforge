import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ConnectionStatus } from '@/lib/types';

interface ConnectionIndicatorProps {
  status: ConnectionStatus;
}

export function ConnectionIndicator({ status }: ConnectionIndicatorProps) {
  const dotColor =
    status === 'connected'
      ? 'bg-green'
      : status === 'connecting'
        ? 'bg-yellow animate-pulse'
        : 'bg-red';

  const label =
    status === 'connected'
      ? 'Connected'
      : status === 'connecting'
        ? 'Connecting...'
        : 'Disconnected';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={`connection status: ${status}`}
            className="flex items-center cursor-default"
          >
            <span
              className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', dotColor)}
              aria-hidden="true"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
