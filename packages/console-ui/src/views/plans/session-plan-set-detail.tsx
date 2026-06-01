/**
 * Read-only detail panel for a session plan set.
 *
 * Renders the manifest header, validation summary, umbrella anchor context (or a
 * missing-anchor diagnostic), and per-child metadata. This view is strictly
 * read-only: it has no create, update, enqueue, submit, or build controls.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type {
  SessionPlanSetShowResponse,
  SessionPlanSetSummaryWire,
  SessionPlanSetChildSummaryWire,
  SessionPlanSetExternalRefWire,
  SessionPlanSetDiagnosticWire,
  SessionPlanSetAnchorSummaryWire,
} from '@eforge-build/client/browser';

interface SessionPlanSetDetailProps {
  detail: SessionPlanSetShowResponse | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
}

function ManifestHeader({
  planSet,
  dir,
  manifestPath,
  validationOk,
}: {
  planSet: SessionPlanSetSummaryWire;
  dir: string;
  manifestPath: string;
  validationOk: boolean;
}) {
  // The show response carries the directory path but not the directory id
  // (planSetId) as a discrete field. Derive it from the directory basename so
  // it stays visible even when the full path is truncated.
  const directoryId = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold truncate">{planSet.title}</span>
        <Badge variant="secondary" className="text-xs">
          plan set
        </Badge>
        <Badge variant="outline" className="text-xs">
          {planSet.status}
        </Badge>
        <Badge variant={validationOk ? 'secondary' : 'destructive'} className="text-xs">
          validation: {validationOk ? 'ok' : 'errors'}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <span>
          <span className="text-muted-foreground">Manifest id </span>
          <span className="font-mono font-medium">{planSet.id}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Directory id </span>
          <span className="font-mono font-medium">{directoryId}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Strategy </span>
          <span className="font-medium">{planSet.strategy}</span>
        </span>
      </div>
      <p className="font-mono text-muted-foreground break-all">{dir}</p>
      <p className="font-mono text-muted-foreground break-all">{manifestPath}</p>
    </div>
  );
}

function DiagnosticsBlock({
  diagnostics,
}: {
  diagnostics: SessionPlanSetDiagnosticWire[];
}) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border border-border bg-background/40 p-3 text-xs">
      <p className="text-muted-foreground font-medium">Diagnostics</p>
      <ul className="space-y-1">
        {diagnostics.map((diagnostic, index) => (
          <li key={index} className="flex flex-wrap items-baseline gap-2">
            <Badge variant="destructive" className="text-xs font-mono">
              {diagnostic.code}
            </Badge>
            <span>{diagnostic.message}</span>
            {diagnostic.file && (
              <span className="font-mono text-muted-foreground">{diagnostic.file}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Umbrella context. Renders the anchor content when present; otherwise, when the
 * anchor is declared but missing, renders a missing-anchor diagnostic that names
 * the anchor file and tells the user how to resolve it.
 */
function UmbrellaSection({
  anchor,
  anchorContent,
}: {
  anchor?: SessionPlanSetAnchorSummaryWire;
  anchorContent?: string;
}) {
  if (anchorContent) {
    return (
      <div className="space-y-1">
        <p className="text-muted-foreground font-medium text-xs">Umbrella context</p>
        {anchor && (
          <p className="font-mono text-xs text-muted-foreground break-all">{anchor.file}</p>
        )}
        <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-background/40 p-3 text-xs">
          {anchorContent}
        </pre>
      </div>
    );
  }

  if (anchor && !anchor.exists) {
    return (
      <div
        className="space-y-1 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs"
        role="alert"
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <Badge variant="destructive" className="text-xs font-mono">
            missing-anchor
          </Badge>
          <span className="font-mono text-muted-foreground break-all">{anchor.file}</span>
        </div>
        <p>
          The umbrella anchor file <span className="font-mono">{anchor.file}</span> is declared but
          missing. Create the anchor file or update <span className="font-mono">plan-set.yaml</span>.
        </p>
      </div>
    );
  }

  return null;
}

function ChildReferences({
  references,
}: {
  references: SessionPlanSetExternalRefWire[];
}) {
  if (references.length === 0) return null;
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground">External references</p>
      <ul className="space-y-0.5">
        {references.map((reference, index) => (
          <li key={index} className="break-all">
            <span className="font-mono">
              {reference.kind}: {reference.ref}
            </span>
            {reference.title && <span> {reference.title}</span>}
            {reference.url && (
              <span className="text-muted-foreground"> ({reference.url})</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChildCard({ child }: { child: SessionPlanSetChildSummaryWire }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-background/40 p-3 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono font-medium">{child.id}</span>
        <Badge variant="outline" className="text-xs">
          {child.kind}
        </Badge>
        <Badge variant="outline" className="text-xs">
          {child.status}
        </Badge>
        <Badge variant={child.buildable ? 'secondary' : 'outline'} className="text-xs">
          {child.buildable ? 'buildable' : 'not buildable'}
        </Badge>
        <Badge variant={child.exists ? 'secondary' : 'destructive'} className="text-xs">
          {child.exists ? 'file present' : 'file missing'}
        </Badge>
        {child.validation && (
          <Badge
            variant={child.validation.ok ? 'secondary' : 'destructive'}
            className="text-xs"
          >
            {child.validation.ok
              ? 'validation: ok'
              : `validation: ${child.validation.diagnosticCount} ${
                  child.validation.diagnosticCount === 1 ? 'error' : 'errors'
                }`}
          </Badge>
        )}
        {child.profile && (
          <Badge variant="outline" className="text-xs">
            profile: {child.profile}
          </Badge>
        )}
      </div>

      <p className="font-mono text-muted-foreground break-all">{child.file}</p>

      {child.dependsOn.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-muted-foreground">Dependencies</p>
          <div className="flex flex-wrap gap-1">
            {child.dependsOn.map((dependency) => (
              <Badge key={dependency} variant="outline" className="text-xs font-mono">
                {dependency}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <ChildReferences references={child.externalRefs} />
    </div>
  );
}

export function SessionPlanSetDetail({ detail, status, error }: SessionPlanSetDetailProps) {
  if (status === 'idle') {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Select a plan set to view details.
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (status === 'error' && !detail) {
    return (
      <div
        className="flex items-center justify-center h-full text-xs text-destructive"
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (!detail) return null;

  const { planSet, validation, dir, manifestPath, anchorContent } = detail;

  return (
    <ScrollArea className="h-full min-w-0">
      <div className="space-y-3 p-4 text-xs">
        <ManifestHeader
          planSet={planSet}
          dir={dir}
          manifestPath={manifestPath}
          validationOk={validation.ok}
        />

        <DiagnosticsBlock diagnostics={validation.diagnostics} />

        <UmbrellaSection anchor={planSet.anchor} anchorContent={anchorContent} />

        <div className="space-y-2">
          <p className="text-muted-foreground font-medium">Children ({planSet.children.length})</p>
          {planSet.children.map((child) => (
            <ChildCard key={child.id} child={child} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
