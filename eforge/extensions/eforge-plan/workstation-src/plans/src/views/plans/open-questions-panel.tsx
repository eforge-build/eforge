import * as React from 'react';
import { HelpCircle } from 'lucide-react';
import type { PlanData } from '@/types';

interface OpenQuestionsPanelProps {
  plan: PlanData;
}

/**
 * Read-only display of the plan's open questions. Open questions are managed by
 * the planning flow - generated during planning and resolved by Revise with AI -
 * so this panel surfaces them prominently without a manual editor. Manual input
 * is intended to land later through planning annotations.
 */
export function OpenQuestionsPanel({ plan }: OpenQuestionsPanelProps) {
  const openQuestions = plan.open_questions ?? [];
  if (openQuestions.length === 0) return null;

  return (
    <section className="grid gap-2 rounded-md border bg-background/50 p-3">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <HelpCircle className="h-3.5 w-3.5" /> Open questions <span className="text-foreground">({openQuestions.length})</span>
      </h4>
      <ul className="grid gap-1 text-sm text-foreground">
        {openQuestions.map((question, index) => <li key={index} className="list-inside list-disc">{question}</li>)}
      </ul>
    </section>
  );
}
