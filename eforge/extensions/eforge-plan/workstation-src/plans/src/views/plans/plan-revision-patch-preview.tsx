import * as React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { SafeMarkdown } from '@/components/safe-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PlanData, PlanRevisionApplyOutput, PlanRevisionTurnProjection } from '@/types';
import { normalizeDimension, titleCase } from './dimensions';
import { applyResultDetails, applyResultText, currentSectionContent, defaultSelectedSections, patchSections } from './plan-revision-view-model';

interface Props { plan: PlanData; turn: PlanRevisionTurnProjection; applyResult?: PlanRevisionApplyOutput; busy: boolean; onApply: (turn: PlanRevisionTurnProjection, sections: string[]) => Promise<unknown> }

export function PlanRevisionPatchPreview({ plan, turn, applyResult, busy, onApply }: Props) {
  const sections = React.useMemo(() => patchSections(turn), [turn]);
  const [selected, setSelected] = React.useState<string[]>(() => defaultSelectedSections(turn));
  const [confirming, setConfirming] = React.useState(false);
  const resultText = applyResultText(applyResult);
  const resultDetails = applyResultDetails(applyResult);
  const revision = turn.task?.result?.planRevisionTurn;
  const applied = React.useMemo(() => new Set((turn.appliedSections ?? []).map(normalizeDimension)), [turn.appliedSections]);
  const selectable = React.useMemo(() => new Set(sections.map((section) => normalizeDimension(section.dimension)).filter((dimension) => !applied.has(dimension))), [applied, sections]);
  const selectedSelectable = selected.filter((dimension) => selectable.has(dimension));
  React.useEffect(() => {
    setSelected((prev) => prev.filter((dimension) => selectable.has(dimension)));
    setConfirming(false);
  }, [selectable]);
  const toggle = (dimension: string) => {
    const normalized = normalizeDimension(dimension);
    if (!selectable.has(normalized)) return;
    setConfirming(false);
    setSelected((prev) => prev.includes(normalized) ? prev.filter((entry) => entry !== normalized) : [...prev, normalized]);
  };
  const applySelected = async () => {
    if (selectedSelectable.length === 0) return;
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    await onApply(turn, selectedSelectable);
  };

  return (
    <div className="grid gap-3">
      {resultText && (
        <div className={`rounded-md border p-3 text-xs ${applyResult?.kind === 'applied' ? 'border-primary/40 bg-primary/10' : 'border-destructive/40 bg-destructive/10'}`}>
          <div className="flex items-center gap-2 font-medium">{applyResult?.kind === 'applied' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {resultText}</div>
          {resultDetails.length > 0 && (
            <dl className="mt-2 grid gap-1">
              {resultDetails.map(([label, value]) => <div key={label} className="flex gap-2"><dt className="font-medium">{label}:</dt><dd>{value}</dd></div>)}
            </dl>
          )}
        </div>
      )}
      {sections.map((section) => (
        <Card key={section.dimension}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <input aria-label={`Select ${titleCase(section.dimension)}`} type="checkbox" checked={selectedSelectable.includes(normalizeDimension(section.dimension))} disabled={applied.has(normalizeDimension(section.dimension))} onChange={() => toggle(section.dimension)} />
              {titleCase(section.dimension)}
              {applied.has(normalizeDimension(section.dimension)) && <Badge variant="outline">applied</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-xs">
            {section.rationale && <p className="text-muted-foreground">Rationale: {section.rationale}</p>}
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-md border bg-background/50 p-2"><h5 className="mb-1 font-semibold">Current</h5><SafeMarkdown markdown={currentSectionContent(plan, section.dimension) || 'No current content for this dimension.'} /></div>
              <div className="rounded-md border bg-background/50 p-2"><h5 className="mb-1 font-semibold">Proposed</h5><SafeMarkdown markdown={section.content} /></div>
            </div>
          </CardContent>
        </Card>
      ))}
      {revision?.applyGuidance && <p className="text-xs text-muted-foreground">Apply guidance: {revision.applyGuidance}</p>}
      {revision?.noPatchReason && <p className="text-xs text-muted-foreground">No patch reason: {revision.noPatchReason}</p>}
      {(revision?.proposedPatch?.metadata?.openQuestions?.length ?? 0) > 0 && <div className="text-xs text-muted-foreground">Open questions: {revision?.proposedPatch?.metadata?.openQuestions?.join('; ')}</div>}
      {(revision?.proposedPatch?.skippedDimensions?.length ?? 0) > 0 && <div className="text-xs text-muted-foreground">Skipped dimensions: {revision?.proposedPatch?.skippedDimensions?.map((entry) => `${titleCase(entry.dimension)} (${entry.reason})`).join('; ')}</div>}
      <div className="flex justify-end">
        <Button size="sm" disabled={busy || selectedSelectable.length === 0} variant={confirming ? 'destructive' : 'default'} onClick={() => void applySelected()} onBlur={() => setConfirming(false)}>
          {confirming ? 'Confirm apply selected revisions' : 'Apply selected revisions'}
        </Button>
      </div>
    </div>
  );
}
