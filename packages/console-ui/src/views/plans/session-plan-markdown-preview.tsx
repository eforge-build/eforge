/**
 * Scrollable wrapper around the plan body markdown renderer.
 */
import * as React from 'react';
import { PlanBodyHighlight } from '@/components/preview/plan-body-highlight';
import { cn } from '@/lib/utils';

interface SessionPlanMarkdownPreviewProps {
  /** The plan body markdown string from SessionPlanShowResponse.plan.body. */
  body: string;
  className?: string;
}

export function SessionPlanMarkdownPreview({ body, className }: SessionPlanMarkdownPreviewProps) {
  return (
    <div
      className={cn(
        'max-h-96 min-w-0 overflow-y-auto overflow-x-hidden rounded-md border border-border',
        className,
      )}
    >
      <div className="p-3 min-w-0">
        <PlanBodyHighlight content={body} />
      </div>
    </div>
  );
}
