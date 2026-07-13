/**
 * Display-only labels for declared build plans. Canonical IDs remain separate
 * so routes, selection, dependencies, and preview requests always use IDs.
 */
export interface PlanPresentation {
  label: string;
  tooltip: readonly [string, string];
}

export function planPresentation(index: number, name: string | undefined, planId: string): PlanPresentation {
  const number = String(index + 1).padStart(2, '0');
  const readableName = name?.trim() || planId;
  const label = `Plan ${number} — ${readableName}`;
  return { label, tooltip: [label, `ID: ${planId}`] };
}
