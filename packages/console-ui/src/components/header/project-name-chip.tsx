import * as React from 'react';
import { CONSOLE_NAME } from '@/lib/brand';

interface ProjectNameChipProps {
  basename: string | null;
}

export function ProjectNameChip({ basename }: ProjectNameChipProps) {
  const label = basename ?? CONSOLE_NAME;
  return (
    <span
      className="text-sm font-semibold text-foreground truncate max-w-[12rem]"
      aria-label={`project: ${label}`}
    >
      {label}
    </span>
  );
}
