import * as React from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import { getBridge } from '@/bridge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/toast';
import { useRouter } from '@/router';
import type { Artifact, Detail, PlanData, PlanDetail, PlanSetDetail, Readiness } from '@/types';
import { planDisplayTitle } from '@/lib/plan-title';
import { intersectsLens } from '@/lib/lens';
import { PlanDetailCard } from './plans/plan-detail';
import { PlanSetDetailCard } from './plans/plan-set-detail';

const bridge = getBridge();

interface PlansViewProps {
  artifacts: Artifact[];
  onRefresh: () => Promise<void>;
  lensTag?: string;
  lensItemIds?: Set<string>;
}

export function PlansView({ artifacts, onRefresh, lensTag = '', lensItemIds }: PlansViewProps) {
  const router = useRouter();
  const toast = useToast();
  const selectedKey = router.query.get('plan') ?? '';
  const selectPlan = React.useCallback((key: string) => {
    router.setQuery((params) => { if (key) params.set('plan', key); else params.delete('plan'); });
  }, [router]);
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

  // Merge a mutation result (plan and/or readiness) into the loaded flat-plan
  // detail without a full reload, keeping inline edits responsive.
  const applyResult = React.useCallback((result: { plan?: PlanData; readiness?: Readiness }) => {
    setDetail((current) => {
      if (!isPlanDetail(current)) return current;
      return {
        ...current,
        plan: result.plan ?? current.plan,
        readiness: result.readiness ?? current.readiness,
      };
    });
  }, []);

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
              : artifacts.map((artifact) => {
                const inLens = Boolean(lensTag) && intersectsLens(artifact.sourceRefs?.sourceItemIds ?? artifact.sourceRefs?.itemIds, lensItemIds ?? new Set());
                return (
                <button
                  key={artifact.key}
                  onClick={() => selectPlan(artifact.key)}
                  className={`rounded-md border p-3 text-left transition-colors hover:bg-accent ${selectedKey === artifact.key ? 'border-primary bg-accent' : inLens ? 'border-[color:var(--lane-ready)]/50' : 'border-border'} ${lensTag && !inLens ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-text-bright">{artifactTitle(artifact)}</span>
                    <Badge variant={artifact.ready ? 'default' : 'outline'}>{artifact.status ?? 'unknown'}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">{artifact.kind === 'plan-set' ? `${artifact.childCount ?? 0} child plans` : artifact.session}</p>
                    <ArtifactBuildChip artifact={artifact} />
                    {inLens && <span className="rounded border border-[color:var(--lane-ready)]/40 bg-[color:var(--lane-ready)]/10 px-1.5 py-0.5 text-2xs text-[color:var(--lane-ready)]">in {lensTag}</span>}
                  </div>
                </button>
                );
              })}
          </CardContent>
        </Card>
      </aside>

      <section className="min-w-0">
        {isPlanDetail(detail) && detail.plan
          ? <PlanDetailCard detail={{ ...detail, plan: detail.plan }} onApply={applyResult} onRefresh={onRefresh} onDeleted={async () => {
            setDetail(null);
            selectPlan('');
            await onRefresh();
          }} />
          : detail
            ? <PlanSetDetailCard detail={detail as PlanSetDetail} />
            : <Card><CardHeader><CardTitle>Details</CardTitle><CardDescription>Select an artifact to inspect it.</CardDescription></CardHeader></Card>}
      </section>
    </div>
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

// Build-lineage chip: a plan's own build status, derived from its lifecycle
// projection. This is a per-artifact reference to global build state - clicking
// into the plan shows the full evidence and links out to the run; the chip never
// mirrors the global queue here.
const BUILD_CHIP: Record<string, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'border-[color:var(--lane-ready)]/40 text-[color:var(--lane-ready)] bg-[color:var(--lane-ready)]/10' },
  building: { label: 'Building', className: 'border-[color:var(--lane-progress)]/40 text-[color:var(--lane-progress)] bg-[color:var(--lane-progress)]/10' },
  active: { label: 'Building', className: 'border-[color:var(--lane-progress)]/40 text-[color:var(--lane-progress)] bg-[color:var(--lane-progress)]/10' },
  'pr-open': { label: 'PR open', className: 'border-[color:var(--prio-medium)]/40 text-[color:var(--prio-medium)] bg-[color:var(--prio-medium)]/10' },
  partial: { label: 'Partial', className: 'border-[color:var(--prio-medium)]/40 text-[color:var(--prio-medium)] bg-[color:var(--prio-medium)]/10' },
  failed: { label: 'Failed', className: 'border-[color:var(--lane-blocked)]/40 text-[color:var(--lane-blocked)] bg-[color:var(--lane-blocked)]/10' },
  merged: { label: 'Shipped', className: 'border-[color:var(--lane-done)]/40 text-[color:var(--lane-done)] bg-[color:var(--lane-done)]/10' },
  shipped: { label: 'Shipped', className: 'border-[color:var(--lane-done)]/40 text-[color:var(--lane-done)] bg-[color:var(--lane-done)]/10' },
  landed: { label: 'Shipped', className: 'border-[color:var(--lane-done)]/40 text-[color:var(--lane-done)] bg-[color:var(--lane-done)]/10' },
};

function ArtifactBuildChip({ artifact }: { artifact: Artifact }) {
  const state = (artifact.lifecycleState ?? '').toLowerCase();
  const chip = BUILD_CHIP[state];
  if (!chip) return null;
  return <span className={`rounded border px-1.5 py-0.5 text-2xs font-semibold ${chip.className}`}>{chip.label}</span>;
}

function artifactTitle(artifact: Artifact) {
  if (artifact.kind === 'plan-set') return artifact.title || artifact.planSetId || artifact.key;
  return planDisplayTitle(artifact.title, artifact.session ?? artifact.key);
}
function isPlanDetail(detail: Detail): detail is PlanDetail { return Boolean(detail && 'plan' in detail); }
