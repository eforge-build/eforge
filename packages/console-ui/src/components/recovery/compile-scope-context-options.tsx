import type { RecoverySidecarRecoveryOption } from '@eforge-build/client/browser';
import { compileScopeContextOptions, recoveryActionLabel } from '@/lib/compile-resilience-format';

interface CompileScopeContextOptionsProps {
  options: RecoverySidecarRecoveryOption[] | undefined;
}

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
          </div>
        ))}
      </div>
    </section>
  );
}
