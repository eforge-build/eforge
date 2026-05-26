/**
 * Small collapsed JSON renderer for opaque config/profile data.
 * Uses a deterministic JSON.stringify output with 2-space indentation.
 */
import * as React from 'react';

interface JsonDetailsProps {
  label: string;
  value: unknown;
}

export function JsonDetails({ label, value }: JsonDetailsProps) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none">
        {label}
      </summary>
      <pre className="mt-2 p-2 rounded bg-muted text-xs overflow-auto max-h-64 whitespace-pre-wrap break-all">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
