import * as React from 'react';
import { Bot, RefreshCw, Send } from 'lucide-react';
import { CollapsiblePanel } from '@/components/collapsible-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { PlanData, Readiness } from '@/types';
import { PlanRevisionThread } from './plan-revision-thread';
import { revisionSummaryCounts } from './plan-revision-view-model';
import { usePlanRevisionSession } from './use-plan-revision-session';

interface MutationResult { plan?: PlanData; readiness?: Readiness }
interface Props { plan: PlanData; readiness: Readiness; onApply: (result: MutationResult) => void; onRefresh: () => Promise<void> }

export function PlanRevisionPanel({ plan, onApply, onRefresh }: Props) {
  const api = usePlanRevisionSession({ session: plan.session, onApply, onRefresh });
  const [message, setMessage] = React.useState('');
  const counts = revisionSummaryCounts(api.revisionSession?.turns ?? []);
  const disabled = api.busy || api.loading || api.hasRunningTurn;
  const submit = async () => {
    const sent = await api.submit(message);
    if (sent) setMessage('');
  };
  const summary = <div className="flex flex-wrap gap-1">
    {counts.running > 0 && <Badge>{counts.running} running</Badge>}
    {counts.patchReady > 0 && <Badge variant="outline">{counts.patchReady} patch ready</Badge>}
    {counts.needsInput > 0 && <Badge variant="outline">{counts.needsInput} needs input</Badge>}
    {counts.failed > 0 && <Badge variant="outline">{counts.failed} failed</Badge>}
    {counts.appliedSections > 0 && <Badge>{counts.appliedSections} applied sections</Badge>}
  </div>;
  return (
    <CollapsiblePanel storageKey={`eforge-plan.revision.${plan.session}`} title="Revise with AI" icon={<Bot className="h-4 w-4" />} summary={summary} actions={api.initialized ? <Button size="sm" variant="outline" disabled={api.loading} onClick={() => void api.reload({ includePlan: true })}><RefreshCw className="h-4 w-4" /> Refresh revision thread</Button> : undefined}>
      <div className="grid gap-3 text-sm">
        {!api.initialized && <div><Button size="sm" variant="outline" disabled={api.loading} onClick={() => void api.ensureSession()}>Start or resume revision session</Button></div>}
        <label className="grid gap-1 text-xs"><span className="font-medium">Ask the AI for plan revisions or answers</span><Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Tighten the scope, explain tradeoffs, or revise acceptance criteria…" /></label>
        {api.hasRunningTurn && <p className="text-xs text-muted-foreground">One revision turn can run per plan in V1. Wait for the current turn or cancel it before sending another.</p>}
        <div><Button size="sm" disabled={disabled || message.trim().length === 0} onClick={() => void submit()}><Send className="h-4 w-4" /> Send to AI</Button></div>
        <PlanRevisionThread plan={api.revisionSession?.plan ?? plan} turns={api.revisionSession?.turns ?? []} busy={api.busy} lastApplyByTurn={api.lastApplyByTurn} onCancel={api.cancel} onRetry={api.retry} onRedraft={api.redraft} onApply={api.apply} />
      </div>
    </CollapsiblePanel>
  );
}
