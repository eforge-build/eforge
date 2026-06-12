// Shared formatting helpers for session-plan dimensions and sections.
//
// A dimension name is kebab-case (e.g. `acceptance-criteria`). The matching
// section key stored in `plan.sections` is the lowercased title with spaces
// (e.g. `acceptance criteria`) — see `dimensionToSectionKey` in the engine.

/** Match backend revision dimension normalization. */
export function normalizeDimension(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** `acceptance-criteria` -> `acceptance criteria` (the `plan.sections` key). */
export function dimensionToSectionKey(dimension: string): string {
  return normalizeDimension(dimension).replace(/-/g, ' ');
}

/** `acceptance-criteria` or `acceptance criteria` -> `Acceptance Criteria`. */
export function titleCase(value: string): string {
  return value
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Read a section body from a plan by dimension name, regardless of key casing. */
export function sectionContent(sections: Record<string, string> | undefined, dimension: string): string {
  if (!sections) return '';
  const normalized = normalizeDimension(dimension);
  return sections[dimensionToSectionKey(normalized)] ?? sections[normalized] ?? sections[dimension] ?? '';
}
