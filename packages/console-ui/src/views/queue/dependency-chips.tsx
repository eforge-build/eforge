import * as React from 'react';
import { Badge } from '@/components/ui/badge';

interface DependencyChipsProps {
  dependsOn: string[];
}

/**
 * Display-only chips for `dependsOn` dependency ids. No add/remove controls.
 */
export function DependencyChips({ dependsOn }: DependencyChipsProps) {
  if (dependsOn.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1" aria-label="Dependencies">
      {dependsOn.map((depId) => (
        <Badge key={depId} variant="outline" className="text-xs px-1.5 py-0 font-mono">
          {depId}
        </Badge>
      ))}
    </div>
  );
}
