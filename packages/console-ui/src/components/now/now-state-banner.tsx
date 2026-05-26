import * as React from 'react';
import { cn } from '@/lib/utils';
import type { NowBanner } from '@/lib/selectors/now';

interface NowStateBannerProps {
  banner: NowBanner;
  className?: string;
}

const KIND_STYLES: Record<NowBanner['kind'], string> = {
  connecting:
    'bg-muted/60 border-border text-muted-foreground',
  disconnected:
    'bg-destructive/10 border-destructive/30 text-destructive',
  stale:
    'bg-yellow-50 border-yellow-300 text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-700 dark:text-yellow-300',
  'partial-data':
    'bg-muted/60 border-border text-muted-foreground',
};

const KIND_ICONS: Record<NowBanner['kind'], string> = {
  connecting: '⟳',
  disconnected: '✕',
  stale: '⚠',
  'partial-data': '◌',
};

export function NowStateBanner({ banner, className }: NowStateBannerProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm mb-4',
        KIND_STYLES[banner.kind],
        className,
      )}
    >
      <span aria-hidden="true">{KIND_ICONS[banner.kind]}</span>
      <span>{banner.message}</span>
    </div>
  );
}
