/**
 * PRD display-label normalization and supporting slug helpers.
 *
 * `selectPrdDisplayLabel` derives a human-readable label from an optional
 * explicit title and a slug-like PRD identifier. Markdown-shaped titles are
 * rejected in favour of slug-derived labels, and known acronyms are preserved
 * in uppercase throughout.
 */

// ---------------------------------------------------------------------------
// Preserved acronyms
// ---------------------------------------------------------------------------

/** Acronyms that must remain all-uppercase after title-casing a slug. */
const PRESERVED_ACRONYMS = new Set(['PRD', 'UI', 'MCP', 'CLI', 'API']);

// ---------------------------------------------------------------------------
// Markdown detection
// ---------------------------------------------------------------------------

/**
 * Return true when `title` looks like a raw Markdown string rather than a
 * clean human-readable title.
 *
 * Rejects strings that:
 * - Start with one or more `#` heading markers (e.g. `# Title`)
 * - Contain bold/italic markers (`**`, `__`, `*`, `_` followed by word chars)
 * - Contain inline code backticks
 * - Contain Markdown link syntax `[text](url)`
 */
function isMarkdownShaped(title: string): boolean {
  const trimmed = title.trim();
  // Heading: starts with one or more # characters
  if (/^#+\s/.test(trimmed)) return true;
  // Bold / italic markers
  if (/\*\*|\*[^\s]|__/.test(trimmed)) return true;
  // Inline code
  if (/`/.test(trimmed)) return true;
  // Markdown links
  if (/\[.+\]\(.+\)/.test(trimmed)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Slug title-casing
// ---------------------------------------------------------------------------

/**
 * Convert a slug string (hyphen/underscore-separated words) to a
 * title-cased display label, preserving known acronyms as all-uppercase.
 *
 * Examples:
 *   "add-mcp-server-support"  -> "Add MCP Server Support"
 *   "fix_api_auth"            -> "Fix API Auth"
 *   "refactor-ui-layout"      -> "Refactor UI Layout"
 */
export function slugToDisplayLabel(slug: string): string {
  // Strip a leading timestamp prefix like "20240101-" or "2024-01-01-"
  const withoutTimestamp = slug.replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_]/, '');
  // Strip common file extensions
  const withoutExtension = withoutTimestamp.replace(/\.(md|txt|yaml|yml|json)$/i, '');

  const words = withoutExtension.split(/[-_]+/).filter(Boolean);

  return words
    .map((word) => {
      const upper = word.toUpperCase();
      if (PRESERVED_ACRONYMS.has(upper)) return upper;
      // Title-case: uppercase first char, lowercase rest
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable display label for a PRD.
 *
 * Resolution order:
 * 1. If `title` is present, non-empty, and not markdown-shaped, use it as-is.
 * 2. Otherwise derive from `id` via slug title-casing with acronym preservation.
 *
 * @param title - Optional explicit title from the PRD metadata.
 * @param id    - The PRD identifier (typically a filename slug, e.g. "add-mcp-server").
 * @returns     A non-empty string suitable for display in the Console UI.
 */
export function selectPrdDisplayLabel(title: string | undefined | null, id: string): string {
  if (title && title.trim().length > 0 && !isMarkdownShaped(title)) {
    return title.trim();
  }
  const fromSlug = slugToDisplayLabel(id);
  if (fromSlug && fromSlug.trim().length > 0) return fromSlug;
  const rawId = id ? id.trim() : '';
  return rawId.length > 0 ? rawId : 'Untitled PRD';
}
