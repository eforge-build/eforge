/**
 * Stack artifacts section — reference list of stack layers grouped by stack,
 * surfacing each landed PRD's branch and pull request link.
 *
 * This is the durable record of where each built PRD sits in the git-spice
 * stack. It lives under System (not the Now dashboard) because it is reference
 * data: a failed land is already reported as a failed build, so the only
 * non-redundant value here is navigation — jumping to the branch or PR for a
 * landed PRD.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { SystemSection } from './system-section';
import type { StackLayerWire } from '@eforge-build/client/browser';

interface StackArtifactsSectionProps {
  layers?: StackLayerWire[];
}

interface StackGroup {
  stackId: string;
  layers: StackLayerWire[];
}

function prUrlOf(layer: StackLayerWire): string | undefined {
  return layer.landing?.prUrl ?? layer.artifact?.prUrl;
}

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toLowerCase();
  if (s === 'failed') return 'destructive';
  if (s === 'landed' || s === 'merged' || s === 'built') return 'secondary';
  if (s === 'building') return 'default';
  return 'outline';
}

/** Group layers by stackId, preserving first-seen order for both groups and rows. */
function groupByStack(layers: StackLayerWire[]): StackGroup[] {
  const order: string[] = [];
  const byId = new Map<string, StackLayerWire[]>();
  for (const layer of layers) {
    const existing = byId.get(layer.stackId);
    if (existing) {
      existing.push(layer);
    } else {
      byId.set(layer.stackId, [layer]);
      order.push(layer.stackId);
    }
  }
  return order.map((stackId) => ({ stackId, layers: byId.get(stackId)! }));
}

export function StackArtifactsSection({ layers = [] }: StackArtifactsSectionProps) {
  const groups = React.useMemo(() => groupByStack(layers), [layers]);
  const isEmpty = layers.length === 0;

  return (
    <SystemSection
      title="Stack artifacts"
      description="Landed PRDs and their branches and pull requests, grouped by stack."
      empty={isEmpty}
      emptyText="No stack layers recorded"
    >
      <div className="space-y-4 text-xs">
        {groups.map((group) => (
          <div key={group.stackId} className="space-y-1.5">
            <p className="font-mono font-medium text-muted-foreground">stack {group.stackId}</p>
            <ul className="space-y-1.5">
              {group.layers.map((layer) => {
                const pr = prUrlOf(layer);
                return (
                  <li key={layer.prdId} className="flex items-start gap-2">
                    <Badge variant={statusVariant(layer.status)} className="shrink-0 capitalize text-xs">
                      {layer.status}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-foreground truncate">{layer.prdId}</p>
                      <p className="font-mono text-muted-foreground truncate">
                        {layer.branch}
                        {layer.baseBranch && ` ← ${layer.baseBranch}`}
                      </p>
                    </div>
                    {pr && (
                      <a
                        href={pr}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-primary hover:underline"
                      >
                        PR ↗
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </SystemSection>
  );
}
