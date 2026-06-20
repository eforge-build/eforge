import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { DraftUnitAdvisory } from '@/types';

/**
 * Renders a non-blocking dependency advisory for a merge or split. 'caution'
 * findings warn that the reshape works against the dependency graph; 'ok'
 * confirms it is consistent. The user always decides - this never disables the
 * action, it only informs.
 */
export function DraftUnitAdvisoryNotice({ advisory, className = '' }: { advisory: DraftUnitAdvisory; className?: string }) {
  const caution = advisory.severity === 'caution';
  const Icon = caution ? AlertTriangle : CheckCircle2;
  const tone = caution ? 'var(--prio-medium)' : 'var(--lane-done)';
  return (
    <div className={`rounded-md border p-2 ${className}`} style={{ borderColor: `color-mix(in srgb, ${tone} 40%, transparent)`, background: `color-mix(in srgb, ${tone} 8%, transparent)` }} role="status" aria-live="polite">
      <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide" style={{ color: tone }}>
        <Icon className="h-3.5 w-3.5" /> {caution ? 'Dependency caution' : 'Dependencies look consistent'}
      </div>
      <ul className="mt-1 grid gap-1 text-xs text-muted-foreground">
        {advisory.findings.map((finding, index) => (
          <li key={`${finding.code}-${index}`}>{finding.message}</li>
        ))}
      </ul>
    </div>
  );
}
