/**
 * Build artifact provenance — Git history lookup, GitHub remote parsing,
 * and PR section rendering for committed plan/PRD artifacts.
 *
 * All functions are best-effort: lookup failures omit the affected row rather
 * than propagating errors into the landing flow.
 *
 * Key design rules:
 *   - Provenance links use a commit SHA plus path, never a branch-relative path.
 *   - GitHub web URLs are generated only when a GitHub remote URL can be parsed.
 *   - The fallback reference is always `git show <sha>:<path>`.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// --- eforge:region types ---
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BuildArtifactKind = 'prd' | 'orchestration' | 'plan';

export interface BuildArtifactProvenanceRef {
  /** Artifact category. */
  kind: BuildArtifactKind;
  /** Human-readable label for the PR row. */
  label: string;
  /** Repository-relative POSIX path to the artifact. */
  path: string;
  /** SHA of the latest add-or-modify commit for this artifact. */
  commitSha: string;
  /** Host-agnostic fallback recovery command, e.g. `git show <sha>:<path>`. */
  gitShowRef: string;
  /** GitHub blob URL when a GitHub remote could be parsed; otherwise absent. */
  webUrl?: string;
}

// --- eforge:endregion types ---

// --- eforge:region github-remote-parsing ---
// ---------------------------------------------------------------------------
// GitHub remote URL parsing
// ---------------------------------------------------------------------------

/**
 * Parse a `owner/repo` pair from a GitHub remote URL.
 *
 * Supported URL forms:
 *   - HTTPS:        https://github.com/owner/repo[.git]
 *   - git+https:    git+https://github.com/owner/repo[.git]
 *   - scp-like SSH: git@github.com:owner/repo[.git]
 *   - ssh:// URL:   ssh://git@github.com/owner/repo[.git]
 *
 * Returns undefined when the URL is not a recognized GitHub remote.
 */
export function parseGitHubRepoFromRemote(remoteUrl: string): string | undefined {
  if (!remoteUrl) return undefined;
  const url = remoteUrl.trim();

  // HTTPS and git+https: https://github.com/owner/repo[.git]
  const httpsMatch = url.match(/^(?:git\+)?https?:\/\/github\.com\/([^/]+\/[^/?#]+?)(?:\.git)?\/?$/);
  if (httpsMatch) return httpsMatch[1];

  // scp-like SSH: git@github.com:owner/repo[.git]
  const scpMatch = url.match(/^git@github\.com:([^/]+\/[^/?#]+?)(?:\.git)?$/);
  if (scpMatch) return scpMatch[1];

  // ssh:// URL: ssh://git@github.com/owner/repo[.git]
  const sshMatch = url.match(/^ssh:\/\/git@github\.com\/([^/]+\/[^/?#]+?)(?:\.git)?\/?$/);
  if (sshMatch) return sshMatch[1];

  return undefined;
}

// --- eforge:endregion github-remote-parsing ---

// --- eforge:region git-history-helpers ---
// ---------------------------------------------------------------------------
// Git history helpers
// ---------------------------------------------------------------------------

/**
 * Return the latest commit SHA that added or modified `relPath`.
 * Deletion commits are excluded via `--diff-filter=AM`.
 * Returns undefined when no such commit exists or on any error.
 */
async function getLatestAddOrModifyCommit(cwd: string, relPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec(
      'git',
      ['log', '--diff-filter=AM', '--format=%H', '-1', '--', relPath],
      { cwd },
    );
    const sha = stdout.trim();
    return sha.length === 40 ? sha : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verify that `git show <sha>:<relPath>` exits 0 (the object is readable).
 * Returns false on any error.
 */
async function isReadable(cwd: string, sha: string, relPath: string): Promise<boolean> {
  try {
    await exec('git', ['show', `${sha}:${relPath}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Discover all artifact paths that were ever added or modified under
 * `${outputDir}/${planSetName}/`, filtered to `orchestration.yaml` and `.md` files.
 * Returns a deduplicated list of repository-relative POSIX paths.
 */
async function discoverPlanSetArtifactPaths(
  cwd: string,
  outputDir: string,
  planSetName: string,
): Promise<string[]> {
  const normalizedOutput = outputDir.replace(/\/$/, '');
  const prefix = `${normalizedOutput}/${planSetName}/`;

  try {
    const { stdout } = await exec(
      'git',
      [
        'log',
        '--diff-filter=AM',
        '--name-only',
        '--format=',
        '--',
        prefix,
      ],
      { cwd },
    );

    const seen = new Set<string>();
    const paths: string[] = [];

    for (const line of stdout.split('\n')) {
      const raw = line.trim();
      if (!raw) continue;
      // Normalize each discovered path before the prefix filter
      const trimmed = normalizePath(raw);
      // Safety filter: only accept paths under the plan-set directory
      if (!trimmed.startsWith(prefix)) continue;

      const filename = trimmed.split('/').pop() ?? '';
      if (filename !== 'orchestration.yaml' && !filename.endsWith('.md')) continue;

      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        paths.push(trimmed);
      }
    }

    return paths;
  } catch {
    return [];
  }
}

/**
 * Resolve the remote URL for `origin` (or the provided remote name).
 * Returns undefined on any error or when the remote has no URL.
 */
async function resolveRemoteUrl(cwd: string, remote = 'origin'): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git', ['remote', 'get-url', remote], { cwd });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

// --- eforge:endregion git-history-helpers ---

// --- eforge:region path-normalization ---
// ---------------------------------------------------------------------------
// Path normalization helpers
// ---------------------------------------------------------------------------

/**
 * Normalize an artifact path to a repository-relative POSIX path:
 *   - Converts backslashes to forward slashes
 *   - Strips leading `./`
 *   - Removes trailing slashes
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/$/, '');
}

// --- eforge:endregion path-normalization ---

// --- eforge:region provenance-collection ---
// ---------------------------------------------------------------------------
// Provenance collection
// ---------------------------------------------------------------------------

/**
 * Collect build artifact provenance references for a plan set.
 *
 * Discovers PRD, orchestration, and compiled plan files from Git history,
 * resolves their latest non-deletion commit SHAs, and returns commit-pinned
 * artifact references. Best-effort: any per-row failure omits only that row.
 *
 * All input paths (`outputDir`, `prdArtifactPath`) are normalized to
 * repository-relative POSIX paths before use in Git lookups and rendering.
 *
 * Rows are returned in this order:
 *   1. PRD artifact (when `prdArtifactPath` is provided and has commits)
 *   2. orchestration.yaml (sorted by path)
 *   3. Compiled .md plan files (sorted by path)
 */
export async function collectBuildArtifactProvenance(
  cwd: string,
  input: {
    planSetName: string;
    outputDir: string;
    prdArtifactPath?: string;
    remote?: string;
  },
): Promise<BuildArtifactProvenanceRef[]> {
  const { planSetName, remote } = input;
  // Normalize all input paths to repo-relative POSIX before any Git operations
  const outputDir = normalizePath(input.outputDir);
  const prdArtifactPath = input.prdArtifactPath !== undefined
    ? normalizePath(input.prdArtifactPath)
    : undefined;
  const refs: BuildArtifactProvenanceRef[] = [];

  try {
    // Resolve GitHub remote URL for web URL rendering (best-effort)
    let ghRepo: string | undefined;
    try {
      const remoteUrl = await resolveRemoteUrl(cwd, remote ?? 'origin');
      if (remoteUrl) ghRepo = parseGitHubRepoFromRemote(remoteUrl);
    } catch {
      // Best-effort: proceed without web URLs
    }

    // Helper to build a single provenance ref
    const buildRef = (
      kind: BuildArtifactKind,
      label: string,
      path: string,
      sha: string,
    ): BuildArtifactProvenanceRef => {
      const gitShowRef = `git show ${sha}:${path}`;
      const webUrl = ghRepo
        ? `https://github.com/${ghRepo}/blob/${sha}/${path}`
        : undefined;
      return { kind, label, path, commitSha: sha, gitShowRef, webUrl };
    };

    // 1. PRD artifact
    if (prdArtifactPath) {
      try {
        const sha = await getLatestAddOrModifyCommit(cwd, prdArtifactPath);
        if (sha && (await isReadable(cwd, sha, prdArtifactPath))) {
          refs.push(buildRef('prd', 'Normalized PRD', prdArtifactPath, sha));
        }
      } catch {
        // Best-effort: skip this row
      }
    }

    // 2 & 3. Plan-set artifacts (orchestration.yaml + .md files)
    try {
      const planPaths = await discoverPlanSetArtifactPaths(cwd, outputDir, planSetName);

      const orchestrationPaths = planPaths
        .filter((p) => p.split('/').pop() === 'orchestration.yaml')
        .sort();
      const mdPaths = planPaths.filter((p) => p.endsWith('.md')).sort();

      for (const path of orchestrationPaths) {
        try {
          const sha = await getLatestAddOrModifyCommit(cwd, path);
          if (sha && (await isReadable(cwd, sha, path))) {
            refs.push(buildRef('orchestration', 'Orchestration', path, sha));
          }
        } catch {
          // Best-effort: skip this row
        }
      }

      for (const path of mdPaths) {
        try {
          const sha = await getLatestAddOrModifyCommit(cwd, path);
          if (sha && (await isReadable(cwd, sha, path))) {
            refs.push(buildRef('plan', 'Plan', path, sha));
          }
        } catch {
          // Best-effort: skip this row
        }
      }
    } catch {
      // Best-effort: skip plan artifacts
    }
  } catch {
    // Top-level catch: return already-collected refs or empty array
  }

  return refs;
}

// --- eforge:endregion provenance-collection ---

// --- eforge:region pr-section-rendering ---
// ---------------------------------------------------------------------------
// PR section rendering
// ---------------------------------------------------------------------------

/**
 * Render a `## Eforge provenance` markdown section from provenance refs.
 *
 * Each row uses the GitHub blob URL when available, with a fallback
 * `git show <sha>:<path>` command reference. Branch names are never used
 * in artifact links — only commit SHAs appear in URLs.
 *
 * Returns an empty string when refs is empty (no section emitted).
 */
export function renderProvenanceSection(refs: BuildArtifactProvenanceRef[]): string {
  if (refs.length === 0) return '';

  const lines: string[] = ['## Eforge provenance'];
  for (const ref of refs) {
    const fallback = `\`${ref.gitShowRef}\``;
    if (ref.webUrl) {
      lines.push(`- ${ref.label}: [${ref.path}](${ref.webUrl}) (${fallback})`);
    } else {
      lines.push(`- ${ref.label}: ${fallback}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
// --- eforge:endregion pr-section-rendering ---
