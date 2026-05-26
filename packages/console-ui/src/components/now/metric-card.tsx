import * as React from 'react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}

export function MetricCard({ label, value, sub, className }: MetricCardProps) {
  return (
    <div
      className={cn(
        'rounded-md border bg-card px-3 py-2 flex flex-col gap-0.5 min-w-0',
        className,
      )}
    >
      <span className="text-xs text-muted-foreground truncate">{label}</span>
      <span className="text-sm font-semibold text-foreground truncate">{value}</span>
      {sub != null && (
        <span className="text-xs text-muted-foreground truncate">{sub}</span>
      )}
    </div>
  );
}
