import * as React from 'react';
import { AlertTriangle, CheckCircle2, GitMerge } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from '@/components/ui/card';
import type { PlanSetChild, PlanSetDetail, PlanSetDiagnostic } from '@/types';

interface PlanSetDetailCardProps {
  detail: PlanSetDetail;
}

/** Read-only plan-set detail: children rendered by relationship strategy
 *  (sequential / parallel / dag) plus a validation summary. */
export function PlanSetDetailCard({ detail }: PlanSetDetailCardProps) {
  const planSet = detail.planSet;
  const children = planSet?.children ?? [];
  const strategy = planSet?.strategy ?? 'sequential';
  const diagnostics = detail.validation?.diagnostics ?? planSet?.diagnostics ?? [];
  const ok = detail.validation?.ok ?? diagnostics.length === 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{planSet?.title ?? planSet?.id ?? 'Plan set'}</CardTitle>
          <CardDescription>{detail.manifestPath}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {planSet?.status && <Badge variant="outline">{planSet.status}</Badge>}
          <Badge variant="secondary"><GitMerge className="mr-1 h-3.5 w-3.5" /> {strategy}</Badge>
          <Badge variant={ok ? 'default' : 'destructive'}>{ok ? 'valid' : `${diagnostics.length} issue(s)`}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {children.length === 0
          ? <p className="text-muted-foreground">This plan set has no children.</p>
          : <ChildList children={children} strategy={strategy} />}
        {diagnostics.length > 0 && <DiagnosticList diagnostics={diagnostics} />}
      </CardContent>
    </Card>
  );
}

function ChildList({ children, strategy }: { children: PlanSetChild[]; strategy: string }) {
  if (strategy === 'parallel') {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {children.map((child) => <ChildCard key={child.id} child={child} />)}
      </div>
    );
  }
  // sequential and dag both render as an ordered list; dag additionally surfaces
  // each child's declared dependencies.
  return (
    <ol className="grid gap-2">
      {children.map((child, index) => (
        <li key={child.id} className="flex items-start gap-2">
          <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem] text-muted-foreground">{index + 1}</span>
          <div className="min-w-0 flex-1"><ChildCard child={child} showDeps={strategy === 'dag'} /></div>
        </li>
      ))}
    </ol>
  );
}

function ChildCard({ child, showDeps }: { child: PlanSetChild; showDeps?: boolean }) {
  const dependsOn = child.dependsOn ?? [];
  const childOk = child.validation?.ok ?? true;
  return (
    <div className="rounded-md border bg-card p-2">
      <div className="flex items-center gap-2">
        {childOk
          ? <CheckCircle2 className="h-4 w-4 text-[color:var(--lane-ready)]" />
          : <AlertTriangle className="h-4 w-4 text-[color:var(--lane-blocked)]" />}
        <strong className="truncate text-text-bright">{child.id}</strong>
        <span className="ml-auto flex flex-wrap gap-1">
          <Badge variant="outline">{child.status}</Badge>
          {child.kind && child.kind !== 'plan' && <Badge variant="secondary">{child.kind}</Badge>}
          {child.buildable === false && <Badge variant="outline">not buildable</Badge>}
          {child.exists === false && <Badge variant="destructive">missing file</Badge>}
        </span>
      </div>
      {child.file && <code className="mt-0.5 block truncate text-[0.7rem] text-muted-foreground">{child.file}</code>}
      {showDeps && dependsOn.length > 0 && (
        <p className="mt-1 flex flex-wrap items-baseline gap-1 text-xs">
          <span className="text-[0.6rem] uppercase tracking-wide text-muted-foreground">Depends on</span>
          {dependsOn.map((dep) => <code key={dep} className="rounded border border-border px-1 text-[0.68rem]">{dep}</code>)}
        </p>
      )}
    </div>
  );
}

function DiagnosticList({ diagnostics }: { diagnostics: PlanSetDiagnostic[] }) {
  return (
    <div className="grid gap-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Validation</h4>
      <ul className="grid gap-1.5">
        {diagnostics.map((diagnostic, index) => (
          <li key={index} className="rounded border border-[color:var(--lane-blocked)]/40 bg-background p-2 text-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-[color:var(--lane-blocked)]" />
              <span className="text-foreground">{diagnostic.message}</span>
              {diagnostic.code && <span className="ml-auto text-[0.6rem] uppercase tracking-wide text-muted-foreground">{diagnostic.code}</span>}
            </div>
            {(diagnostic.childId || diagnostic.file) && (
              <code className="mt-0.5 block truncate text-[0.68rem] text-muted-foreground">{diagnostic.childId ?? diagnostic.file}</code>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
