/**
 * Provenance metadata for generated reference files.
 *
 * Every generated file begins with a provenance header that records the
 * eforge version and source files. No timestamps or commit hashes are included
 * so byte-identical regeneration remains possible across commits.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ProvenanceInfo {
  eforgeVersion: string;
}

/**
 * Gather provenance information from the repo.
 */
export function gatherProvenance(repoRoot: string): ProvenanceInfo {
  let eforgeVersion = 'unknown';
  try {
    const pkgPath = resolve(repoRoot, 'packages', 'eforge', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    eforgeVersion = pkg.version ?? 'unknown';
  } catch {
    // Ignore — keep 'unknown'
  }

  return { eforgeVersion };
}

/**
 * Build the standard provenance header block for a generated Markdown file.
 *
 * The header uses HTML comments so it is invisible in rendered output but
 * visible in the raw file and diffs.
 */
export function buildProvenanceHeader(opts: {
  sourceFiles: string[];
  eforgeVersion: string;
}): string {
  const sourceList = opts.sourceFiles.join(', ');
  return [
    '<!-- Generated file. Do not edit. -->',
    `<!-- eforge version: ${opts.eforgeVersion} -->`,
    `<!-- Source: ${sourceList} -->`,
    '',
  ].join('\n');
}
