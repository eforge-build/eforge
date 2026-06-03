/**
 * Selected workspace detail panel for a session plan.
 * Shows metadata, dimensions, readiness detail, and a scrollable markdown preview.
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { toConsolePath } from '@/lib/navigation';
import { SessionPlanMarkdownPreview } from './session-plan-markdown-preview';
import type { SessionPlanShowResponse } from '@eforge-build/client/browser';

interface SessionPlanDetailProps {
  detail: SessionPlanShowResponse | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  onNavigate?: (href: string) => void;
}

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

function DimensionBadges({
  dimensions,
  variant = 'outline',
  coveredDimensions,
  coveredVariant = 'secondary',
}: {
  dimensions: string[];
  variant?: BadgeVariant;
  /** When provided, dimensions in this set render with `coveredVariant`. */
  coveredDimensions?: string[];
  coveredVariant?: BadgeVariant;
}) {
  const coveredSet = React.useMemo(
    () => new Set(coveredDimensions ?? []),
    [coveredDimensions],
  );
  return (
    <div className="flex flex-wrap gap-1">
      {dimensions.map((dimension) => (
        <Badge
          key={dimension}
          variant={coveredSet.has(dimension) ? coveredVariant : variant}
          className="text-xs"
        >
          {dimension}
        </Badge>
      ))}
    </div>
  );
}

function BuildLink({
  session,
  onNavigate,
  className,
}: {
  session: string;
  onNavigate?: (href: string) => void;
  className?: string;
}) {
  const href = toConsolePath({ id: 'buildDetail', detailId: session });
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (onNavigate) {
      event.preventDefault();
      onNavigate(href);
    }
  };
  return (
    <a
      href={href}
      onClick={handleClick}
      className={cn('font-mono text-primary hover:underline', className)}
    >
      {session}
    </a>
  );
}

function MetadataSummary({
  plan,
  onNavigate,
}: {
  plan: SessionPlanShowResponse['plan'];
  onNavigate?: (href: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      <span>
        <span className="text-muted-foreground">Type </span>
        <span className="font-medium">{plan.planning_type}</span>
      </span>
      <span>
        <span className="text-muted-foreground">Depth </span>
        <span className="font-medium">{plan.planning_depth}</span>
      </span>
      {plan.profile && (
        <span>
          <span className="text-muted-foreground">Profile </span>
          <span className="font-medium">{plan.profile}</span>
        </span>
      )}
      {plan.agent_profile && (
        <span>
          <span className="text-muted-foreground">Agent profile </span>
          <span className="font-medium">{plan.agent_profile}</span>
        </span>
      )}
      {plan.eforge_session && (
        <span>
          <span className="text-muted-foreground">Build </span>
          <BuildLink session={plan.eforge_session} onNavigate={onNavigate} />
        </span>
      )}
    </div>
  );
}

/**
 * Disclosure body. Renders only the deeper breakdown (dimensions, open
 * questions, readiness, path). Type/Depth/Profile/Agent profile/Build live in
 * `MetadataSummary` above and are intentionally omitted here.
 */
function DetailsContent({ detail }: { detail: SessionPlanShowResponse }) {
  const { plan, readiness, path } = detail;

  return (
    <div className="space-y-3 rounded-md border border-border bg-background/40 p-3 text-xs">
      {plan.required_dimensions.length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground font-medium">Required dimensions</p>
          <DimensionBadges
            dimensions={plan.required_dimensions}
            variant="outline"
            coveredDimensions={readiness.coveredDimensions}
          />
        </div>
      )}

      {plan.optional_dimensions.length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground font-medium">Optional dimensions</p>
          <DimensionBadges dimensions={plan.optional_dimensions} />
        </div>
      )}

      {plan.skipped_dimensions.length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground font-medium">Skipped dimensions</p>
          <DimensionBadges
            dimensions={plan.skipped_dimensions.map((dimension) => dimension.name)}
          />
        </div>
      )}

      {plan.open_questions.length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground font-medium">Open questions</p>
          <ul className="space-y-1 list-disc list-inside">
            {plan.open_questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </div>
      )}

      {readiness.coveredDimensions.length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground font-medium">Covered dimensions</p>
          <DimensionBadges dimensions={readiness.coveredDimensions} variant="secondary" />
        </div>
      )}

      {!readiness.ready && readiness.missingDimensions.length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground font-medium">Missing dimensions</p>
          <DimensionBadges dimensions={readiness.missingDimensions} variant="destructive" />
        </div>
      )}

      {readiness.skippedDimensions.length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground font-medium">Skipped dimensions (readiness)</p>
          <DimensionBadges dimensions={readiness.skippedDimensions} />
        </div>
      )}

      <div>
        <p className="text-muted-foreground font-medium">Path</p>
        <p className="font-mono break-all mt-0.5">{path}</p>
      </div>
    </div>
  );
}

export function SessionPlanDetail({
  detail,
  status,
  error,
  onNavigate,
}: SessionPlanDetailProps) {
  if (status === 'idle') {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Select a plan to view details.
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

  const { plan, readiness } = detail;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/*
        `key` resets the Collapsible's internal open state when the selected
        plan changes — preferred over a useEffect for clarity.
      */}
      <Collapsible
        key={plan.session}
        className="shrink-0 border-b border-border p-4 pb-3 text-xs"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-semibold truncate">{plan.session}</span>
              <Badge variant="outline" className="text-xs">
                {plan.status}
              </Badge>
              <Badge
                variant={readiness.ready ? 'secondary' : 'outline'}
                className="text-xs"
              >
                {readiness.ready ? 'ready' : 'not ready'}
              </Badge>
            </div>
            {plan.topic && (
              <p className="text-muted-foreground line-clamp-2">{plan.topic}</p>
            )}
            <MetadataSummary plan={plan} onNavigate={onNavigate} />
          </div>

          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs group"
            >
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  'group-data-[state=open]:rotate-180',
                )}
              />
              <span className="group-data-[state=open]:hidden">Show details</span>
              <span className="hidden group-data-[state=open]:inline">Hide details</span>
            </Button>
          </CollapsibleTrigger>
        </div>
        {/*
          Disclosure body is capped relative to viewport so a dense plan
          can't push the markdown preview off-screen. Native scroll matches
          the markdown preview below; both swap Radix ScrollArea for native
          overflow because Radix's viewport breaks `flex-1` height behavior.
        */}
        <CollapsibleContent className="max-h-[40vh] overflow-y-auto pt-2">
          <DetailsContent detail={detail} />
        </CollapsibleContent>
      </Collapsible>

      <div className="flex min-h-0 flex-1 flex-col p-4 pt-3 text-xs">
        <p className="mb-1.5 shrink-0 text-muted-foreground font-medium">Plan body</p>
        {plan.body ? (
          <SessionPlanMarkdownPreview body={plan.body} className="max-h-none flex-1" />
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-md border border-border text-muted-foreground">
            No plan body.
          </div>
        )}
      </div>
    </div>
  );
}
