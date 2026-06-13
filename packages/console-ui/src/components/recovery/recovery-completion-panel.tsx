import * as React from 'react';
import type {
  ApplyRecoveryResponse,
  ContinueRepairResponse,
  RecoveryAppliedMetadata,
  AcceptSuccessResponse,
  AcceptSuccessAppliedSummary,
} from '@eforge-build/client/browser';
import { Button } from '@/components/ui/button';
import { ACCEPT_SUCCESS_REASON_LABELS } from './accept-success-action';

/**
 * Terminal outcome of a queue-affecting recovery interaction. Once one of these
 * is set, the dialog replaces its report/actions body with the completion panel
 * so the same mutating action cannot run twice. `refreshError` carries a
 * secondary, non-fatal failure from the post-mutation queue refresh: the
 * mutation already succeeded, so the success stays visible and the refresh error
 * is shown only as follow-up text.
 */
export type RecoveryCompletion =
  | { kind: 'sidecar-apply'; result: ApplyRecoveryResponse; refreshError?: string }
  | { kind: 'continue-repair'; result: ContinueRepairResponse; refreshError?: string }
  | { kind: 'already-applied'; applied: RecoveryAppliedMetadata; refreshError?: string }
  | { kind: 'accepted-success'; result: AcceptSuccessResponse; refreshError?: string };

function applyResultMessage(result: ApplyRecoveryResponse): string {
  switch (result.verdict) {
    case 'retry':
      return 'Applied retry: the PRD has been re-queued.';
    case 'continue-repair':
      return 'Continue-and-repair queued from preserved compiled artifacts.';
    case 'abandon':
      return 'Applied abandon: the failed PRD has been archived or removed.';
    case 'manual':
      return 'Manual review / manual replanning required: no action was taken.';
  }
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground">
      {label}: <span className="text-foreground">{value}</span>
    </p>
  );
}

function landingSummary(landing: AcceptSuccessAppliedSummary['landing']): string {
  const autoMerge = landing.autoMerge
    ? landing.autoMerge.status === 'complete'
      ? ' — auto-merge complete'
      : ` — auto-merge ${landing.autoMerge.status} — ${landing.autoMerge.reason}`
    : '';
  const suffixes = [
    landing.prUrl ? ` (${landing.prUrl})` : '',
    landing.mergeCommitSha ? ` (${landing.mergeCommitSha})` : '',
    landing.branch ? ` (${landing.branch})` : '',
    landing.reason ? ` — ${landing.reason}` : '',
    autoMerge,
  ].join('');
  return `${landing.action} — ${landing.status}${suffixes}`;
}

function AcceptedSummaryView({ applied }: { applied: AcceptSuccessAppliedSummary }) {
  const { cleanup, landing, dependents } = applied;
  return (
    <div className="space-y-1">
      <Field label="Reason category" value={ACCEPT_SUCCESS_REASON_LABELS[applied.reasonCategory]} />
      <Field label="Reason" value={applied.reason} />
      <Field
        label="Cleanup"
        value={cleanup.status === 'committed' ? `committed${cleanup.commitSha ? ` (${cleanup.commitSha})` : ''}` : 'no changes'}
      />
      <Field label="Landing" value={landingSummary(landing)} />
      <Field
        label="Dependents unblocked"
        value={dependents.unblocked.length > 0 ? dependents.unblocked.join(', ') : 'none'}
      />
      {dependents.remainedBlocked.length > 0 && (
        <Field label="Still blocked" value={dependents.remainedBlocked.join(', ')} />
      )}
      {dependents.notFound.length > 0 && (
        <Field label="Not found" value={dependents.notFound.join(', ')} />
      )}
    </div>
  );
}

function AppliedMarkerView({ applied }: { applied: RecoveryAppliedMetadata }) {
  if (applied.action === 'accepted-success') {
    return <AcceptedSummaryView applied={applied} />;
  }
  return (
    <div className="space-y-1">
      <Field label="Action" value={applied.action} />
      {applied.commitSha && <Field label="Commit" value={applied.commitSha} />}
    </div>
  );
}

function completionTitle(completion: RecoveryCompletion): string {
  switch (completion.kind) {
    case 'sidecar-apply':
      return 'Recovery applied';
    case 'continue-repair':
      return 'Continue and repair queued';
    case 'already-applied':
      return 'Recovery already applied';
    case 'accepted-success':
      return 'Build accepted as successful';
  }
}

function CompletionBody({ completion }: { completion: RecoveryCompletion }) {
  switch (completion.kind) {
    case 'sidecar-apply':
      return (
        <div className="space-y-1">
          <p className="text-sm text-foreground">{applyResultMessage(completion.result)}</p>
          {completion.result.detail && (
            <p className="text-xs text-muted-foreground">{completion.result.detail}</p>
          )}
        </div>
      );
    case 'continue-repair':
      return (
        <div className="space-y-1">
          <p className="text-sm text-foreground">
            {completion.result.detail ?? `Continue-and-repair status: ${completion.result.status ?? completion.result.kind}`}
          </p>
          <Field label="PRD" value={completion.result.prdId} />
          <Field label="Set" value={completion.result.setName} />
          <Field label="Feature branch" value={completion.result.featureBranch} />
          <Field label="Base branch" value={completion.result.baseBranch} />
          {completion.result.profile && <Field label="Profile" value={completion.result.profile} />}
        </div>
      );
    case 'already-applied':
      return (
        <div className="space-y-1">
          <p className="text-sm text-foreground">
            This recovery verdict was already applied; no further action was taken.
          </p>
          <AppliedMarkerView applied={completion.applied} />
        </div>
      );
    case 'accepted-success':
      return (
        <div className="space-y-1">
          <p className="text-sm text-foreground">This build was accepted as successful.</p>
          <AcceptedSummaryView applied={completion.result.applied} />
        </div>
      );
  }
}

interface RecoveryCompletionPanelProps {
  completion: RecoveryCompletion;
  onOpenChange: (open: boolean) => void;
}

/**
 * Stable completion panel rendered after a queue-affecting recovery mutation or
 * when a sidecar reports durable applied state. Replaces the mutating
 * report/actions body so the same action cannot run twice.
 */
export function RecoveryCompletionPanel({ completion, onOpenChange }: RecoveryCompletionPanelProps) {
  return (
    <div className="space-y-4 px-4 py-4">
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">{completionTitle(completion)}</h3>
        <CompletionBody completion={completion} />
        {completion.refreshError && (
          <p role="alert" className="text-xs text-yellow">
            The queue could not be refreshed automatically: {completion.refreshError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Check the Queue card to confirm the updated queue state.
        </p>
      </section>
      <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
        Close
      </Button>
    </div>
  );
}
