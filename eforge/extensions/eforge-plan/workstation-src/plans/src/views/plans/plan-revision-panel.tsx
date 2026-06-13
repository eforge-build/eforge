import * as React from 'react';
import { Bot, Loader2, RefreshCw, Send } from 'lucide-react';
import { CollapsiblePanel } from '@/components/collapsible-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { PlanData } from '@/types';
import { PlanRevisionThread } from './plan-revision-thread';
import { revisionSummaryCounts } from './plan-revision-view-model';
import type { PlanRevisionSessionApi } from './use-plan-revision-session';

interface Props { plan: PlanData; api: PlanRevisionSessionApi }

export function PlanRevisionPanel({ plan, api }: Props) {
  const [message, setMessage] = React.useState('');
  const counts = revisionSummaryCounts(api.revisionSession?.turns ?? []);
  const running = api.hasRunningTurn;
  const disabled = api.busy || api.loading || running;
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
        <label className="grid gap-1 text-xs"><span className="font-medium">Ask the AI for plan revisions or answers</span><Textarea value={message} disabled={disabled} onChange={(event) => setMessage(event.target.value)} placeholder="Tighten the scope, explain tradeoffs, or revise acceptance criteria…" /></label>
        {running && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> The AI is revising this plan. Its changes apply automatically when it finishes; plan edits and new requests are paused until then.</p>}
        <div><Button size="sm" disabled={disabled || message.trim().length === 0} onClick={() => void submit()}><Send className="h-4 w-4" /> Send to AI</Button></div>
        <PlanRevisionThread turns={api.revisionSession?.turns ?? []} busy={api.busy} onCancel={api.cancel} onRetry={api.retry} onRedraft={api.redraft} />
      </div>
    </CollapsiblePanel>
  );
}
