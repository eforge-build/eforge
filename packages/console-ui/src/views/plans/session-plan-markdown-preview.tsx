/**
 * Scrollable wrapper around the plan body markdown renderer.
 */
import * as React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlanBodyHighlight } from '@/components/preview/plan-body-highlight';

interface SessionPlanMarkdownPreviewProps {
  /** The plan body markdown string from SessionPlanShowResponse.plan.body. */
  body: string;
}

export function SessionPlanMarkdownPreview({ body }: SessionPlanMarkdownPreviewProps) {
  return (
    <ScrollArea className="max-h-96 rounded-md border border-border">
      <div className="p-3">
        <PlanBodyHighlight content={body} />
      </div>
    </ScrollArea>
  );
}
