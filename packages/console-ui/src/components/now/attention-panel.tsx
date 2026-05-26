import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NowAttentionItem } from '@/lib/selectors/now';

interface AttentionPanelProps {
  items: NowAttentionItem[];
  hiddenCount: number;
}

const SEVERITY_VARIANT: Record<
  NowAttentionItem['severity'],
  'destructive' | 'default' | 'secondary' | 'outline'
> = {
  critical: 'destructive',
  warning: 'default',
  info: 'secondary',
};

export function AttentionPanel({ items, hiddenCount }: AttentionPanelProps) {
  if (items.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold">Attention</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <Badge
                variant={SEVERITY_VARIANT[item.severity]}
                className="mt-0.5 shrink-0 capitalize"
              >
                {item.severity}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm text-foreground">{item.message}</p>
                {item.detail && (
                  <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
        {hiddenCount > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            + {hiddenCount} more item{hiddenCount > 1 ? 's' : ''} hidden
          </p>
        )}
      </CardContent>
    </Card>
  );
}
