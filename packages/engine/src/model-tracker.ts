/**
 * ModelTracker — passive accumulator of model IDs observed during a build session.
 *
 * Records unique model identifiers from agent:start events. No I/O, no persistence,
 * no side effects — purely an in-memory Set<string> wrapper.
 *
 * Usage pattern:
 *   const tracker = new ModelTracker();
 *   // as events flow through:
 *   if (event.type === 'agent:start') tracker.record(event.model);
 *   // when composing a commit message:
 *   const message = composeCommitMessage(body, tracker);
 *   // forgeCommit will append Co-Authored-By after the Models-Used trailer
 *
 * See also: composeCommitMessage() below.
 */

export class ModelTracker {
  private readonly models = new Set<string>();

  /** Record a model ID. No-op if already recorded. */
  record(modelId: string): void {
    this.models.add(modelId);
  }

  /** Check whether a model ID has been recorded. */
  has(modelId: string): boolean {
    return this.models.has(modelId);
  }

  /** Number of unique model IDs recorded. */
  get size(): number {
    return this.models.size;
  }

  /** Merge another tracker's models into this one. */
  merge(other: ModelTracker): void {
    for (const id of other.models) {
      this.models.add(id);
    }
  }

  /**
   * Build the Models-Used trailer string.
   * Returns empty string when no models have been recorded.
   * Otherwise returns "Models-Used: <id1>, <id2>" with IDs sorted lexicographically.
   * No backend prefix — bare model IDs only (e.g. "claude-opus-4-5").
   */
  toTrailer(): string {
    if (this.models.size === 0) return '';
    const sorted = Array.from(this.models).sort();
    return `Models-Used: ${sorted.join(', ')}`;
  }
}

// --- eforge:region plan-01-build-artifact-provenance ---
/**
 * Optional settings for composeCommitMessage.
 */
export interface ComposeCommitMessageOptions {
  /**
   * Optional provenance trailer lines to insert before the Models-Used trailer.
   * Each string should be a complete trailer line, e.g.:
   *   "Eforge-Source-PRD: <sha>:<path>"
   * Lines are placed after the body and before Models-Used (when present).
   */
  provenanceTrailers?: string[];
}

/**
 * Build `Eforge-Source-*` trailer lines from build artifact provenance refs.
 *
 * Returns one trailer line per ref in input order. `collectBuildArtifactProvenance()`
 * already returns refs in PRD → orchestration → plan order, so callers that pass
 * its result directly get trailers in that order.
 * Pass the returned array as `options.provenanceTrailers` to `composeCommitMessage`
 * so they are placed before `Models-Used` in the final commit message.
 *
 * Usage:
 *   const trailers = buildProvenanceTrailers(refs);
 *   const msg = composeCommitMessage(body, tracker, { provenanceTrailers: trailers });
 */
export function buildProvenanceTrailers(
  refs: Array<{ kind: string; commitSha: string; path: string }>,
): string[] {
  const lines: string[] = [];
  for (const ref of refs) {
    if (ref.kind === 'prd') {
      lines.push(`Eforge-Source-PRD: ${ref.commitSha}:${ref.path}`);
    } else if (ref.kind === 'orchestration') {
      lines.push(`Eforge-Source-Orchestration: ${ref.commitSha}:${ref.path}`);
    } else if (ref.kind === 'plan') {
      lines.push(`Eforge-Source-Plan: ${ref.commitSha}:${ref.path}`);
    }
  }
  return lines;
}
// --- eforge:endregion plan-01-build-artifact-provenance ---

/**
 * Compose a commit message body with optional provenance trailers and Models-Used trailer.
 *
 * When no trailer data is provided, returns the body unchanged.
 * When non-empty, appends trailers separated from the body by a blank line.
 *
 * Callers pass the result to forgeCommit(), which appends Co-Authored-By after it.
 * Final commit message ordering:
 *   <body>
 *
 *   Eforge-Source-PRD: <sha>:<path>   ← placed here when provenanceTrailers are provided
 *   Eforge-Source-Plan: <sha>:<path>
 *   Models-Used: <id1>, <id2>          ← appended here when tracker is non-empty
 *
 *   Co-Authored-By: forged-by-eforge <noreply@eforge.build>   ← appended by forgeCommit()
 */
export function composeCommitMessage(
  body: string,
  tracker?: ModelTracker,
  // --- eforge:region plan-01-build-artifact-provenance ---
  options?: ComposeCommitMessageOptions,
  // --- eforge:endregion plan-01-build-artifact-provenance ---
): string {
  // --- eforge:region plan-01-build-artifact-provenance ---
  const provenanceTrailers = options?.provenanceTrailers ?? [];
  const hasProvenance = provenanceTrailers.length > 0;
  // --- eforge:endregion plan-01-build-artifact-provenance ---
  const hasModels = tracker && tracker.size > 0;

  // --- eforge:region plan-01-build-artifact-provenance ---
  if (!hasProvenance && !hasModels) return body;

  const trailerLines: string[] = [];
  if (hasProvenance) {
    for (const t of provenanceTrailers) trailerLines.push(t);
  }
  if (hasModels) trailerLines.push(tracker!.toTrailer());

  return `${body}\n\n${trailerLines.join('\n')}`;
  // --- eforge:endregion plan-01-build-artifact-provenance ---
}
