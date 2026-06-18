import * as React from 'react';
import { FileText, Loader2, RefreshCw, Save, Undo2 } from 'lucide-react';
import { CollapsiblePanel } from '@/components/collapsible-panel';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { PlanningAgentTaskRecord, RecommendationFreshnessView, RecommendationStatus, RefreshRecommendationsResponse, RoadmapSourceProjection, RoadmapStateResponse, UpdateRoadmapStateRequest } from '@/types';
import { activeRefreshRunning, displayLabel, formatBytes, groupSources, localFocusEditState, refreshDisabledReason, sourceKindLabel, sourceStatusText, sourceSummary } from './roadmap-view-model';

export interface RoadmapPanelProps {
  state: RoadmapStateResponse | null;
  loading: boolean;
  recommendationStatus: RecommendationStatus | null;
  recommendationFreshness?: RecommendationFreshnessView | null;
  activeRecommendationRefreshTask: PlanningAgentTaskRecord | null;
  onSaveLocalFocus: (input: UpdateRoadmapStateRequest) => Promise<RoadmapStateResponse>;
  onRefreshRecommendations: () => Promise<RefreshRecommendationsResponse>;
  onReloadRoadmap: () => Promise<void>;
}

const DEFAULT_LOCAL_FOCUS_MAX_BYTES = 40_000;

export function RoadmapPanel({ state, loading, recommendationStatus, recommendationFreshness, activeRecommendationRefreshTask, onSaveLocalFocus, onRefreshRecommendations, onReloadRoadmap }: RoadmapPanelProps) {
  const toast = useToast();
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const saved = state?.context.localSteering.content ?? '';
  const maxBytes = state?.context.localSteering.maxContentBytes ?? DEFAULT_LOCAL_FOCUS_MAX_BYTES;
  const localContentTruncated = state?.context.localSteering.contentTruncated === true;
  const edit = localFocusEditState({ draft, saved, maxBytes }, saving);
  const summary = sourceSummary(state);
  const disabledReason = refreshDisabledReason({ dirty: edit.dirty, saving, refreshing, activeTask: activeRecommendationRefreshTask, status: recommendationStatus, freshness: recommendationFreshness });
  const recommendationState = recommendationFreshness?.state ?? recommendationStatus?.state;
  const refreshRunning = activeRefreshRunning(activeRecommendationRefreshTask);

  React.useEffect(() => setDraft(saved), [saved]);

  async function save() {
    if (!state || !edit.canSave || localContentTruncated) return;
    setSaving(true);
    try {
      const input: UpdateRoadmapStateRequest = {
        localFocusContent: draft,
        ...(state.context.localSteering.sha256 ? { expectedLocalFocusSha256: state.context.localSteering.sha256 } : {}),
      };
      await onSaveLocalFocus(input);
      toast.push('Saved local focus roadmap.', 'success');
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    } finally {
      setSaving(false);
    }
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

  return (
    <CollapsiblePanel
      storageKey="eforge-plan:panel:roadmap"
      className="mb-4 border-primary/20 bg-primary/5"
      icon={<FileText className="h-4 w-4 text-primary" />}
      title="Roadmap workstation"
      summary={(
        <>
          <Chip>{summary.local} local</Chip>
          <Chip>{summary.configuredShared} configured shared</Chip>
          <Chip>{summary.discovered} discovered</Chip>
          {summary.conflicts > 0 && <Chip tone="warn">{summary.conflicts} conflicts</Chip>}
          {recommendationState && <Chip tone={recommendationState === 'fresh' ? 'good' : 'warn'}>recommendations {recommendationState}</Chip>}
          {refreshRunning && <Chip tone="good"><Loader2 className="h-3 w-3 animate-spin" /> refreshing</Chip>}
        </>
      )}
      actions={<Button size="sm" variant="outline" disabled={loading} onClick={() => void onReloadRoadmap()}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Reload roadmap</Button>}
    >
      {!state ? <p className="text-sm text-muted-foreground">Roadmap state has not loaded yet.</p> : (
        <div className="grid gap-4">
          <section className="grid gap-2 rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-text-bright">Local focus</h4>
                <p className="text-xs text-muted-foreground">Private editable roadmap stored at <code>{state.storagePaths.localFocus}</code>.</p>
              </div>
              <div className={`text-xs ${edit.overLimit ? 'text-destructive-foreground' : 'text-muted-foreground'}`}>{formatBytes(edit.bytes)} / {formatBytes(edit.maxBytes)}</div>
            </div>
            <Textarea aria-label="Local focus roadmap" value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-40 font-mono text-xs" />
            {edit.overLimit && <p className="text-xs text-destructive-foreground">Local focus exceeds the configured byte limit. Shorten it before saving.</p>}
            {localContentTruncated && <p className="text-xs text-destructive-foreground">Local focus content was truncated by the backend. Saving is disabled to avoid overwriting unsent content.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!edit.canSave || localContentTruncated} onClick={() => void save()}><Save className="h-4 w-4" /> Save local focus</Button>
              <Button size="sm" variant="outline" disabled={!edit.dirty || saving} onClick={() => setDraft(saved)}><Undo2 className="h-4 w-4" /> Reset</Button>
              <Button size="sm" variant="outline" disabled={Boolean(disabledReason)} title={disabledReason ?? 'Refresh recommendations from saved roadmap state.'} onClick={() => void refreshRecommendations()}>
                {refreshing || refreshRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh recommendations from roadmap
              </Button>
              {disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
            </div>
            {refreshRunning && activeRecommendationRefreshTask && <p className="text-xs text-muted-foreground">{activeRecommendationRefreshTask.metadata?.progressMessage ?? 'Refreshing recommendations…'} <span title={activeRecommendationRefreshTask.taskId}>({activeRecommendationRefreshTask.taskId})</span></p>}
          </section>

          <section className="grid gap-3 lg:grid-cols-3">
            {groupSources(state).map((group) => (
              <div key={group.key} className="rounded-md border border-border bg-card p-3">
                <h4 className="mb-2 text-sm font-semibold text-text-bright">{group.title}</h4>
                <div className="grid gap-2">
                  {group.sources.map((source) => <SourceRow key={`${source.kind}:${source.path}:${source.id ?? ''}`} source={source} />)}
                </div>
              </div>
            ))}
          </section>

          {(state.context.assumptions.length > 0 || state.context.conflicts.length > 0 || state.context.truncation.sourceContent > 0 || state.context.truncation.sourceExcerpts > 0) && (
            <section className="grid gap-3 rounded-md border border-border bg-card p-3 text-xs">
              {state.context.assumptions.length > 0 && <MetadataList title="Assumptions" items={state.context.assumptions} />}
              {state.context.conflicts.length > 0 && <MetadataList title="Conflicts" items={state.context.conflicts.map((conflict) => `${conflict.message}${conflict.path ? ` (${conflict.path})` : ''}`)} tone="warn" />}
              {(state.context.truncation.sourceContent > 0 || state.context.truncation.sourceExcerpts > 0) && (
                <p className="text-muted-foreground">Truncation: {state.context.truncation.sourceContent} source content fields and {state.context.truncation.sourceExcerpts} source excerpts were truncated.</p>
              )}
            </section>
          )}
        </div>
      )}
    </CollapsiblePanel>
  );
}

function SourceRow({ source }: { source: RoadmapSourceProjection }) {
  return (
    <article className="rounded border border-border bg-background/40 p-2 text-xs">
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
        <Meta label="sha256" value={source.sha256} />
        <Meta label="updated" value={source.updatedAt} />
        <Meta label="error" value={source.readError} />
      </dl>
      {source.headings.length > 0 && <p className="mt-1 text-muted-foreground">Headings: {source.headings.join(' · ')}</p>}
      {source.excerpts.length > 0 && <ul className="mt-1 list-disc pl-4 text-muted-foreground">{source.excerpts.map((excerpt, index) => <li key={index}>{excerpt}</li>)}</ul>}
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

const CHIP_TONE: Record<string, string> = {
  default: 'border-border bg-background/60 text-muted-foreground',
  good: 'border-[color:var(--lane-ready)]/40 bg-[color:var(--lane-ready)]/10 text-[color:var(--lane-ready)]',
  warn: 'border-[color:var(--prio-medium)]/40 bg-[color:var(--prio-medium)]/10 text-[color:var(--prio-medium)]',
};

function Chip({ children, tone = 'default' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs ${CHIP_TONE[tone] ?? CHIP_TONE.default}`}>{children}</span>;
}
