import * as React from 'react';
import { ArrowRight, CheckCircle2, ClipboardList, Plus } from 'lucide-react';
import { getBridge } from '@/bridge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/toast';
import { useRouter } from '@/router';
import type { Artifact, Detail, PlanDetail, PlanSetDetail } from '@/types';

const bridge = getBridge();

interface PlansViewProps {
  artifacts: Artifact[];
  onRefresh: () => Promise<void>;
}

export function PlansView({ artifacts, onRefresh }: PlansViewProps) {
  const router = useRouter();
  const toast = useToast();
  const selectedKey = router.segments[1] ?? '';
  const [detail, setDetail] = React.useState<Detail>(null);
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    if (!selectedKey) { setDetail(null); return; }
    const artifact = artifacts.find((entry) => entry.key === selectedKey);
    let active = true;
    void (async () => {
      try {
        const loaded = artifact?.kind === 'plan-set'
          ? await bridge.invokeAction<PlanSetDetail>('show-session-plan-set', { planSetId: artifact.planSetId ?? '' })
          : await bridge.invokeAction<PlanDetail>('show-session-plan', { session: artifact?.session ?? selectedKey.replace(/^plan:/, '') });
        if (active) setDetail(loaded);
      } catch (caught) {
        if (active) toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
      }
    })();
    return () => { active = false; };
  }, [selectedKey, artifacts, toast]);

  const planAction = async (actionId: string) => {
    const plan = isPlanDetail(detail) ? detail.plan : undefined;
    if (!plan) { toast.push('Select a flat session plan first.', 'error'); return; }
    try {
      const result = await bridge.invokeAction<{ message?: string; command?: string }>(actionId, { session: plan.session });
      toast.push(result.command ?? result.message ?? `${actionId} complete.`, 'success');
      await onRefresh();
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className="grid content-start gap-4">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Plans</CardTitle>
              <CardDescription>Session plans and plan sets.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setCreating((value) => !value)}><Plus className="h-4 w-4" /> New</Button>
          </CardHeader>
          <CardContent className="grid gap-2">
            {creating && <CreatePlanForm onClose={() => setCreating(false)} onCreated={onRefresh} />}
            {artifacts.length === 0
              ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No planning artifacts found.</p>
              : artifacts.map((artifact) => (
                <button
                  key={artifact.key}
                  onClick={() => router.navigate(`plans/${artifact.key}`)}
                  className={`rounded-md border p-3 text-left transition-colors hover:bg-accent ${selectedKey === artifact.key ? 'border-primary bg-accent' : 'border-border'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-text-bright">{artifactTitle(artifact)}</span>
                    <Badge variant={artifact.ready ? 'default' : 'outline'}>{artifact.status ?? 'unknown'}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{artifact.kind === 'plan-set' ? `${artifact.childCount ?? 0} child plans` : artifact.session}</p>
                </button>
              ))}
          </CardContent>
        </Card>
      </aside>

      <section className="min-w-0">
        <PlanDetailCard detail={detail} onPlanAction={(actionId) => void planAction(actionId)} />
      </section>
    </div>
  );
}

function PlanDetailCard({ detail, onPlanAction }: { detail: Detail; onPlanAction: (actionId: string) => void }) {
  // Two-step in-app confirmation for the handoff mutation. window.confirm is not
  // usable here: the workstation iframe is sandboxed without allow-modals, so the
  // browser blocks native dialogs.
  const [confirmingHandoff, setConfirmingHandoff] = React.useState(false);

  if (!detail) {
    return <Card><CardHeader><CardTitle>Details</CardTitle><CardDescription>Select an artifact to inspect it.</CardDescription></CardHeader></Card>;
  }
  if (isPlanDetail(detail) && detail.plan) {
    const plan = detail.plan;
    const sections = plan.sections ?? {};
    const sectionEntries = Object.entries(sections);
    const handoff = () => {
      if (!confirmingHandoff) { setConfirmingHandoff(true); return; }
      setConfirmingHandoff(false);
      onPlanAction('handoff-session-plan');
    };
    return (
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>{plan.topic}</CardTitle>
            <CardDescription>{plan.session}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => onPlanAction('check-session-plan-readiness')}>Check readiness</Button>
            <Button size="sm" onClick={() => onPlanAction('set-session-plan-ready')}><CheckCircle2 className="h-4 w-4" /> Set ready</Button>
            <Button variant={confirmingHandoff ? 'destructive' : 'secondary'} size="sm" onClick={handoff} onBlur={() => setConfirmingHandoff(false)}>
              {confirmingHandoff ? 'Confirm handoff' : 'Handoff'} <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge>{plan.status}</Badge>
            <Badge variant="outline">{detail.readiness?.ready ? 'ready' : 'not ready'}</Badge>
            <Badge variant="secondary">{plan.profile ?? 'no profile'}</Badge>
          </div>
          <p className="text-muted-foreground">Missing: {(detail.readiness?.missingDimensions ?? []).join(', ') || 'none'}</p>
          {sectionEntries.length > 0
            ? sectionEntries.map(([title, content]) => (
              <section key={title} className="rounded-md border bg-background/50 p-3">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
                <pre className="whitespace-pre-wrap break-words text-xs text-foreground">{content}</pre>
              </section>
            ))
            : <pre className="max-h-96 overflow-auto rounded-md border bg-background p-3 text-xs">{plan.body ?? ''}</pre>}
        </CardContent>
      </Card>
    );
  }
  const planSet = (detail as PlanSetDetail).planSet;
  return (
    <Card>
      <CardHeader><CardTitle>{planSet?.title ?? planSet?.id ?? 'Plan set'}</CardTitle><CardDescription>{(detail as PlanSetDetail).manifestPath}</CardDescription></CardHeader>
      <CardContent>
        <ul className="grid gap-2 text-sm">
          {(planSet?.children ?? []).map((child) => (
            <li key={child.id} className="rounded-md border p-2"><strong className="text-text-bright">{child.id}</strong> · {child.status}{child.buildable ? '' : ' · not buildable'}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CreatePlanForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const toast = useToast();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const session = String(form.get('session') ?? '').trim();
    const topic = String(form.get('topic') ?? '').trim();
    if (!session || !topic) { toast.push('Session and topic are required.', 'error'); return; }
    try {
      await bridge.invokeAction('create-session-plan', {
        session,
        topic,
        planningType: String(form.get('planningType') ?? 'feature'),
        planningDepth: String(form.get('planningDepth') ?? 'focused'),
      });
      toast.push(`Created ${session}.`, 'success');
      onClose();
      await onCreated();
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    }
  }
  return (
    <form className="grid gap-2 rounded-md border bg-background/50 p-3" onSubmit={(event) => void submit(event)}>
      <Input name="session" placeholder="session-id" required />
      <Input name="topic" placeholder="Topic" required />
      <Select name="planningType" defaultValue="feature"><option value="feature">feature</option><option value="bugfix">bugfix</option><option value="architecture">architecture</option></Select>
      <Select name="planningDepth" defaultValue="focused"><option value="quick">quick</option><option value="focused">focused</option><option value="deep">deep</option></Select>
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" size="sm">Create</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

function artifactTitle(artifact: Artifact) { return artifact.title || artifact.session || artifact.planSetId || artifact.key; }
function isPlanDetail(detail: Detail): detail is PlanDetail { return Boolean(detail && 'plan' in detail); }
