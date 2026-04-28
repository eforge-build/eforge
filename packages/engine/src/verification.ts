/**
 * Shared verification command extraction utilities.
 * Used by the verify reviewer perspective and any other callers that need
 * to extract verification commands from a plan body.
 */

/**
 * Extract verification commands from a plan body's `## Verification` section,
 * prepend `postMergeCommands`, and optionally filter out test commands for
 * build-only scope.
 *
 * Returns an empty array if the plan body has no `## Verification` section or
 * if no commands are found after filtering.
 *
 * @param planBody - Full markdown plan body
 * @param postMergeCommands - Project-level setup commands to prepend (from config.build.postMergeCommands)
 * @param scope - 'build-only' skips test commands; 'full' runs all commands
 */
export function extractVerificationCommands(
  planBody: string,
  postMergeCommands: string[],
  scope: 'build-only' | 'full',
): string[] {
  // Find the Verification section. The lookahead must terminate at the next
  // `## ` heading or at the true end of the string. `\s*$` with the `m` flag
  // matches the end of *any* line, so use `$(?![\s\S])` (and `\n##\s` instead
  // of `^##\s` so the `m` flag is unnecessary) to anchor only at end-of-input.
  const sectionMatch = planBody.match(/^##\s+Verification\s*\n([\s\S]*?)(?=\n##\s|$(?![\s\S]))/m);
  if (!sectionMatch) return [];

  const section = sectionMatch[1];

  // Extract commands in backticks (pnpm/npm/npx/yarn only)
  const commands: string[] = [];
  const cmdPattern = /`((?:pnpm|npm|npx|yarn)\s+[^`]+)`/g;
  let m;
  while ((m = cmdPattern.exec(section)) !== null) {
    commands.push(m[1].trim());
  }

  // Deduplicate
  const unique = [...new Set(commands)];

  // Filter for build-only: skip test commands
  const filtered = scope === 'build-only'
    ? unique.filter((cmd) => !/\b(test|jest|vitest)\b/.test(cmd))
    : unique;

  // No plan-body verification commands → skip postMergeCommands too (nothing
  // to verify against, so installing dependencies is moot for this phase).
  if (filtered.length === 0) return [];

  // Prepend postMergeCommands so project-level setup runs before verification.
  // Dedup against the extracted commands so a plan that already lists a setup
  // command does not run it twice.
  return [...new Set([...postMergeCommands, ...filtered])];
}
