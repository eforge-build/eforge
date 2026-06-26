import * as React from 'react';
import { formatRelativeTime } from '@/lib/format-time';
import { TIMESTAMP_PLACEHOLDER, normalizeTimestamp } from '@/lib/plan-timestamps';

interface TimestampProps {
  value?: string | null;
  placeholder?: string;
  className?: string;
  prefix?: string;
}

/**
 * Relative timestamp with exact ISO access. Invalid/missing projection values are
 * intentionally rendered as placeholders so raw null/undefined/invalid strings
 * never leak into the workstation UI.
 */
export function Timestamp({ value, placeholder = TIMESTAMP_PLACEHOLDER, className, prefix }: TimestampProps) {
  const iso = normalizeTimestamp(value);
  if (!iso) return <span className={className}>{placeholder}</span>;
  const relative = formatRelativeTime(iso) ?? placeholder;
  return <time className={className} dateTime={iso} title={iso}>{prefix ? `${prefix} ${relative}` : relative}</time>;
}
