import * as React from 'react';
import { Bot, RefreshCw } from 'lucide-react';
import { CollapsiblePanel } from '@/components/collapsible-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PlanData } from '@/types';
import { PlanRevisionThread } from './plan-revision-thread';
import { revisionSummaryCounts } from './plan-revision-view-model';
import type { PlanRevisionSessionApi } from './use-plan-revision-session';

interface Props {
  plan: PlanData;
  api: PlanRevisionSessionApi;
  rail?: boolean;
  /** The revision composer, rendered at the top so input and history share one panel. */
  composer?: React.ReactNode;
  /** Open the panel by default when there are annotations to act on, not only past turns. */
  hasAnnotations?: boolean;
}

/**
 * The "Revise with AI" panel: one place for the conversation with the AI - the
 * composer that starts a turn at the top, the turn history (retry/redraft/cancel
 * past turns) below. The composer is injected so it can share annotation
 * selection state with the open-annotations list.
 */
export function PlanRevisionPanel({ plan, api, rail = false, composer, hasAnnotations = false }: Props) {
  const counts = revisionSummaryCounts(api.revisionSession?.turns ?? []);
  const turns = api.revisionSession?.turns ?? [];
  const hasActivity = turns.length > 0 || api.hasRunningTurn;
  const summary = <div className="flex flex-wrap gap-1">
    {counts.running > 0 && <Badge>{counts.running} running</Badge>}
    {counts.patchReady > 0 && <Badge variant="outline">{counts.patchReady} patch ready</Badge>}
    {counts.needsInput > 0 && <Badge variant="outline">{counts.needsInput} needs input</Badge>}
    {counts.failed > 0 && <Badge variant="outline">{counts.failed} failed</Badge>}
    {counts.appliedSections > 0 && <Badge>{counts.appliedSections} applied sections</Badge>}
  </div>;
  return (
    <CollapsiblePanel storageKey={`eforge-plan.revision.${rail ? 'rail.' : ''}${plan.session}`} defaultOpen={rail && (hasActivity || hasAnnotations)} className={rail ? 'bg-background/70' : undefined} title="Revise with AI" icon={<Bot className="h-4 w-4" />} summary={summary} actions={api.initialized ? <Button size="sm" variant="outline" disabled={api.loading} onClick={() => void api.reload({ includePlan: true })}><RefreshCw className="h-4 w-4" /> Refresh revision thread</Button> : undefined}>
      <div className="grid gap-3 text-sm">
        {!api.initialized && <div><Button size="sm" variant="outline" disabled={api.loading} onClick={() => void api.ensureSession()}>Start or resume revision session</Button></div>}
        {composer}
        {composer && turns.length > 0 && <hr className="border-border" />}
        <PlanRevisionThread turns={turns} busy={api.busy} onCancel={api.cancel} onRetry={api.retry} onRedraft={api.redraft} />
      </div>
    </CollapsiblePanel>
  );
}
