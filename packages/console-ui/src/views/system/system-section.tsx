/**
 * Reusable section shell that renders section title, description,
 * loading, empty, error, and content slots independently.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

interface SystemSectionProps {
  title: string;
  description?: string;
  loading?: boolean;
  error?: string;
  empty?: boolean;
  emptyText?: string;
  children?: React.ReactNode;
  className?: string;
}

export function SystemSection({
  title,
  description,
  loading,
  error,
  empty,
  emptyText,
  children,
  className,
}: SystemSectionProps) {
  return (
    <section
      className={cn('rounded-lg border bg-card p-4 space-y-3', className)}
      aria-label={title}
    >
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground animate-pulse" aria-live="polite">
          Loading {title.toLowerCase()} data...
        </p>
      )}

      {!loading && error && (
        <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        </div>
      )}

      {!loading && !error && empty && (
        <p className="text-xs text-muted-foreground">{emptyText ?? `No data available`}</p>
      )}

      {!loading && children}
    </section>
  );
}
