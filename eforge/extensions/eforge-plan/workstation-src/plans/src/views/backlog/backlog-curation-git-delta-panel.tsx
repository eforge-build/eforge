import * as React from 'react';
import type { BacklogCurationGitDeltaDiagnostic, BacklogCurationGitDeltaPreview } from '@/types';
import { abbreviateSourceFingerprint } from '@/components/recommendation-freshness';
import { SubBlock } from './sub-block';

export function shortCommit(value: string | undefined): string {
  if (!value) return 'unknown';
  return value.length <= 12 ? value : value.slice(0, 12);
}

export function sortedGitDeltaDiagnostics(diagnostics: readonly BacklogCurationGitDeltaDiagnostic[] = []): BacklogCurationGitDeltaDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const level = levelRank(left.severity) - levelRank(right.severity);
    if (level !== 0) return level;
    return `${left.code}\u0000${left.message ?? ''}\u0000${left.commit ?? ''}`.localeCompare(`${right.code}\u0000${right.message ?? ''}\u0000${right.commit ?? ''}`);
  });
}

export function BacklogCurationGitDeltaPanel({ gitDelta }: { gitDelta?: BacklogCurationGitDeltaPreview }) {
  if (!gitDelta) return null;
  const diagnostics = sortedGitDeltaDiagnostics(gitDelta.diagnostics);
  const candidateCounts = countAffectedCandidates(gitDelta.affectedItemCandidates);
  const caps = gitDelta.caps;
  return (
    <SubBlock title="Git delta diagnostics" className="gap-1.5">
      <div className="grid gap-1 text-xs text-muted-foreground">
        <p>
          Baseline <Hash value={gitDelta.baseline?.commit ?? undefined} />{gitDelta.baseline?.time ? ` · ${gitDelta.baseline.time}` : gitDelta.baseline?.generatedAt ? ` · ${gitDelta.baseline.generatedAt}` : ''}{gitDelta.baseline?.sourceFingerprint ? <> · source <span title={gitDelta.baseline.sourceFingerprint}>{abbreviateSourceFingerprint(gitDelta.baseline.sourceFingerprint)}</span></> : null}
        </p>
        <p>
          Current HEAD <Hash value={gitDelta.currentHead?.commit} />{gitDelta.currentHead?.time ? ` · ${gitDelta.currentHead.time}` : gitDelta.currentHead?.generatedAt ? ` · ${gitDelta.currentHead.generatedAt}` : ''}{gitDelta.currentHead?.sourceFingerprint ? <> · source <span title={gitDelta.currentHead.sourceFingerprint}>{abbreviateSourceFingerprint(gitDelta.currentHead.sourceFingerprint)}</span></> : null}
        </p>
        <p>coverage {gitDelta.coverage?.kind ?? 'unknown'}{gitDelta.coverage?.message ? ` · ${gitDelta.coverage.message}` : ''}</p>
        <p>Scanned commits: {gitDelta.scannedCommitCount ?? gitDelta.scannedCommits?.length ?? 0}{caps ? ` · caps ${formatCaps(caps)}` : ''}</p>
        {gitDelta.affectedItemCandidates && <p>Affected candidates: {candidateCounts.total}{candidateCounts.ambiguousShipped > 0 ? ` · ambiguous shipped ${candidateCounts.ambiguousShipped}` : ''}{candidateCounts.ambiguousSuperseded > 0 ? ` · ambiguous superseded ${candidateCounts.ambiguousSuperseded}` : ''}</p>}
      </div>
      {diagnostics.length > 0 && (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {diagnostics.map((diagnostic) => (
            <li key={`${diagnostic.severity}:${diagnostic.code}:${diagnostic.message ?? ''}:${diagnostic.commit ?? ''}`}>
              <span className={diagnostic.severity === 'warning' ? 'text-[color:var(--prio-medium)]' : 'text-foreground'}>{diagnostic.severity}</span> <span className="font-mono">{diagnostic.code}</span>{diagnostic.message ? `: ${diagnostic.message}` : ''}{diagnostic.commit ? <> · commit <Hash value={diagnostic.commit} /></> : null}
            </li>
          ))}
        </ul>
      )}
    </SubBlock>
  );
}

function Hash({ value }: { value?: string }) {
  return <span title={value} className="font-mono">{shortCommit(value)}</span>;
}

function levelRank(severity: BacklogCurationGitDeltaDiagnostic['severity']): number {
  return severity === 'warning' ? 0 : 1;
}

function countAffectedCandidates(candidates: BacklogCurationGitDeltaPreview['affectedItemCandidates']): { total: number; ambiguousShipped: number; ambiguousSuperseded: number } {
  return (candidates ?? []).reduce((counts, candidate) => {
    counts.total += 1;
    if (candidate.intent === 'ambiguous-shipped') counts.ambiguousShipped += 1;
    if (candidate.intent === 'ambiguous-superseded') counts.ambiguousSuperseded += 1;
    return counts;
  }, { total: 0, ambiguousShipped: 0, ambiguousSuperseded: 0 });
}

function formatCaps(caps: NonNullable<BacklogCurationGitDeltaPreview['caps']>): string {
  return [caps.commitScanCount !== undefined ? `${caps.commitScanCount} commits` : undefined, caps.changedPathCount !== undefined ? `${caps.changedPathCount} paths` : undefined, caps.excerptCount !== undefined ? `${caps.excerptCount} excerpts` : undefined].filter(Boolean).join(', ');
}
