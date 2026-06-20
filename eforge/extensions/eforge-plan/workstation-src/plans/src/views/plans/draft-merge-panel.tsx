import * as React from 'react';
import { GitMerge, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/toast';
import { draftKey } from '@/lib/plan-links';
import type { DraftPlanUnit, DraftUnitAdvisory, MergeDraftUnitsInput, MergeDraftUnitsResponse } from '@/types';
import { DraftUnitAdvisoryNotice } from './draft-unit-advisory';

interface DraftMergePanelProps {
  units: DraftPlanUnit[];
  onAdvise: (unitIds: string[]) => Promise<DraftUnitAdvisory>;
  onMerge: (input: MergeDraftUnitsInput) => Promise<MergeDraftUnitsResponse>;
  onClose: () => void;
  onOpenUnit?: (key: string) => void;
}

/**
 * Confirmation surface for merging several draft units into one. The dependency
 * advisory previews on mount (read-only) so the user sees whether the units are
 * coupled or independent before committing this destructive combine - the source
 * units are consumed. Title defaults to the first selected unit's title.
 */
export function DraftMergePanel({ units, onAdvise, onMerge, onClose, onOpenUnit }: DraftMergePanelProps) {
  const toast = useToast();
  const unitIds = React.useMemo(() => units.map((unit) => unit.unitId), [units]);
  const [title, setTitle] = React.useState(units[0]?.title ?? '');
  const [advisory, setAdvisory] = React.useState<DraftUnitAdvisory | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void onAdvise(unitIds).then((result) => { if (active) setAdvisory(result); }).catch(() => { if (active) setAdvisory(null); });
    return () => { active = false; };
  }, [unitIds, onAdvise]);

  const merge = () => {
    if (!title.trim()) return;
    setBusy(true);
    void onMerge({ unitIds, title: title.trim() })
      .then((response) => { toast.push(`Merged ${unitIds.length} units into “${response.unit.title}”.`, 'success'); onClose(); onOpenUnit?.(draftKey(response.unit.unitId)); })
      .catch((caught) => toast.push(caught instanceof Error ? caught.message : String(caught), 'error'))
      .finally(() => setBusy(false));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><GitMerge className="h-4 w-4" /> Merge {unitIds.length} draft units</CardTitle>
        <CardDescription>Combine the selected units into one. The originals are consumed; their items are pooled into the new unit.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-1">
          {units.map((unit) => (
            <div key={unit.unitId} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-text-bright">{unit.title}</span>
              <Badge variant="outline" className="shrink-0 text-2xs">{unit.items.length} item{unit.items.length === 1 ? '' : 's'}</Badge>
            </div>
          ))}
        </div>
        <label className="grid gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Merged unit title</span>
          <Input value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
        </label>
        {advisory && <DraftUnitAdvisoryNotice advisory={advisory} />}
        <div className="flex items-center gap-2 border-t pt-3">
          <Button disabled={busy || !title.trim()} onClick={merge}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />} Merge units
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}
