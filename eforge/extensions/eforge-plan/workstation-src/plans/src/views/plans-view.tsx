import * as React from 'react';
import { AlertTriangle, ClipboardList, GitMerge, Plus } from 'lucide-react';
import { getBridge } from '@/bridge';
import { Timestamp } from '@/components/timestamp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ToneChip } from '@/components/ui/tone-chip';
import { useToast } from '@/components/toast';
import { useRouter } from '@/router';
import type { Tone } from '@/lib/tone';
import type { Artifact, Detail, DraftPlanUnit, DraftPlanUnitListItem, DraftUnitAdvisory, DraftUnitResponse, MergeDraftUnitsInput, MergeDraftUnitsResponse, PlanData, PlanDetail, PlanSetDetail, PromoteDraftUnitResponse, Readiness, SplitDraftUnitInput, SplitDraftUnitResponse, UpdateDraftUnitInput } from '@/types';
import { planDisplayTitle } from '@/lib/plan-title';
import { selectPlanRecencyTimestamp } from '@/lib/plan-timestamps';
import { draftKey, parseDraftKey, usePlanNavigation } from '@/lib/plan-links';
import { PlanDetailWorkspace } from './plans/plan-detail-workspace';
import { PlanSetDetailCard } from './plans/plan-set-detail';
import { DraftUnitDetailCard } from './plans/draft-unit-detail';
import { DraftMergePanel } from './plans/draft-merge-panel';

const bridge = getBridge();

type HandoffStatus = 'pending' | 'failed';
interface OptimisticHandoffState { id: string; session: string; title: string; status: HandoffStatus; message: string; }

interface PlansViewProps {
  artifacts: Artifact[];
  draftUnits: DraftPlanUnitListItem[];
  titles: Map<string, string>;
  onRefresh: () => Promise<void>;
  onUpdateDraftUnit: (input: UpdateDraftUnitInput) => Promise<DraftPlanUnit>;
  onDeleteDraftUnit: (unitId: string) => Promise<void>;
  onPromoteDraftUnit: (unitId: string) => Promise<PromoteDraftUnitResponse>;
  onMergeDraftUnits: (input: MergeDraftUnitsInput) => Promise<MergeDraftUnitsResponse>;
  onSplitDraftUnit: (input: SplitDraftUnitInput) => Promise<SplitDraftUnitResponse>;
  onAdviseMergeDraftUnits: (unitIds: string[]) => Promise<DraftUnitAdvisory>;
  onAdviseSplitDraftUnit: (unitId: string, itemIds: string[]) => Promise<DraftUnitAdvisory>;
}

export function PlansView({ artifacts, draftUnits, titles, onRefresh, onUpdateDraftUnit, onDeleteDraftUnit, onPromoteDraftUnit, onMergeDraftUnits, onSplitDraftUnit, onAdviseMergeDraftUnits, onAdviseSplitDraftUnit }: PlansViewProps) {
  const router = useRouter();
  const toast = useToast();
  const nav = usePlanNavigation();
  const selectedKey = router.query.get('plan') ?? '';
  const selectPlan = React.useCallback((key: string) => {
    router.setQuery((params) => { if (key) params.set('plan', key); else params.delete('plan'); });
  }, [router]);

  // Merge mode: pick 2+ draft (non-promoted) units, then confirm in the detail
  // pane. Promoted units are frozen and never selectable here.
  const [mergeMode, setMergeMode] = React.useState(false);
  const [mergeSelection, setMergeSelection] = React.useState<Set<string>>(new Set());
  const [merging, setMerging] = React.useState(false);
  const mergeableCount = React.useMemo(() => draftUnits.filter((unit) => unit.status === 'draft').length, [draftUnits]);
  const toggleMergePick = React.useCallback((unitId: string) => {
    setMergeSelection((prev) => { const next = new Set(prev); if (next.has(unitId)) next.delete(unitId); else next.add(unitId); return next; });
  }, []);
  const exitMergeMode = React.useCallback(() => { setMergeMode(false); setMerging(false); setMergeSelection(new Set()); }, []);
  const mergeUnits = React.useMemo(() => draftUnits.filter((unit) => mergeSelection.has(unit.unitId)), [draftUnits, mergeSelection]);
  const selectedDraftId = parseDraftKey(selectedKey);
  const selectedDraftListItem = selectedDraftId !== null ? draftUnits.find((unit) => unit.unitId === selectedDraftId) ?? null : null;
  const [selectedDraftDetail, setSelectedDraftDetail] = React.useState<DraftPlanUnit | null>(null);
  const selectedDraft = selectedDraftDetail?.unitId === selectedDraftId ? selectedDraftDetail : null;
  // The key still names a draft but no unit matches it (deleted elsewhere, or a
  // stale/shared URL): show an explicit gone state rather than a silent empty
  // placeholder.
  const staleDraft = selectedDraftId !== null && selectedDraftListItem === null;
  const [detail, setDetail] = React.useState<Detail>(null);
  const [creating, setCreating] = React.useState(false);
  const [handoffs, setHandoffs] = React.useState<Record<string, OptimisticHandoffState>>({});
  const pendingHandoffSessions = React.useMemo(() => new Set(Object.values(handoffs).filter((entry) => entry.status === 'pending').map((entry) => entry.session)), [handoffs]);
  const visibleArtifacts = React.useMemo(() => artifacts.filter((artifact) => !artifact.session || !pendingHandoffSessions.has(artifact.session)), [artifacts, pendingHandoffSessions]);

  React.useEffect(() => {
    setHandoffs((current) => {
      let changed = false;
      const next = { ...current };
      for (const [id, entry] of Object.entries(current)) {
        if (entry.status !== 'pending') continue;
        const artifact = artifacts.find((candidate) => candidate.session === entry.session);
        if (!artifact || artifact.status === 'submitted') { delete next[id]; changed = true; }
      }
      return changed ? next : current;
    });
  }, [artifacts]);

  React.useEffect(() => {
    if (selectedDraftId === null || selectedDraftListItem === null) { setSelectedDraftDetail(null); return; }
    let active = true;
    void bridge.invokeAction<DraftUnitResponse>('get-draft-unit', { unitId: selectedDraftId })
      .then((response) => { if (active) setSelectedDraftDetail(response.unit); })
      .catch(() => { if (active) setSelectedDraftDetail(null); });
    return () => { active = false; };
  }, [selectedDraftId, selectedDraftListItem]);

  React.useEffect(() => {
    // Draft units render from in-memory state, not a detail fetch.
    if (!selectedKey || parseDraftKey(selectedKey) !== null) { setDetail(null); return; }
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

  const selectedArtifact = artifacts.find((entry) => entry.key === selectedKey) ?? null;

  const handoffPlan = React.useCallback(async (session: string) => {
    const artifact = artifacts.find((entry) => entry.session === session) ?? selectedArtifact;
    const id = artifact?.key ?? `plan:${session}`;
    const title = artifact ? artifactTitle(artifact) : planDisplayTitle(undefined, session);
    setHandoffs((current) => ({ ...current, [id]: { id, session, title, status: 'pending', message: 'Handoff is enqueueing in the background…' } }));
    if (selectedKey === id) {
      setDetail(null);
      selectPlan('');
    }
    let result: { kind?: string; command?: string; message?: string };
    try {
      result = await bridge.invokeAction<{ kind?: string; command?: string; message?: string }>('handoff-session-plan', { session });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setHandoffs((current) => ({ ...current, [id]: { id, session, title, status: 'failed', message: `${message || 'Handoff failed.'} Retry from the restored plan row or enqueue the session plan manually.` } }));
      toast.push(message, 'error');
      try { await onRefresh(); } catch (refreshError) { toast.push(refreshError instanceof Error ? refreshError.message : String(refreshError), 'error'); }
      return;
    }
    const failed = result.kind === 'not-ready' || result.kind === 'enqueue-failed';
    if (failed) {
      const message = result.message ?? result.command ?? 'Handoff failed. The plan remains ready; retry handoff or enqueue it manually.';
      setHandoffs((current) => ({ ...current, [id]: { id, session, title, status: 'failed', message } }));
      toast.push(message, 'error');
      try { await onRefresh(); } catch (refreshError) { toast.push(refreshError instanceof Error ? refreshError.message : String(refreshError), 'error'); }
      return;
    }
    toast.push(result.message ?? result.command ?? 'Handoff prepared.', 'success');
    try { await onRefresh(); } catch (refreshError) { toast.push(refreshError instanceof Error ? refreshError.message : String(refreshError), 'error'); }

  }, [artifacts, onRefresh, selectPlan, selectedArtifact, selectedKey, toast]);

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)_20rem] lg:items-start">
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
            {draftUnits.length > 0 && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Drafts</span>
                  {mergeableCount >= 2 && (
                    mergeMode
                      ? <button type="button" className="text-2xs text-muted-foreground hover:text-foreground" onClick={exitMergeMode}>Cancel</button>
                      : <button type="button" className="inline-flex items-center gap-0.5 text-2xs text-muted-foreground hover:text-foreground" onClick={() => setMergeMode(true)} title="Select draft units to merge"><GitMerge className="h-3 w-3" /> Merge</button>
                  )}
                </div>
                {draftUnits.map((unit) => {
                  const key = draftKey(unit.unitId);
                  const picked = mergeSelection.has(unit.unitId);
                  const pickable = mergeMode && unit.status === 'draft';
                  return (
                    <div
                      key={key}
                      className={`flex items-start gap-2 rounded-md border p-3 transition-colors hover:bg-accent ${selectedKey === key && !mergeMode ? 'border-primary bg-accent' : picked ? 'border-primary bg-primary/10' : 'border-border'}`}
                    >
                      {pickable && (
                        <Checkbox className="mt-1" checked={picked} aria-label={`Select ${unit.title} to merge`} onChange={() => toggleMergePick(unit.unitId)} />
                      )}
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => (pickable ? toggleMergePick(unit.unitId) : selectPlan(key))}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium text-text-bright">{unit.title}</span>
                          <Badge variant={unit.status === 'promoted' ? 'default' : 'outline'}>{unit.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{unit.itemCount} item{unit.itemCount === 1 ? '' : 's'}{unit.sourceRecommendationRef ? ` · ${unit.sourceRecommendationRef}` : ''}</p>
                      </button>
                    </div>
                  );
                })}
                {mergeMode && (
                  <Button size="sm" disabled={mergeSelection.size < 2} onClick={() => setMerging(true)} title={mergeSelection.size < 2 ? 'Select at least two draft units.' : 'Review and confirm the merge.'}>
                    <GitMerge className="h-4 w-4" /> Merge {mergeSelection.size || ''} selected
                  </Button>
                )}
                <span className="mt-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Plans</span>
              </>
            )}
            {visibleArtifacts.length === 0
              ? <EmptyState>No planning artifacts found.</EmptyState>
              : visibleArtifacts.map((artifact) => (
                <button
                  key={artifact.key}
                  onClick={() => selectPlan(artifact.key)}
                  className={`rounded-md border p-3 text-left transition-colors hover:bg-accent ${selectedKey === artifact.key ? 'border-primary bg-accent' : 'border-border'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-text-bright">{artifactTitle(artifact)}</span>
                    <Badge variant={artifact.ready ? 'default' : 'outline'}>{artifact.status ?? 'unknown'}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="text-xs text-muted-foreground">{artifact.kind === 'plan-set' ? `${artifact.childCount ?? 0} child plans` : artifact.session}</p>
                    <ArtifactBuildChip artifact={artifact} />
                    {artifact.lifecycleState === 'partial' && artifact.partialReasons?.[0] && <span className="text-2xs text-muted-foreground">{artifact.partialReasons[0].message}</span>}
                    <span className="text-2xs text-muted-foreground"><Timestamp value={selectPlanRecencyTimestamp(artifact)} prefix="Updated" /></span>
                  </div>
                </button>
              ))}
          </CardContent>
        </Card>
        <HandoffActivityCard handoffs={Object.values(handoffs)} />
      </aside>

      {isPlanDetail(detail) && detail.plan && !merging && !selectedDraft && !staleDraft ? (
        <PlanDetailWorkspace
          detail={{ ...detail, plan: detail.plan }}
          artifact={selectedArtifact}
          titles={titles}
          onApply={applyResult}
          onRefresh={onRefresh}
          onHandoff={handoffPlan}
          onDeleted={async () => {
            setDetail(null);
            selectPlan('');
            await onRefresh();
          }}
          onClose={() => { setDetail(null); selectPlan(''); }}
        />
      ) : (
        <section className="min-w-0 lg:col-span-2">
          {merging && mergeUnits.length >= 2
            ? <DraftMergePanel
                units={mergeUnits}
                onAdvise={onAdviseMergeDraftUnits}
                onMerge={onMergeDraftUnits}
                onClose={exitMergeMode}
                onOpenUnit={(key) => { exitMergeMode(); selectPlan(key); }}
              />
            : selectedDraft
            ? <DraftUnitDetailCard
                key={selectedDraft.unitId}
                unit={selectedDraft}
                titles={titles}
                onUpdate={onUpdateDraftUnit}
                onDelete={async (id) => { await onDeleteDraftUnit(id); selectPlan(''); }}
                onPromote={onPromoteDraftUnit}
                onSplit={onSplitDraftUnit}
                onAdviseSplit={onAdviseSplitDraftUnit}
                onOpenItem={nav.openItem}
                onOpenPlan={selectPlan}
              />
            : staleDraft
            ? <Card>
                <CardHeader>
                  <CardTitle>Draft not found</CardTitle>
                  <CardDescription>This draft plan unit no longer exists. It may have been deleted or promoted.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" size="sm" onClick={() => selectPlan('')}>Clear selection</Button>
                </CardContent>
              </Card>
            : detail
              ? <PlanSetDetailCard detail={detail as PlanSetDetail} />
              : <Card><CardHeader><CardTitle>Details</CardTitle><CardDescription>Select an artifact to inspect it.</CardDescription></CardHeader></Card>}
        </section>
      )}
    </div>
  );
}

function HandoffActivityCard({ handoffs }: { handoffs: OptimisticHandoffState[] }) {
  if (handoffs.length === 0) return null;
  return (
    <Card aria-label="Planning activity handoff status">
      <CardHeader>
        <CardTitle className="text-sm">Planning activity</CardTitle>
        <CardDescription>Recent plan handoff status.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-xs">
        {handoffs.map((entry) => (
          <div key={entry.id} className={`rounded border p-2 ${entry.status === 'failed' ? 'border-destructive/40 bg-destructive/10' : 'border-primary/30 bg-primary/10'}`}>
            <div className="flex items-center gap-2 font-medium text-text-bright">
              {entry.status === 'failed' && <AlertTriangle className="h-3.5 w-3.5 text-destructive-foreground" />}
              <span>{entry.title}</span>
              <ToneChip tone={entry.status === 'failed' ? 'danger' : 'progress'}>{entry.status === 'failed' ? 'handoff failed' : 'handoff pending'}</ToneChip>
            </div>
            <p className="mt-1 text-muted-foreground">{entry.message}</p>
            {entry.status === 'failed' && <p className="mt-1 text-muted-foreground">The plan row is restored. Retry Handoff after checking the message above, or enqueue the session plan manually.</p>}
          </div>
        ))}
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

// Build-lineage chip: a plan's own build status, derived from its lifecycle
// projection. This is a per-artifact reference to global build state - clicking
// into the plan shows the full evidence and links out to the run; the chip never
// mirrors the global queue here.
const BUILD_CHIP: Record<string, { label: string; tone: Tone }> = {
  queue: { label: 'Queued', tone: 'info' },
  queued: { label: 'Queued', tone: 'info' },
  build: { label: 'Building', tone: 'progress' },
  building: { label: 'Building', tone: 'progress' },
  active: { label: 'Building', tone: 'progress' },
  'pr-open': { label: 'PR open', tone: 'warn' },
  partial: { label: 'Partial', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
  merged: { label: 'Shipped', tone: 'done' },
  shipped: { label: 'Shipped', tone: 'done' },
  landed: { label: 'Shipped', tone: 'done' },
};

function ArtifactBuildChip({ artifact }: { artifact: Artifact }) {
  const state = (artifact.lifecycleState ?? '').toLowerCase();
  const chip = BUILD_CHIP[state];
  if (!chip) return null;
  return <ToneChip tone={chip.tone}>{chip.label}</ToneChip>;
}

function artifactTitle(artifact: Artifact) {
  if (artifact.kind === 'plan-set') return artifact.title || artifact.planSetId || artifact.key;
  return planDisplayTitle(artifact.title, artifact.session ?? artifact.key);
}
function isPlanDetail(detail: Detail): detail is PlanDetail { return Boolean(detail && 'plan' in detail); }
