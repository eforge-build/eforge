import * as React from 'react';
import type { BacklogCurationFullAuditPreview } from '@/types';
import { evidenceSourceLabel, formatFullAuditCaps, formatFullAuditCoverage, formatFullAuditSettings, FULL_AUDIT_WARNING } from './backlog-curation-view-model';
import { SubBlock } from './sub-block';

export function BacklogCurationFullAuditPanel({ audit }: { audit?: BacklogCurationFullAuditPreview }) {
  if (!audit) return null;
  const coverage = formatFullAuditCoverage(audit);
  const caps = formatFullAuditCaps(audit);
  const settings = formatFullAuditSettings(audit);
  const diagnostics = [...(audit.diagnostics ?? [])].sort((left, right) => severityRank(left.severity) - severityRank(right.severity) || left.code.localeCompare(right.code));
  const itemSummaries = [...(audit.itemSummaries ?? [])].sort((left, right) => left.itemId.localeCompare(right.itemId));

  return (
    <SubBlock title="Source-first audit metadata" className="gap-2">
      <p className="rounded border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-100">{FULL_AUDIT_WARNING}</p>
      {audit.scope && <p className="text-xs text-muted-foreground">Scope: {audit.scope.openItemCount ?? audit.scope.itemIds.length} open item{(audit.scope.openItemCount ?? audit.scope.itemIds.length) === 1 ? '' : 's'}{audit.scope.itemIds.length > 0 ? ` · ${audit.scope.itemIds.join(', ')}` : ''}</p>}
      {coverage.length > 0 && <Rows title="Coverage" rows={coverage} />}
      {settings.length > 0 && <Rows title="Concurrency and authority" rows={settings} />}
      {caps.length > 0 && <Rows title="Caps" rows={caps} />}
      {diagnostics.length > 0 && (
        <div className="grid gap-1 text-xs">
          <p className="font-medium text-foreground">Diagnostics</p>
          <ul className="grid gap-1 text-muted-foreground">
            {diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.severity}:${diagnostic.code}:${diagnostic.path ?? ''}:${diagnostic.message ?? ''}`}>
                <span className={diagnostic.severity === 'warning' ? 'text-[color:var(--prio-medium)]' : 'text-foreground'}>{diagnostic.severity}</span> <span className="font-mono">{diagnostic.code}</span>{diagnostic.message ? `: ${diagnostic.message}` : ''}{diagnostic.path ? ` · ${diagnostic.path}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {itemSummaries.length > 0 && (
        <details className="rounded border border-border p-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">{itemSummaries.length} audited item summaries</summary>
          <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
            {itemSummaries.map((item) => (
              <div key={item.itemId} className="grid gap-1 rounded border border-border p-2">
                <p><span className="font-mono text-foreground">{item.itemId}</span> · {item.candidateIntent}{item.sourceFirstResult?.intent ? ` · source-first ${item.sourceFirstResult.intent}` : ''}{item.confidence ? ` · confidence ${item.confidence}` : ''}{item.evidenceCount !== undefined ? ` · ${item.evidenceCount} evidence` : ''}</p>
                {item.sourceFirstResult?.rationale && <p>{item.sourceFirstResult.rationale}</p>}
                <CitationList title="Current-source citations" citations={item.sourceFirstResult?.citations ?? item.closureCandidates?.flatMap((candidate) => candidate.citations ?? []) ?? []} />
                <HistoricalHints hints={item.historicalHints ?? item.sourceFirstResult?.historicalHints ?? []} />
                {item.sourceFirstResult?.diagnostics && item.sourceFirstResult.diagnostics.length > 0 && <ul>{item.sourceFirstResult.diagnostics.map((diagnostic) => <li key={`${diagnostic.code}:${diagnostic.path ?? ''}`}>diagnostic {diagnostic.severity} · {diagnostic.code}{diagnostic.path ? ` · ${diagnostic.path}` : ''}</li>)}</ul>}
              </div>
            ))}
          </div>
        </details>
      )}
    </SubBlock>
  );
}

export function FullAuditEvidenceChips({ evidence }: { evidence: Array<{ source: string; confidence: string; path?: string; excerpt?: string; citations?: Array<{ path?: string; excerpt?: string; kind?: string }> }> }) {
  if (evidence.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {evidence.map((entry, index) => <span key={`${entry.source}:${entry.confidence}:${entry.path ?? ''}:${index}`} className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-text-bright">{evidenceSourceLabel(entry.source)} · {entry.confidence}{entry.path ? ` · ${entry.path}` : ''}</span>)}
    </div>
  );
}

function CitationList({ title, citations }: { title: string; citations: Array<{ path?: string; excerpt?: string; kind?: string }> }) {
  const displayable = citations.filter((citation) => citation.path || citation.excerpt);
  if (displayable.length === 0) return null;
  return <ul className="grid gap-0.5"><li className="font-medium text-foreground">{title}</li>{displayable.map((citation, index) => <li key={`${citation.path ?? ''}:${citation.excerpt ?? ''}:${index}`}>{citation.kind ? `${citation.kind}: ` : ''}{citation.path ?? 'current source'}{citation.excerpt ? ` — ${citation.excerpt}` : ''}</li>)}</ul>;
}

function HistoricalHints({ hints }: { hints: Array<{ source?: string; confidence?: string; intent?: string; citation?: string; evidence?: string; path?: string }> }) {
  if (hints.length === 0) return null;
  return <ul className="grid gap-0.5"><li className="font-medium text-foreground">Historical navigation hints (not closure evidence)</li>{hints.map((hint, index) => <li key={`${hint.source ?? ''}:${hint.citation ?? hint.evidence ?? ''}:${index}`}>{evidenceSourceLabel(hint.source ?? 'historical')} · {hint.intent ?? 'hint'}{hint.confidence ? ` · ${hint.confidence}` : ''}{hint.path ? ` · ${hint.path}` : ''}{hint.citation ?? hint.evidence ? ` — ${hint.citation ?? hint.evidence}` : ''}</li>)}</ul>;
}

function Rows({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid gap-1 text-xs">
      <p className="font-medium text-foreground">{title}</p>
      <dl className="grid gap-1">
        {rows.map((row) => <div key={row.label} className="grid grid-cols-[10rem_1fr] gap-2"><dt className="text-muted-foreground">{row.label}</dt><dd className="text-foreground">{row.value}</dd></div>)}
      </dl>
    </div>
  );
}

function severityRank(severity: string): number {
  return severity === 'warning' ? 0 : 1;
}
