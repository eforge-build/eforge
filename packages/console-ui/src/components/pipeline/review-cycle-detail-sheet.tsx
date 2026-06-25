import { SheetPanel } from '@/components/ui/sheet-panel';
import type { AgentActivityFacts, ReviewIssue } from '@/lib/run-state';
import type { ReviewCycleDetail, ReviewCycleIssueTrace, ReviewCycleReviewerDetail, ReviewCycleRound } from './review-cycle-detail-model';

interface ReviewCycleDetailSheetProps {
  detail: ReviewCycleDetail | null;
  open: boolean;
  onClose: () => void;
  onOpenAgent: (agentId: string) => void;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-10px uppercase tracking-wider text-text-dim mb-1.5">{children}</div>;
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-bg-secondary p-2">
      <div className="text-10px text-text-dim uppercase tracking-wider">{label}</div>
      <div className="text-xs text-foreground mt-0.5 break-words">{value}</div>
    </div>
  );
}

function AgentButton({ agentId, inferred, onOpenAgent }: { agentId?: string; inferred?: boolean; onOpenAgent: (agentId: string) => void }) {
  if (!agentId) return null;
  return (
    <button
      type="button"
      className="text-10px text-blue-400 underline focus:outline-none focus:ring-1 focus:ring-foreground/30 rounded"
      onClick={() => onOpenAgent(agentId)}
    >
      Open agent detail{inferred ? ' (inferred)' : ''}
    </button>
  );
}

function IssueCard({ issue }: { issue: ReviewIssue }) {
  return (
    <div className="rounded border border-border bg-bg-tertiary p-2 space-y-1">
      <div className="flex flex-wrap gap-1 text-10px">
        <span className="font-medium text-foreground">{issue.severity}</span>
        <span className="text-text-dim">·</span>
        <span>{issue.category}</span>
        <span className="text-text-dim">·</span>
        <span className="font-mono break-all">{issue.file}{issue.line !== undefined ? `:${issue.line}` : ''}</span>
      </div>
      <div className="text-11px break-words">{issue.description}</div>
      {issue.fix && <div className="text-10px text-text-dim break-words">Fix: {issue.fix}</div>}
    </div>
  );
}

function EvaluatorVerdictCard({ verdict }: { verdict: ReviewCycleRound['evaluator']['verdicts'][number] }) {
  return (
    <div className="rounded border border-border bg-bg-tertiary p-2 space-y-1">
      <div className="text-10px font-mono break-all">{verdict.file}{verdict.hunk !== undefined ? ` hunk ${verdict.hunk}` : ''}</div>
      <div className="text-10px">Action: <span className="font-medium">{verdict.action}</span>{verdict.issueOutcome ? ` · outcome: ${verdict.issueOutcome}` : ''}</div>
      <div className="text-11px break-words">{verdict.reason}</div>
      {verdict.retryGuidance && <div className="text-10px text-text-dim break-words">Retry guidance: {verdict.retryGuidance}</div>}
    </div>
  );
}

function TraceCard({ trace, onOpenAgent }: { trace: ReviewCycleIssueTrace; onOpenAgent: (agentId: string) => void }) {
  const label = trace.reviewer ? `Issue ${trace.issueId}` : `Unmatched issue reference ${trace.issueId}`;
  const sourceLabel = trace.danglingReferenceSources.length > 0 ? `Referenced by ${trace.danglingReferenceSources.join(' and ')} with no matching reviewer issue.` : undefined;
  return (
    <div className="rounded border border-border bg-bg-secondary p-2 space-y-2">
      <div>
        <div className="font-medium text-xs">{label}</div>
        {sourceLabel && <div className="text-10px text-amber-300">{sourceLabel}</div>}
        {trace.reviewer && (
          <div className="flex items-center justify-between gap-2">
            <div className="text-10px text-text-dim">Reviewer: {trace.reviewer.perspective ?? 'single review'}</div>
            <AgentButton agentId={trace.reviewer.threadAgentId} inferred={trace.reviewer.threadAssociationInferred} onOpenAgent={onOpenAgent} />
          </div>
        )}
      </div>
      {trace.reviewer ? <IssueCard issue={trace.reviewer.issue} /> : <div className="text-10px text-text-dim italic">No reviewer issue matched this reference.</div>}
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-1">
          <div className="text-10px uppercase tracking-wider text-text-dim">Fixer references</div>
          {trace.fixerReferences.length > 0 ? trace.fixerReferences.map((reference, i) => (
            <div key={i} className="rounded border border-border bg-bg-tertiary p-2 text-10px">
              <span className="font-medium">{reference.status}</span>{reference.note ? <span className="text-text-dim"> · {reference.note}</span> : null}
            </div>
          )) : <div className="text-10px text-text-dim italic">No fixer reference was recorded.</div>}
        </div>
        <div className="space-y-1">
          <div className="text-10px uppercase tracking-wider text-text-dim">Evaluator verdicts</div>
          {trace.evaluatorVerdicts.length > 0 ? trace.evaluatorVerdicts.map((verdict, i) => <EvaluatorVerdictCard key={i} verdict={verdict} />) : <div className="text-10px text-text-dim italic">No evaluator verdict was linked.</div>}
        </div>
      </div>
    </div>
  );
}

function ReviewerCard({ reviewer, onOpenAgent }: { reviewer: ReviewCycleReviewerDetail; onOpenAgent: (agentId: string) => void }) {
  const label = reviewer.perspective ?? 'single review';
  return (
    <div className="rounded border border-border bg-bg-secondary p-2 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-xs">{label}</div>
          <div className="text-10px text-text-dim">{reviewer.issues.length} issue(s)</div>
        </div>
        <AgentButton agentId={reviewer.threadAgentId} inferred={reviewer.threadAssociationInferred} onOpenAgent={onOpenAgent} />
      </div>
      {reviewer.issues.length > 0 ? (
        <div className="space-y-1">{reviewer.issues.map((issue, i) => <IssueCard key={i} issue={issue} />)}</div>
      ) : (
        <div className="text-10px text-text-dim italic">This reviewer reported no issues.</div>
      )}
    </div>
  );
}

function ActivityList({ activity }: { activity?: AgentActivityFacts }) {
  if (!activity) return <div className="text-10px text-text-dim italic">No deterministic file activity was recorded.</div>;
  return (
    <div className="space-y-1">
      <div className="text-10px text-text-dim">
        {activity.attribution}{activity.totals ? ` · ${activity.totals.filesChanged} files · +${activity.totals.additions} -${activity.totals.deletions}` : ''}
      </div>
      {activity.files && activity.files.length > 0 ? activity.files.map((file) => (
        <div key={file.path} className="text-10px font-mono flex items-center gap-2">
          <span className="truncate flex-1">{file.path}</span>
          {file.additions !== undefined && <span className="text-green-400">+{file.additions}</span>}
          {file.deletions !== undefined && <span className="text-red-400">-{file.deletions}</span>}
        </div>
      )) : <div className="text-10px text-text-dim italic">No changed files were listed.</div>}
      {activity.notes?.map((note, i) => <div key={i} className="text-10px text-text-dim italic">{note}</div>)}
    </div>
  );
}

function EvaluatorLane({ round, onOpenAgent }: { round: ReviewCycleRound; onOpenAgent: (agentId: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-11px text-text-dim">
          {round.evaluator.accepted !== undefined || round.evaluator.rejected !== undefined
            ? `${round.evaluator.accepted ?? 0} accepted / ${round.evaluator.rejected ?? 0} rejected`
            : 'No accepted/rejected counts recorded.'}
        </div>
        <AgentButton agentId={round.evaluator.threadAgentId} inferred={round.evaluator.threadAssociationInferred} onOpenAgent={onOpenAgent} />
      </div>
      {round.evaluator.verdicts.length > 0 ? round.evaluator.verdicts.map((verdict, i) => <EvaluatorVerdictCard key={i} verdict={verdict} />) : <div className="text-10px text-text-dim italic">No unlinked evaluator verdicts were recorded for this round.</div>}
    </div>
  );
}

function RoundCard({ round, onOpenAgent }: { round: ReviewCycleRound; onOpenAgent: (agentId: string) => void }) {
  return (
    <div className="rounded border border-border bg-bg-secondary/60 p-3 space-y-3">
      <div className="font-semibold text-sm">{round.roundLabel}</div>
      {round.linkedTraces.length > 0 && (
        <div>
          <SectionTitle>Linked issue traces</SectionTitle>
          <div className="space-y-2">{round.linkedTraces.map((trace) => <TraceCard key={trace.issueId} trace={trace} onOpenAgent={onOpenAgent} />)}</div>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <SectionTitle>Reviewers</SectionTitle>
          <div className="space-y-2">
            {round.reviewers.length > 0 ? round.reviewers.map((reviewer, i) => (
              <ReviewerCard key={`${reviewer.perspective ?? 'single'}-${i}`} reviewer={reviewer} onOpenAgent={onOpenAgent} />
            )) : <div className="text-10px text-text-dim italic">No unlinked reviewer issues were recorded for this round.</div>}
            {round.perspectiveErrors.map((error, i) => (
              <div key={i} className="rounded border border-red-900/40 bg-red-950/20 p-2 text-10px">
                <div className="font-medium text-red-400">Perspective error: {error.perspective}</div>
                <div className="break-words text-text-dim">{error.error}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle>Review-fixer</SectionTitle>
          {round.reviewFix.ran || round.reviewFix.activity ? (
            <div className="rounded border border-border bg-bg-secondary p-2 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="text-11px text-text-dim">{round.reviewFix.issueCount !== undefined ? `${round.reviewFix.issueCount} issue(s) handed to fixer` : 'Review-fixer lifecycle recorded.'}</div>
                <AgentButton agentId={round.reviewFix.threadAgentId} inferred={round.reviewFix.threadAssociationInferred} onOpenAgent={onOpenAgent} />
              </div>
              {round.reviewFix.continuations.map((continuation, i) => (
                <div key={i} className="text-10px text-amber-300">Continuation {continuation.attempt}/{continuation.maxContinuations}</div>
              ))}
              {round.unlinkedFixerReferences.map((reference, i) => (
                <div key={i} className="text-10px text-text-dim">Unlinked fixer reference: <span className="font-medium">{reference.status}</span>{reference.note ? ` · ${reference.note}` : ''}</div>
              ))}
              <ActivityList activity={round.reviewFix.activity} />
            </div>
          ) : <div className="text-10px text-text-dim italic">No review-fixer activity was recorded for this round.</div>}
        </div>
        <div>
          <SectionTitle>Evaluator</SectionTitle>
          {round.evaluator.ran || round.evaluator.verdicts.length > 0 ? (
            <div className="rounded border border-border bg-bg-secondary p-2"><EvaluatorLane round={round} onOpenAgent={onOpenAgent} /></div>
          ) : <div className="text-10px text-text-dim italic">No unlinked evaluator verdicts were recorded for this round.</div>}
        </div>
      </div>
    </div>
  );
}

export function ReviewCycleDetailSheet({ detail, open, onClose, onOpenAgent }: ReviewCycleDetailSheetProps) {
  if (!detail) return null;
  const { summary } = detail;
  const finalEvaluation = summary.finalAccepted === undefined && summary.finalRejected === undefined
    ? 'No final evaluation recorded'
    : `${summary.finalAccepted ?? 0} accepted / ${summary.finalRejected ?? 0} rejected`;

  return (
    <SheetPanel open={open} onClose={onClose} title={`${detail.planId} · review-cycle`} description={detail.roundsInferred ? 'Round grouping inferred from legacy event timing.' : 'Round grouping uses event round metadata.'}>
      <div className="p-4 text-xs space-y-4">
        <div className="grid gap-2 md:grid-cols-2">
          <SummaryItem label="Final evaluation" value={finalEvaluation} />
          {summary.terminated && <SummaryItem label="Termination" value={`${summary.terminated.reason}: ${summary.terminated.rationale}`} />}
          {summary.reviewStrategy && <SummaryItem label="Review strategy" value={`${summary.reviewStrategy.strategy} (${summary.reviewStrategy.source}) — ${summary.reviewStrategy.rationale}`} />}
          {summary.evaluatorStrictness && <SummaryItem label="Evaluator strictness" value={`${summary.evaluatorStrictness.strictness} (${summary.evaluatorStrictness.source}) — ${summary.evaluatorStrictness.rationale}`} />}
        </div>
        <div className="space-y-3">
          {detail.rounds.map((round) => <RoundCard key={round.round} round={round} onOpenAgent={onOpenAgent} />)}
        </div>
      </div>
    </SheetPanel>
  );
}
