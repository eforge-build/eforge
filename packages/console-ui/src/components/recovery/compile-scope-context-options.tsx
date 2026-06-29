import type { RecoverySidecarRecoveryOption } from '@eforge-build/client/browser';
import { compileScopeContextOptions, recoveryActionLabel } from '@/lib/compile-resilience-format';
import { decompositionFailureEvidenceSummary } from '@/lib/planning-decomposition-format';

interface CompileScopeContextOptionsProps {
  options: RecoverySidecarRecoveryOption[] | undefined;
}

const EVIDENCE_LIST_MAX = 5;
function capText(value: string, max = 180): string { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
function joinIds(items: readonly string[]): string { return items.length > 0 ? items.slice(0, EVIDENCE_LIST_MAX).map((item) => capText(item)).join(', ') + (items.length > EVIDENCE_LIST_MAX ? ` (+${items.length - EVIDENCE_LIST_MAX} more)` : '') : 'none'; }

export function CompileScopeContextOptions({ options }: CompileScopeContextOptionsProps) {
  const compileOptions = compileScopeContextOptions(options);
  if (compileOptions.length === 0) return null;

  return (
    <section className="space-y-2 rounded-md border border-yellow/30 bg-yellow/10 p-3">
      <h3 className="text-sm font-medium text-foreground">Compile scope/context guidance</h3>
      <p className="text-sm text-muted-foreground">
        These options are read-only compile guidance. They do not map to apply-recovery; use the existing recovery verdict actions, continue-and-repair when valid, or manual scope reduction/decomposition.
      </p>
      <div className="space-y-2">
        {compileOptions.map((option, index) => (
          <div key={`${option.action}-${index}`} className="rounded border border-border bg-background/60 p-2 text-xs">
            <div className="font-medium text-foreground">
              {recoveryActionLabel(option.action)}{option.recommended ? ' (recommended)' : ''}
            </div>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
              <dt>Eligible</dt><dd>{option.eligible ? 'yes' : 'no'}</dd>
              <dt>Attempted</dt><dd>{option.attempted ? 'yes' : 'no'}</dd>
              <dt>Attempt</dt><dd>{option.attempt}/{option.maxAttempts}</dd>
              <dt>Source</dt><dd>{option.source}</dd>
              <dt>Failure kind</dt><dd>{option.failureKind}</dd>
            </dl>
            <p className="mt-1 text-muted-foreground">{option.reason}</p>
            {option.decompositionEvidence ? (
              <div className="mt-2 rounded border border-yellow/20 bg-yellow/5 p-2 text-muted-foreground">
                <div className="font-medium text-foreground">Decomposition evidence</div>
                <p>{decompositionFailureEvidenceSummary(option.decompositionEvidence)}</p>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                  <dt>Failed unit</dt><dd>{option.decompositionEvidence.unitId}</dd>
                  {option.decompositionEvidence.parentUnitId ? <><dt>Parent unit</dt><dd>{option.decompositionEvidence.parentUnitId}</dd></> : null}
                  <dt>Depth</dt><dd>{option.decompositionEvidence.depth}</dd>
                  <dt>Triggered limits</dt><dd>{option.decompositionEvidence.observed.triggeredLimitKeys.join(', ') || 'none'}</dd>
                  <dt>Unresolved criteria</dt><dd>{option.decompositionEvidence.unresolvedCriteria.length}</dd>
                </dl>
                {option.decompositionEvidence.blockers.length > 0 ? (
                  <div className="mt-2">
                    <div className="font-medium text-foreground">Blockers ({option.decompositionEvidence.blockers.length})</div>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {option.decompositionEvidence.blockers.slice(0, EVIDENCE_LIST_MAX).map((blocker, blockerIndex) => <li key={blockerIndex}>{capText(blocker)}</li>)}
                      {option.decompositionEvidence.blockers.length > EVIDENCE_LIST_MAX ? <li>[omitted {option.decompositionEvidence.blockers.length - EVIDENCE_LIST_MAX} blocker(s)]</li> : null}
                    </ul>
                  </div>
                ) : null}
                {option.decompositionEvidence.splitAttempts.length > 0 ? (
                  <div className="mt-2">
                    <div className="font-medium text-foreground">Split attempts ({option.decompositionEvidence.splitAttempts.length})</div>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {option.decompositionEvidence.splitAttempts.slice(0, EVIDENCE_LIST_MAX).map((attempt) => (
                        <li key={`${attempt.unitId ?? option.decompositionEvidence?.unitId}-${attempt.attempt}`}>
                          attempt {attempt.attempt}{attempt.unitId ? ` (${attempt.unitId})` : ''}: {capText(attempt.reason)} → {joinIds(attempt.resultingUnitIds)}
                        </li>
                      ))}
                      {option.decompositionEvidence.splitAttempts.length > EVIDENCE_LIST_MAX ? <li>[omitted {option.decompositionEvidence.splitAttempts.length - EVIDENCE_LIST_MAX} split attempt(s)]</li> : null}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
