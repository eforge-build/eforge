/**
 * Selected workspace detail panel for a session plan.
 * Shows metadata, dimensions, readiness detail, and a scrollable markdown preview.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SessionPlanMarkdownPreview } from './session-plan-markdown-preview';
import type { SessionPlanShowResponse } from '@eforge-build/client/browser';

interface SessionPlanDetailProps {
  detail: SessionPlanShowResponse | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  onNavigate?: (href: string) => void;
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

  const { plan, readiness, path } = detail;

  const handleBuildLink = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) => {
    if (onNavigate) {
      e.preventDefault();
      onNavigate(href);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4 text-xs">
        {/* Session ID, lifecycle status, readiness */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold">{plan.session}</span>
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
            <p className="text-muted-foreground">{plan.topic}</p>
          )}
        </div>

        {/* Planning type / depth / profile */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-muted-foreground font-medium">Type</p>
            <p className="font-medium mt-0.5">{plan.planning_type}</p>
          </div>
          <div>
            <p className="text-muted-foreground font-medium">Depth</p>
            <p className="font-medium mt-0.5">{plan.planning_depth}</p>
          </div>
          {plan.profile && (
            <div>
              <p className="text-muted-foreground font-medium">Profile</p>
              <p className="font-medium mt-0.5">{plan.profile}</p>
            </div>
          )}
          {plan.agent_profile && (
            <div>
              <p className="text-muted-foreground font-medium">Agent profile</p>
              <p className="font-medium mt-0.5">{plan.agent_profile}</p>
            </div>
          )}
        </div>

        {/* Required dimensions */}
        {plan.required_dimensions.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">Required dimensions</p>
            <div className="flex flex-wrap gap-1">
              {plan.required_dimensions.map((d) => (
                <Badge
                  key={d}
                  variant={readiness.coveredDimensions.includes(d) ? 'secondary' : 'outline'}
                  className="text-xs"
                >
                  {d}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Optional dimensions */}
        {plan.optional_dimensions.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">Optional dimensions</p>
            <div className="flex flex-wrap gap-1">
              {plan.optional_dimensions.map((d) => (
                <Badge key={d} variant="outline" className="text-xs">
                  {d}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Skipped dimensions */}
        {plan.skipped_dimensions.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">Skipped dimensions</p>
            <div className="flex flex-wrap gap-1">
              {plan.skipped_dimensions.map((d) => (
                <Badge key={d.name} variant="outline" className="text-xs">
                  {d.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Open questions */}
        {plan.open_questions.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">Open questions</p>
            <ul className="space-y-1 list-disc list-inside">
              {plan.open_questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Readiness detail: covered dimensions */}
        {readiness.coveredDimensions.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">Covered dimensions</p>
            <div className="flex flex-wrap gap-1">
              {readiness.coveredDimensions.map((d) => (
                <Badge key={d} variant="secondary" className="text-xs">
                  {d}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Readiness detail: missing dimensions */}
        {!readiness.ready && readiness.missingDimensions.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">Missing dimensions</p>
            <div className="flex flex-wrap gap-1">
              {readiness.missingDimensions.map((d) => (
                <Badge key={d} variant="destructive" className="text-xs">
                  {d}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Readiness detail: skipped dimensions */}
        {readiness.skippedDimensions.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">Skipped dimensions (readiness)</p>
            <div className="flex flex-wrap gap-1">
              {readiness.skippedDimensions.map((d) => (
                <Badge key={d} variant="outline" className="text-xs">
                  {d}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Path */}
        <div>
          <p className="text-muted-foreground font-medium">Path</p>
          <p className="font-mono break-all mt-0.5">{path}</p>
        </div>

        {/* Build session link */}
        {plan.eforge_session && (
          <div>
            <p className="text-muted-foreground font-medium">Build session</p>
            <a
              href={`/console/runs/${plan.eforge_session}`}
              onClick={(e) =>
                handleBuildLink(e, `/console/runs/${plan.eforge_session!}`)
              }
              className="font-mono text-primary hover:underline break-all mt-0.5 inline-block"
            >
              {plan.eforge_session}
            </a>
          </div>
        )}

        {/* Markdown preview */}
        {plan.body && (
          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">Plan body</p>
            <SessionPlanMarkdownPreview body={plan.body} />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
