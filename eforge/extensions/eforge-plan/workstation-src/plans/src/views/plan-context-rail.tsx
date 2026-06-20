import { ClipboardList, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePlanNavigation } from '@/lib/plan-links';
import { planDisplayTitle } from '@/lib/plan-title';
import type { Artifact } from '@/types';

interface PlanContextRailProps {
  /** The plan currently open in the Plans focus, or null when none is selected. */
  artifact: Artifact | null;
  /** Backlog item id -> title, resolved from the board for readable labels. */
  titles: Map<string, string>;
}

function buildPrUrl(artifact: Artifact): string | undefined {
  return artifact.prRefs?.find((ref) => ref.url)?.url ?? artifact.linkRows?.find((row) => row.prUrl)?.prUrl;
}

/**
 * Context for the plan open in the Plans focus: where it came from (its source
 * backlog items, linking back to the board) and how far it has built. The plan
 * body holds the substance (readiness, open questions, sections); the rail holds
 * the surrounding lineage. Renders from the artifact summary already loaded with
 * the workstation - no separate plan detail fetch.
 */
export function PlanContextRail({ artifact, titles }: PlanContextRailProps) {
  const { openItem } = usePlanNavigation();

  if (!artifact) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><ClipboardList className="h-4 w-4 text-muted-foreground" /> Plan context</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">Select a plan to see where it came from and how far it has built.</p>
        </CardContent>
      </Card>
    );
  }

  const itemIds = artifact.sourceRefs?.sourceItemIds ?? artifact.sourceRefs?.itemIds ?? [];
  const epicIds = artifact.sourceRefs?.sourceEpicIds ?? artifact.sourceRefs?.epicIds ?? [];
  const buildState = artifact.lifecycleState ?? artifact.status;
  const prUrl = buildPrUrl(artifact);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList className="h-4 w-4 text-muted-foreground" /> Plan context
          {buildState && <Badge variant="outline" className="ml-auto capitalize">{buildState}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="truncate text-xs text-text-bright" title={planDisplayTitle(artifact.title, artifact.session ?? artifact.key)}>
          {planDisplayTitle(artifact.title, artifact.session ?? artifact.key)}
        </p>

        {itemIds.length > 0 && (
          <div>
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Built from {itemIds.length} backlog item{itemIds.length === 1 ? '' : 's'}
            </span>
            <ul className="grid gap-0.5">
              {itemIds.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => openItem(id)}
                    title={`Open ${id} on the board`}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-2xs leading-snug text-foreground transition-colors hover:bg-accent"
                  >
                    <span className="line-clamp-2 min-w-0 flex-1">{titles.get(id) ?? id}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {epicIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
            <span>Epics</span>
            {epicIds.map((id) => <code key={id} className="rounded border border-border bg-card px-1 text-text-bright">{id}</code>)}
          </div>
        )}

        {itemIds.length === 0 && epicIds.length === 0 && (
          <p className="text-2xs text-muted-foreground">No source backlog items recorded for this plan.</p>
        )}

        {prUrl && (
          <a href={prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-2xs text-[color:var(--lane-ready)] hover:underline">
            <ExternalLink className="h-3 w-3" /> View pull request
          </a>
        )}

        <p className="text-2xs leading-relaxed text-muted-foreground">Builds run in the global queue (see the top bar). Full build trace is in the plan footer.</p>
      </CardContent>
    </Card>
  );
}
