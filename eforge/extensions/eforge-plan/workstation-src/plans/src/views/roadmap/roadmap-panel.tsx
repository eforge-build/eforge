import * as React from 'react';
import { FileText, Pencil, RefreshCw, Save, Undo2 } from 'lucide-react';
import { SafeMarkdown } from '@/components/safe-markdown';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RailCard } from '@/components/ui/rail-card';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ToneChip } from '@/components/ui/tone-chip';
import type { Tone } from '@/lib/tone';
import type { PlanningAgentTaskRecord, RecommendationFreshnessView, RecommendationStatus, RefreshRecommendationsResponse, RoadmapSourceProjection, RoadmapStateResponse, UpdateRoadmapStateRequest } from '@/types';
import { activeRefreshRunning, displayLabel, formatBytes, groupSources, localFocusEditState, refreshDisabledReason, sourceKindLabel, sourceStatusText, sourceSummary } from './roadmap-view-model';

const DEFAULT_LOCAL_FOCUS_MAX_BYTES = 40_000;

export interface RoadmapFocusProps {
  state: RoadmapStateResponse | null;
  recommendationStatus: RecommendationStatus | null;
  recommendationFreshness?: RecommendationFreshnessView | null;
  activeRecommendationRefreshTask: PlanningAgentTaskRecord | null;
  onSaveLocalFocus: (input: UpdateRoadmapStateRequest) => Promise<RoadmapStateResponse>;
  onRefreshRecommendations: () => Promise<RefreshRecommendationsResponse>;
}

/**
 * Roadmap focus: the editable local-focus steering doc as the focal work. This
 * is the roadmap the recommendation engine reads to rank the backlog; its source
 * provenance and discovered context live in the focus's context rail
 * (`RoadmapContextRail`), keeping this pane to the thing you actually edit.
 */
export function RoadmapFocus({ state, recommendationStatus, recommendationFreshness, activeRecommendationRefreshTask, onSaveLocalFocus, onRefreshRecommendations }: RoadmapFocusProps) {
  const toast = useToast();
  const [draft, setDraft] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const saved = state?.context.localSteering.content ?? '';
  const editable = state?.context.localSteering.editable === true;
  const maxBytes = state?.context.localSteering.maxContentBytes ?? DEFAULT_LOCAL_FOCUS_MAX_BYTES;
  const localContentTruncated = state?.context.localSteering.contentTruncated === true;
  const edit = localFocusEditState({ draft, saved, maxBytes }, saving);
  const disabledReason = refreshDisabledReason({ dirty: edit.dirty, saving, refreshing, activeTask: activeRecommendationRefreshTask, status: recommendationStatus, freshness: recommendationFreshness });
  const refreshRunning = activeRefreshRunning(activeRecommendationRefreshTask);

  React.useEffect(() => { if (!editing) setDraft(saved); }, [editing, saved]);
  React.useEffect(() => {
    if (editable) return;
    setEditing(false);
    setConfirmCancel(false);
    setDraft(saved);
  }, [editable, saved]);

  async function save() {
    if (!state || !editable || !edit.canSave || localContentTruncated) return;
    setSaving(true);
    try {
      const input: UpdateRoadmapStateRequest = {
        localFocusContent: draft,
        ...(state.context.localSteering.sha256 ? { expectedLocalFocusSha256: state.context.localSteering.sha256 } : {}),
      };
      await onSaveLocalFocus(input);
      setEditing(false);
      setConfirmCancel(false);
      toast.push('Saved local focus roadmap.', 'success');
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    if (edit.dirty && !confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    setDraft(saved);
    setEditing(false);
    setConfirmCancel(false);
  }

  async function refreshRecommendations() {
    if (disabledReason) return;
    setRefreshing(true);
    try {
      const response = await onRefreshRecommendations();
      toast.push(`${response.reused ? 'Reusing' : 'Started'} recommendation refresh ${response.task.taskId}.`, 'success');
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    } finally {
      setRefreshing(false);
    }
  }

  if (!state) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Roadmap state has not loaded yet.</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Local focus roadmap</CardTitle>
          <CardDescription>Private editable steering doc at <code>{state.storagePaths.localFocus}</code>. The recommendation engine reads this to rank your backlog.</CardDescription>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
          <span className={edit.overLimit ? 'text-destructive-foreground' : 'text-muted-foreground'}>{formatBytes(edit.bytes)} / {formatBytes(edit.maxBytes)}</span>
          <div className="flex flex-wrap justify-end gap-1">
            {recommendationFreshness?.state && <Chip tone={recommendationFreshness.state === 'fresh' ? 'good' : 'warn'}>recommendations {recommendationFreshness.state}</Chip>}
            {localContentTruncated && <Chip tone="warn">truncated</Chip>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {editing && editable ? (
          <>
            <Textarea aria-label="Local focus roadmap" value={draft} onChange={(event) => { setDraft(event.target.value); setConfirmCancel(false); }} className="min-h-[24rem] font-mono text-xs" />
            {edit.overLimit && <p className="text-xs text-destructive-foreground">Local focus exceeds the configured byte limit. Shorten it before saving.</p>}
            {localContentTruncated && <p className="text-xs text-destructive-foreground">Local focus content was truncated by the backend. Saving is disabled to avoid overwriting unsent content.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!edit.canSave || localContentTruncated} onClick={() => void save()}><Save className="h-4 w-4" /> Save local focus</Button>
              <Button size="sm" variant="outline" disabled={!edit.dirty || saving} onClick={() => { setDraft(saved); setConfirmCancel(false); }}><Undo2 className="h-4 w-4" /> Reset</Button>
              <Button size="sm" variant={confirmCancel ? 'destructive' : 'outline'} disabled={saving} onClick={cancelEdit}>{confirmCancel ? 'Discard edits' : 'Cancel'}</Button>
              {confirmCancel && <span className="text-xs text-muted-foreground">Click Discard edits to leave edit mode without saving.</span>}
            </div>
          </>
        ) : (
          <div className="grid gap-3">
            <div className="rounded border border-border bg-background/40 p-3">
              {saved.trim() ? <SafeMarkdown markdown={saved} /> : <p className="text-sm text-muted-foreground">Local focus roadmap is empty.</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Source: <code>{state.storagePaths.localFocus}</code></span>
              {recommendationFreshness?.reason && <span>{recommendationFreshness.reason}</span>}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!editing && editable && <Button size="sm" variant="outline" onClick={() => { setDraft(saved); setEditing(true); }}><Pencil className="h-4 w-4" /> Edit</Button>}
          <Button size="sm" variant="outline" disabled={Boolean(disabledReason)} title={disabledReason ?? 'Refresh recommendations from saved roadmap state.'} onClick={() => void refreshRecommendations()}>
            {refreshing || refreshRunning ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh recommendations from roadmap
          </Button>
          {disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
        </div>
        {refreshRunning && activeRecommendationRefreshTask && <p className="text-xs text-muted-foreground">{activeRecommendationRefreshTask.metadata?.progressMessage ?? 'Refreshing recommendations…'} <span title={activeRecommendationRefreshTask.taskId}>({activeRecommendationRefreshTask.taskId})</span></p>}
      </CardContent>
    </Card>
  );
}

export interface RoadmapContextRailProps {
  state: RoadmapStateResponse | null;
  loading: boolean;
  recommendationStatus: RecommendationStatus | null;
  recommendationFreshness?: RecommendationFreshnessView | null;
  activeRecommendationRefreshTask: PlanningAgentTaskRecord | null;
  onReloadRoadmap: () => Promise<void>;
}

/**
 * Context rail for the Roadmap focus: where the roadmap's content comes from
 * (local, configured shared, and discovered sources) plus the assumptions and
 * conflicts the projection recorded. Read-only provenance; the editing lives in
 * `RoadmapFocus`.
 */
export function RoadmapContextRail({ state, loading, recommendationStatus, recommendationFreshness, activeRecommendationRefreshTask, onReloadRoadmap }: RoadmapContextRailProps) {
  const summary = sourceSummary(state);
  const recommendationState = recommendationFreshness?.state ?? recommendationStatus?.state;
  const refreshRunning = activeRefreshRunning(activeRecommendationRefreshTask);

  return (
    <RailCard
      icon={FileText}
      iconClassName="text-primary"
      title="Roadmap sources"
      action={
        <Button size="xs" variant="outline" className="ml-auto" disabled={loading} onClick={() => void onReloadRoadmap()}>
          {loading ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />} Reload
        </Button>
      }
      headerExtra={
        <div className="mt-2 flex flex-wrap gap-1">
          <Chip>{summary.local} local</Chip>
          <Chip>{summary.configuredShared} configured shared</Chip>
          <Chip>{summary.discovered} discovered</Chip>
          {summary.conflicts > 0 && <Chip tone="warn">{summary.conflicts} conflicts</Chip>}
          {recommendationState && <Chip tone={recommendationState === 'fresh' ? 'good' : 'warn'}>recommendations {recommendationState}</Chip>}
          {refreshRunning && <Chip tone="good"><Spinner className="h-3 w-3" /> refreshing</Chip>}
        </div>
      }
      contentClassName="grid gap-3"
    >
        {!state ? <p className="text-xs text-muted-foreground">Roadmap state has not loaded yet.</p> : (
          <>
            <section className="grid gap-3">
              {groupSources(state).map((group) => (
                <div key={group.key}>
                  <h4 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h4>
                  <div className="grid gap-2">
                    {group.sources.map((source) => <SourceRow key={`${source.kind}:${source.path}:${source.id ?? ''}`} source={source} />)}
                  </div>
                </div>
              ))}
            </section>

            {(state.context.assumptions.length > 0 || state.context.conflicts.length > 0 || state.context.truncation.sourceContent > 0 || state.context.truncation.sourceExcerpts > 0) && (
              <section className="grid gap-3 border-t border-border pt-3 text-xs">
                {state.context.assumptions.length > 0 && <MetadataList title="Assumptions" items={state.context.assumptions} />}
                {state.context.conflicts.length > 0 && <MetadataList title="Conflicts" items={state.context.conflicts.map((conflict) => `${conflict.message}${conflict.path ? ` (${conflict.path})` : ''}`)} tone="warn" />}
                {(state.context.truncation.sourceContent > 0 || state.context.truncation.sourceExcerpts > 0) && (
                  <p className="text-muted-foreground">Truncation: {state.context.truncation.sourceContent} source content fields and {state.context.truncation.sourceExcerpts} source excerpts were truncated.</p>
                )}
              </section>
            )}
          </>
        )}
    </RailCard>
  );
}

function SourceRow({ source }: { source: RoadmapSourceProjection }) {
  return (
    <article className="rounded border border-border bg-background/40 p-2 text-2xs">
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-semibold text-text-bright">{displayLabel(source)}</span>
        <Chip tone={source.exists && !source.readError ? 'good' : 'warn'}>{sourceStatusText(source)}</Chip>
        <Chip>{source.editable ? 'editable' : 'read-only'}</Chip>
        <Chip>{source.configured ? 'configured' : 'discovered'}</Chip>
      </div>
      <p className="mt-1 break-all text-muted-foreground">{source.path}</p>
      <dl className="mt-1 grid gap-1 text-muted-foreground">
        <Meta label="kind" value={sourceKindLabel(source.kind)} />
        <Meta label="role" value={source.role} />
        <Meta label="updated" value={source.updatedAt} />
        <Meta label="error" value={source.readError} />
      </dl>
      {source.headings.length > 0 && <p className="mt-1 text-muted-foreground">Headings: {source.headings.join(' · ')}</p>}
      {source.content?.trim() ? (
        <div className="mt-2 rounded border border-border bg-card/50 p-2 text-xs">
          <SafeMarkdown markdown={source.content} />
        </div>
      ) : source.excerpts.length > 0 ? <ul className="mt-1 list-disc pl-4 text-muted-foreground">{source.excerpts.map((excerpt, index) => <li key={index}>{excerpt}</li>)}</ul> : null}
    </article>
  );
}

function Meta({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return <div><dt className="inline font-medium text-foreground">{label}: </dt><dd className="inline break-all">{value}</dd></div>;
}

function MetadataList({ title, items, tone }: { title: string; items: string[]; tone?: 'warn' }) {
  return <div><h4 className={`mb-1 text-2xs font-semibold uppercase tracking-wide ${tone === 'warn' ? 'text-[color:var(--prio-medium)]' : 'text-muted-foreground'}`}>{title}</h4><ul className="list-disc pl-4 text-muted-foreground">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

const CHIP_TONE: Record<string, Tone> = { default: 'neutral', good: 'info', warn: 'warn' };

function Chip({ children, tone = 'default' }: { children: React.ReactNode; tone?: string }) {
  return <ToneChip tone={CHIP_TONE[tone] ?? 'neutral'} className="font-normal">{children}</ToneChip>;
}
