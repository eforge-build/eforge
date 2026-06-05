export interface BoundedTextResult {
  text: string;
  truncated: boolean;
}

export interface BoundedListResult<T> {
  items: T[];
  omittedCount: number;
}

export function truncationMarker(originalChars: number, retainedChars: number, label?: string): string {
  const suffix = label ? `: ${label}` : '';
  return `[truncated from ${originalChars} chars to ${retainedChars} chars${suffix}]`;
}

export function omissionMarker(originalChars: number, label: string): string {
  return `[omitted ${originalChars} chars: ${label}]`;
}

export function truncateText(input: string, maxChars: number, label?: string): BoundedTextResult {
  if (input.length <= maxChars) {
    return { text: input, truncated: false };
  }

  const marker = truncationMarker(input.length, maxChars, label);
  if (maxChars <= 0) {
    return { text: omissionMarker(input.length, label ?? 'text exceeded budget'), truncated: true };
  }
  if (marker.length >= maxChars) {
    return { text: marker.slice(0, maxChars), truncated: true };
  }

  const previewChars = maxChars - marker.length - 1;
  return {
    text: `${input.slice(0, previewChars)}\n${marker}`,
    truncated: true,
  };
}

export function truncateMiddleText(input: string, maxChars: number, label?: string): BoundedTextResult {
  if (input.length <= maxChars) {
    return { text: input, truncated: false };
  }

  const marker = truncationMarker(input.length, maxChars, label);
  if (maxChars <= 0) {
    return { text: omissionMarker(input.length, label ?? 'text exceeded budget'), truncated: true };
  }
  if (marker.length + 2 >= maxChars) {
    return { text: marker.slice(0, maxChars), truncated: true };
  }

  const previewChars = maxChars - marker.length - 2;
  const headChars = Math.ceil(previewChars / 2);
  const tailChars = Math.floor(previewChars / 2);
  return {
    text: `${input.slice(0, headChars)}\n${marker}\n${input.slice(input.length - tailChars)}`,
    truncated: true,
  };
}

export function boundList<T>(items: readonly T[], maxItems: number): BoundedListResult<T> {
  if (items.length <= maxItems) {
    return { items: [...items], omittedCount: 0 };
  }

  return {
    items: items.slice(0, Math.max(0, maxItems)),
    omittedCount: items.length - Math.max(0, maxItems),
  };
}
