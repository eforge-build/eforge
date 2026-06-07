import * as React from 'react';
import { ArrowRight, CheckCircle2, ClipboardList, GitBranch, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { getBridge } from '@/bridge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { Artifact, Board, BoardItem, Detail, PlanDetail, PlanSetDetail, RecommendationModel, WorkstationData } from '@/types';

const bridge = getBridge();
const emptyBoard: Board = { lanes: [], items: [], epics: [] };

export function App() {
  const [data, setData] = React.useState<WorkstationData>({ artifacts: [], board: emptyBoard, recommendations: null });
  const [detail, setDetail] = React.useState<Detail>(null);
  const [selectedKey, setSelectedKey] = React.useState('');
  const [selectedItems, setSelectedItems] = React.useState<Set<string>>(new Set());
  const [status, setStatus] = React.useState('Ready.');
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setStatus('Loading planning workspace…');
    try {
      const artifacts = await bridge.invokeAction<{ artifacts?: Artifact[]; board?: Board }>('list-planning-artifacts', {});
      const recommendations = await bridge.invokeAction<{ recommendations?: RecommendationModel | null }>('get-recommendations', {});
      setData({ artifacts: artifacts.artifacts ?? [], board: artifacts.board ?? emptyBoard, recommendations: recommendations.recommendations ?? null });
      setStatus('Workspace loaded.');
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  async function selectArtifact(artifact: Artifact) {
    setSelectedKey(artifact.key);
    setStatus(`Loading ${artifactTitle(artifact)}…`);
    const loaded = artifact.kind === 'plan-set'
      ? await bridge.invokeAction<PlanSetDetail>('show-session-plan-set', { planSetId: artifact.planSetId ?? '' })
      : await bridge.invokeAction<PlanDetail>('show-session-plan', { session: artifact.session ?? '' });
    setDetail(loaded);
    setStatus(`${artifactTitle(artifact)} loaded.`);
  }

  async function promoteSelection(selection: Record<string, unknown>) {
    const result = await bridge.invokeAction<{ session?: string; sessionPlanPath?: string }>('promote-selection', { status: 'active', ...selection });
    setStatus(`Promoted to ${result.sessionPlanPath ?? result.session ?? 'a session plan'}.`);
    await refresh();
  }

  async function selectedPlanAction(actionId: string) {
    const plan = isPlanDetail(detail) ? detail.plan : undefined;
    if (!plan) return setStatus('Select a flat session plan first.');
    if (actionId === 'handoff-session-plan' && !window.confirm(`Hand off ${plan.session} as a build source path?`)) return;
    const result = await bridge.invokeAction<{ message?: string; command?: string; plan?: unknown; readiness?: unknown }>(actionId, { session: plan.session });
    setStatus(result.command ?? result.message ?? `${actionId} complete.`);
    await refresh();
  }

  return <div className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-10 border-b bg-background/95 px-5 py-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-text-bright"><Sparkles className="h-5 w-5 text-primary" /> eforge-plan</div>
          <p className="text-sm text-muted-foreground">Plan from backlog, recommendations, and session artifacts without leaving the workstation.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{bridge.version ? `bridge v${bridge.version}` : 'mock bridge'}</Badge>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh</Button>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{status}</p>
    </header>

    <main className="grid gap-4 p-4 xl:grid-cols-[22rem_minmax(0,1fr)_24rem]">
      <LeftRail artifacts={data.artifacts} selectedKey={selectedKey} onSelect={(artifact) => void selectArtifact(artifact)} onCreated={refresh} setStatus={setStatus} />
      <section className="grid min-w-0 gap-4">
        <RecommendationPanel recommendations={data.recommendations} epics={data.board.epics ?? []} onPromote={promoteSelection} />
        <BoardPanel board={data.board} selectedItems={selectedItems} onSelectedItemsChange={setSelectedItems} onPromoteItems={(itemIds) => promoteSelection({ itemIds })} />
      </section>
      <RightRail detail={detail} selectedItems={selectedItems} onPlanAction={(action) => void selectedPlanAction(action)} onPreparePlanner={() => preparePlanner(selectedItems, setStatus)} />
    </main>
  </div>;
}

function LeftRail({ artifacts, selectedKey, onSelect, onCreated, setStatus }: { artifacts: Artifact[]; selectedKey: string; onSelect: (artifact: Artifact) => void; onCreated: () => Promise<void>; setStatus: (value: string) => void }) {
  return <aside className="grid content-start gap-4">
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Artifacts</CardTitle><CardDescription>Session plans and plan sets.</CardDescription></CardHeader>
      <CardContent className="grid gap-2">
        {artifacts.length === 0 ? <Empty text="No planning artifacts found." /> : artifacts.map((artifact) => <button key={artifact.key} onClick={() => onSelect(artifact)} className={`rounded-md border p-3 text-left transition-colors hover:bg-accent ${selectedKey === artifact.key ? 'border-primary bg-accent' : 'border-border'}`}>
          <div className="flex items-center justify-between gap-2"><span className="font-medium text-text-bright">{artifactTitle(artifact)}</span><Badge variant={artifact.ready ? 'default' : 'outline'}>{artifact.status ?? 'unknown'}</Badge></div>
          <p className="mt-1 text-xs text-muted-foreground">{artifact.kind === 'plan-set' ? `${artifact.childCount ?? 0} child plans` : artifact.session}</p>
        </button>)}
      </CardContent>
    </Card>
    <CreatePlanCard onCreated={onCreated} setStatus={setStatus} />
  </aside>;
}

function RecommendationPanel({ recommendations, epics, onPromote }: { recommendations: RecommendationModel | null; epics: { id: string; title?: string }[]; onPromote: (selection: Record<string, unknown>) => Promise<void> }) {
  const next = recommendations?.recommendedNextSequence ?? [];
  const groups = recommendations?.safeParallelizableGroups ?? [];
  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Recommendations</CardTitle><CardDescription>Private extension recommendations and quick promotion paths.</CardDescription></CardHeader>
    <CardContent className="grid gap-4 lg:grid-cols-3">
      <MiniList title="Next work" empty="No recommended next work." items={next.map((entry) => ({ key: entry.ref ?? entry.itemId, title: entry.itemId, meta: entry.rationale, action: () => onPromote(entry.ref ? { recommendationRef: entry.ref } : { itemIds: [entry.itemId] }) }))} />
      <MiniList title="Groups" empty="No recommended groups." items={groups.map((group) => ({ key: group.ref, title: group.title ?? group.ref, meta: group.itemIds.join(', '), action: () => onPromote({ recommendationRef: group.ref }) }))} />
      <MiniList title="Epics" empty="No epics." items={epics.map((epic) => ({ key: epic.id, title: epic.title ?? epic.id, meta: epic.id, action: () => onPromote({ epicId: epic.id }) }))} />
    </CardContent>
  </Card>;
}

function BoardPanel({ board, selectedItems, onSelectedItemsChange, onPromoteItems }: { board: Board; selectedItems: Set<string>; onSelectedItemsChange: (items: Set<string>) => void; onPromoteItems: (itemIds: string[]) => Promise<void> }) {
  const selected = Array.from(selectedItems);
  function toggle(item: BoardItem) {
    const next = new Set(selectedItems);
    if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
    onSelectedItemsChange(next);
  }
  return <Card>
    <CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><GitBranch className="h-4 w-4" /> Backlog board</CardTitle><CardDescription>Select one or more backlog items, then promote them as one plan.</CardDescription></div><Button size="sm" disabled={selected.length === 0} onClick={() => void onPromoteItems(selected)}>Promote {selected.length || ''} selected</Button></CardHeader>
    <CardContent className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {(board.lanes ?? []).map((lane) => <div key={lane.lane} className="rounded-lg border bg-background/50 p-3"><div className="mb-3 flex items-center justify-between"><h3 className="font-medium text-text-bright">{lane.title}</h3><Badge variant="outline">{lane.items.length}</Badge></div><div className="grid gap-2">{lane.items.length === 0 ? <Empty text="No items." /> : lane.items.map((item) => <button key={item.id} onClick={() => toggle(item)} className={`rounded-md border p-3 text-left hover:bg-accent ${selectedItems.has(item.id) ? 'border-primary bg-accent' : 'border-border'}`}><div className="flex items-center justify-between gap-2"><strong>{item.id}</strong><Badge variant="secondary">{item.status}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{item.title}</p></button>)}</div></div>)}
    </CardContent>
  </Card>;
}

function RightRail({ detail, selectedItems, onPlanAction, onPreparePlanner }: { detail: Detail; selectedItems: Set<string>; onPlanAction: (action: string) => void; onPreparePlanner: () => void }) {
  return <aside className="grid content-start gap-4">
    <Card><CardHeader><CardTitle>Planner actions</CardTitle><CardDescription>{selectedItems.size} backlog items selected.</CardDescription></CardHeader><CardContent className="grid gap-2"><Button variant="outline" onClick={onPreparePlanner}>Prepare planner context</Button><Button variant="outline" onClick={() => onPlanAction('check-session-plan-readiness')}>Check readiness</Button><Button onClick={() => onPlanAction('set-session-plan-ready')}><CheckCircle2 className="h-4 w-4" /> Set ready</Button><Button variant="secondary" onClick={() => onPlanAction('handoff-session-plan')}>Handoff source path <ArrowRight className="h-4 w-4" /></Button></CardContent></Card>
    <DetailCard detail={detail} />
  </aside>;
}

function DetailCard({ detail }: { detail: Detail }) {
  if (!detail) return <Card><CardHeader><CardTitle>Details</CardTitle><CardDescription>Select an artifact to inspect it.</CardDescription></CardHeader></Card>;
  if (isPlanDetail(detail) && detail.plan) return <Card><CardHeader><CardTitle>{detail.plan.topic}</CardTitle><CardDescription>{detail.plan.session}</CardDescription></CardHeader><CardContent className="grid gap-3 text-sm"><div className="flex flex-wrap gap-2"><Badge>{detail.plan.status}</Badge><Badge variant="outline">{detail.readiness?.ready ? 'ready' : 'not ready'}</Badge><Badge variant="secondary">{detail.plan.profile ?? 'no profile'}</Badge></div><p className="text-muted-foreground">Missing: {(detail.readiness?.missingDimensions ?? []).join(', ') || 'none'}</p><pre className="max-h-96 overflow-auto rounded-md border bg-background p-3 text-xs">{detail.plan.body ?? ''}</pre></CardContent></Card>;
  const planSet = (detail as PlanSetDetail).planSet;
  return <Card><CardHeader><CardTitle>{planSet?.title ?? planSet?.id ?? 'Plan set'}</CardTitle><CardDescription>{(detail as PlanSetDetail).manifestPath}</CardDescription></CardHeader><CardContent><ul className="grid gap-2 text-sm">{(planSet?.children ?? []).map((child) => <li key={child.id} className="rounded-md border p-2"><strong>{child.id}</strong> · {child.status}</li>)}</ul></CardContent></Card>;
}

function CreatePlanCard({ onCreated, setStatus }: { onCreated: () => Promise<void>; setStatus: (value: string) => void }) {
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const session = String(form.get('session') ?? '').trim();
    const topic = String(form.get('topic') ?? '').trim();
    if (!session || !topic) return setStatus('Session and topic are required.');
    await bridge.invokeAction('create-session-plan', {
      session,
      topic,
      planningType: String(form.get('planningType') ?? 'feature'),
      planningDepth: String(form.get('planningDepth') ?? 'focused'),
    });
    setStatus(`Created ${session}.`);
    await onCreated();
  }
  return <Card><CardHeader><CardTitle>Create plan</CardTitle><CardDescription>Create a normal `.eforge/session-plans` artifact.</CardDescription></CardHeader><CardContent><form className="grid gap-2" onSubmit={(event) => void submit(event)}><Input name="session" placeholder="session-id" required /><Input name="topic" placeholder="Topic" required /><Select name="planningType" defaultValue="feature"><option value="feature">feature</option><option value="bugfix">bugfix</option><option value="architecture">architecture</option></Select><Select name="planningDepth" defaultValue="focused"><option value="quick">quick</option><option value="focused">focused</option><option value="deep">deep</option></Select><Button type="submit" variant="secondary">Create session plan</Button></form></CardContent></Card>;
}

function MiniList({ title, empty, items }: { title: string; empty: string; items: { key: string; title: string; meta?: string; action: () => Promise<void> }[] }) {
  return <section><h3 className="mb-2 font-medium text-text-bright">{title}</h3><div className="grid gap-2">{items.length === 0 ? <Empty text={empty} /> : items.map((item) => <button key={item.key} onClick={() => void item.action()} className="rounded-md border p-3 text-left hover:bg-accent"><strong>{item.title}</strong>{item.meta && <p className="mt-1 text-xs text-muted-foreground">{item.meta}</p>}</button>)}</div></section>;
}

function Empty({ text }: { text: string }) { return <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{text}</p>; }
function artifactTitle(artifact: Artifact) { return artifact.title || artifact.session || artifact.planSetId || artifact.key; }
function isPlanDetail(detail: Detail): detail is PlanDetail { return Boolean(detail && 'plan' in detail); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function preparePlanner(selectedItems: Set<string>, setStatus: (value: string) => void) {
  const itemIds = Array.from(selectedItems);
  const result = await bridge.invokeAction<{ items?: unknown[]; epics?: unknown[] }>('prepare-planner-context', itemIds.length ? { itemIds, includeRoadmap: true } : { includeRoadmap: true });
  setStatus(`Planner context ready: ${result.items?.length ?? 0} items, ${result.epics?.length ?? 0} epics.`);
}
