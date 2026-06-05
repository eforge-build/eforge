import * as React from 'react';
import {
  ACCEPT_SUCCESS_REASON_CATEGORIES,
  type AcceptSuccessPreviewResponse,
  type AcceptSuccessReasonCategory,
} from '@eforge-build/client/browser';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmAction } from './confirm-action';

/** Human-readable labels for accepted-success reason categories. */
export const ACCEPT_SUCCESS_REASON_LABELS: Record<AcceptSuccessReasonCategory, string> = {
  bad_acceptance_criterion: 'Bad / wrong acceptance criterion',
  manual_verification_passed: 'Manually verified as passing',
  external_or_inconclusive_criterion_waived: 'External or inconclusive criterion waived',
  other: 'Other',
};

/** Human-readable labels for accepted-success landing actions. */
export const ACCEPT_SUCCESS_LANDING_LABELS: Record<AcceptSuccessPreviewResponse['landingAction'], string> = {
  pr: 'open a pull request',
  merge: 'merge into the base branch',
  leave: 'leave the feature branch in place',
};

export interface AcceptSuccessApplyInput {
  reasonCategory: AcceptSuccessReasonCategory;
  reason: string;
  unblockDependentIds: string[];
}

interface AcceptSuccessActionProps {
  /** Read-only preview describing eligibility, cleanup, landing, and dependents. */
  preview: AcceptSuccessPreviewResponse;
  /** True while the parent's accept-success mutation is in flight. */
  applying: boolean;
  /** Error from the parent's accept-success mutation, if any. */
  error: string | null;
  /** Invoked with the assembled form payload after the user confirms. */
  onApply: (input: AcceptSuccessApplyInput) => void;
}

/**
 * Accepted-success recovery form: a required reason category, a required
 * freeform note, dependent selection, and a confirmation preview. All mutation
 * happens in the parent dialog; this component is presentational and only
 * gathers and validates input.
 */
export function AcceptSuccessAction({ preview, applying, error, onApply }: AcceptSuccessActionProps) {
  const [reasonCategory, setReasonCategory] = React.useState<AcceptSuccessReasonCategory | ''>('');
  const [reason, setReason] = React.useState('');
  // Default to selecting only candidates that are immediately unblockable;
  // blocked candidates are shown but cannot be selected.
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(preview.dependentCandidates.filter((c) => c.unblockable).map((c) => c.prdId)),
  );

  const trimmedReason = reason.trim();
  const canConfirm = reasonCategory !== '' && trimmedReason.length > 0 && !applying;

  const selectedIds = preview.dependentCandidates
    .filter((c) => c.unblockable && selected.has(c.prdId))
    .map((c) => c.prdId);

  const toggle = (prdId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(prdId);
      else next.delete(prdId);
      return next;
    });
  };

  const cleanupLine = preview.cleanup.willCommit
    ? `Cleanup: commit removal of plan/PRD artifacts for ${preview.cleanup.planSet}.`
    : 'Cleanup: no artifact cleanup needed.';
  const landingLine = `Landing: ${ACCEPT_SUCCESS_LANDING_LABELS[preview.landingAction]}.`;
  // --- eforge:region plan-02-console-resolved-status ---
  const effectiveAutoMerge = (preview as AcceptSuccessPreviewResponse & { effectiveLandingAutoMerge?: boolean }).effectiveLandingAutoMerge;
  const autoMergeLine = effectiveAutoMerge == null ? null : `PR auto-merge: ${effectiveAutoMerge ? 'enabled' : 'disabled'}.`;
  // --- eforge:endregion plan-02-console-resolved-status ---
  const commitWord = preview.audit.landedCommitCount === 1 ? 'commit' : 'commits';
  const auditLine =
    `Audit: record set ${preview.audit.setName}, feature branch ${preview.audit.featureBranch}, ` +
    `base branch ${preview.audit.baseBranch}, ${preview.audit.landedCommitCount} landed ${commitWord}.`;
  const dependentsLine =
    selectedIds.length > 0
      ? `Dependents: unblock ${selectedIds.join(', ')}.`
      : 'Dependents: no dependents will be unblocked.';

  const confirmDescription = (
    <span className="block space-y-2">
      <span className="block">Accepting this failed build as successful will:</span>
      <span className="block">{cleanupLine}</span>
      <span className="block">{landingLine}</span>
      {/* --- eforge:region plan-02-console-resolved-status --- */}
      {autoMergeLine && <span className="block">{autoMergeLine}</span>}
      {/* --- eforge:endregion plan-02-console-resolved-status --- */}
      <span className="block">{auditLine}</span>
      <span className="block">{dependentsLine}</span>
    </span>
  );

  return (
    <section className="space-y-3 rounded-md border p-3">
      <h3 className="text-sm font-medium text-foreground">Accept build as successful</h3>
      <p className="text-xs text-muted-foreground">
        Use this when the implementation is acceptable but PRD or acceptance validation failed on a
        bad, conflicting, or externally unverifiable criterion.
      </p>

      <div className="space-y-1">
        <label htmlFor="accept-success-reason-category" className="block text-xs font-medium text-foreground">
          Reason category
        </label>
        <select
          id="accept-success-reason-category"
          aria-label="Reason category"
          className="w-full rounded-md border bg-transparent px-2 py-1 text-sm"
          value={reasonCategory}
          disabled={applying}
          onChange={(e) => setReasonCategory(e.target.value as AcceptSuccessReasonCategory | '')}
        >
          <option value="">Select a reason category…</option>
          {ACCEPT_SUCCESS_REASON_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {ACCEPT_SUCCESS_REASON_LABELS[category]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="accept-success-reason" className="block text-xs font-medium text-foreground">
          Reason
        </label>
        <textarea
          id="accept-success-reason"
          aria-label="Reason"
          className="w-full rounded-md border bg-transparent px-2 py-1 text-sm"
          rows={3}
          value={reason}
          disabled={applying}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why this failed build should be accepted as successful."
        />
      </div>

      {preview.dependentCandidates.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Unblock skipped dependents</p>
          <ul className="space-y-1.5">
            {preview.dependentCandidates.map((candidate) => (
              <li key={candidate.prdId} className="flex items-start gap-2">
                <Checkbox
                  id={`accept-success-dependent-${candidate.prdId}`}
                  checked={candidate.unblockable && selected.has(candidate.prdId)}
                  disabled={!candidate.unblockable || applying}
                  onCheckedChange={(checked) => toggle(candidate.prdId, checked === true)}
                  aria-label={`Unblock ${candidate.title}`}
                />
                <label
                  htmlFor={`accept-success-dependent-${candidate.prdId}`}
                  className="min-w-0 flex-1 text-xs text-foreground"
                >
                  <span className="block truncate">{candidate.title}</span>
                  {!candidate.unblockable && candidate.blockedBy.length > 0 && (
                    <span className="block text-muted-foreground">
                      still blocked by {candidate.blockedBy.join(', ')}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmAction
        triggerLabel={applying ? 'Accepting…' : 'Accept build as successful'}
        title="Accept this failed build as successful?"
        description={confirmDescription}
        confirmLabel="Accept as successful"
        onConfirm={() => {
          if (reasonCategory === '') return;
          onApply({ reasonCategory, reason: trimmedReason, unblockDependentIds: selectedIds });
        }}
        disabled={!canConfirm}
      />

      {error && (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      )}
    </section>
  );
}
