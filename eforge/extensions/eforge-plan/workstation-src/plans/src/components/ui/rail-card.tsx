import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface RailCardProps {
  icon?: LucideIcon;
  iconClassName?: string;
  title: React.ReactNode;
  /** Trailing header content (badge, button); the caller adds `ml-auto`. */
  action?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  /** Extra header content below the title row (e.g. a chip strip). */
  headerExtra?: React.ReactNode;
  'aria-label'?: string;
  children: React.ReactNode;
}

/**
 * The shared rail/section shell. Collapses the `CardHeader pb-2 + CardTitle flex
 * items-center gap-2 text-sm + icon` block that every rail (plan context, review,
 * recommendations, selection, activity) and the roadmap rail used to re-declare.
 */
export function RailCard({ icon: Icon, iconClassName, title, action, className, contentClassName, headerExtra, children, ...rest }: RailCardProps) {
  return (
    <Card className={className} aria-label={rest['aria-label']}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {Icon && <Icon className={cn('h-4 w-4 text-muted-foreground', iconClassName)} />}
          {title}
          {action}
        </CardTitle>
        {headerExtra}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}
