/**
 * Provenance metadata for generated reference files.
 *
 * Every generated file begins with a provenance header that records the
 * source files used to build it. Volatile release metadata such as package
 * versions, timestamps, and commit hashes is intentionally excluded so
 * byte-identical regeneration remains possible across releases.
 */

export type ProvenanceInfo = Record<string, never>;

/**
 * Gather provenance information from the repo.
 */
export function gatherProvenance(_repoRoot: string): ProvenanceInfo {
  return {};
}

/**
 * Build the standard provenance header block for a generated Markdown file.
 *
 * The header uses HTML comments so it is invisible in rendered output but
 * visible in the raw file and diffs.
 */
export function buildProvenanceHeader(opts: { sourceFiles: string[] }): string {
  const sourceList = opts.sourceFiles.join(', ');
  return [
    '<!-- Generated file. Do not edit. -->',
    `<!-- Source: ${sourceList} -->`,
    '',
  ].join('\n');
}
