// --- eforge:region plan-03-stack-daemon-ui ---
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { StackLayerWire } from '@/lib/types';

interface StackLayersCardProps {
  layers: StackLayerWire[];
}

function layerStatusVariant(
  status: StackLayerWire['status'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'landed':
    case 'merged':
      return 'default';
    case 'building':
    case 'built':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

function landingStatusVariant(
  status: string | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!status) return 'outline';
  switch (status) {
    case 'complete':
      return 'default';
    case 'started':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function StackLayersCard({ layers }: StackLayersCardProps) {
  if (layers.length === 0) return null;

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Stack Layers</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-3">
          {layers.map((layer) => (
            <div
              key={layer.prdId}
              className="flex flex-col gap-1.5 rounded-md border px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-medium truncate" title={layer.prdId}>
                  {layer.prdId}
                </span>
                <Badge variant={layerStatusVariant(layer.status)} className="shrink-0 text-xs">
                  {layer.status}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  <span className="font-medium">stack:</span>{' '}
                  <span className="font-mono">{layer.stackId}</span>
                </span>
                <span>
                  <span className="font-medium">provider:</span> {layer.provider}
                </span>
                <span>
                  <span className="font-medium">branch:</span>{' '}
                  <span className="font-mono">{layer.branch}</span>
                </span>
                {layer.baseBranch && (
                  <span>
                    <span className="font-medium">base:</span>{' '}
                    <span className="font-mono">{layer.baseBranch}</span>
                  </span>
                )}
                {layer.parentPrdId && (
                  <span>
                    <span className="font-medium">parent:</span>{' '}
                    <span className="font-mono">{layer.parentPrdId}</span>
                  </span>
                )}
                {layer.artifact && (
                  <span>
                    <span className="font-medium">artifact:</span>{' '}
                    <span className="font-mono">{layer.artifact.branch}</span>
                  </span>
                )}
                {layer.artifact?.prUrl && !layer.landing?.prUrl && (
                  <a
                    href={layer.artifact.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline truncate max-w-[200px]"
                    title={layer.artifact.prUrl}
                  >
                    {layer.artifact.prUrl}
                  </a>
                )}
              </div>

              {layer.landing && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground font-medium">landing:</span>
                  <Badge
                    variant={landingStatusVariant(layer.landing.status)}
                    className="text-xs"
                  >
                    {layer.landing.action} - {layer.landing.status}
                  </Badge>
                  {layer.landing.prUrl && (
                    <a
                      href={layer.landing.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-primary hover:underline truncate max-w-[200px]"
                      title={layer.landing.prUrl}
                    >
                      {layer.landing.prUrl}
                    </a>
                  )}
                  {layer.landing.reason && !layer.landing.prUrl && (
                    <span className="text-muted-foreground italic">{layer.landing.reason}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
// --- eforge:endregion plan-03-stack-daemon-ui ---
