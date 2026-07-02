/**
 * Shared constants and helpers for mutation tool names and denylist expansion/merging
 * across Claude SDK and Pi harnesses.
 *
 * Mutation tools are those that can write or modify files. Keeping this list
 * centralised ensures that build reviewers, compile reviewers, and evaluators
 * all agree on what constitutes a "mutating" tool regardless of which harness
 * is in use.
 */

/**
 * Claude SDK (PascalCase) names of tools that write or mutate files.
 * These are used directly in `disallowedTools` for the Claude SDK harness.
 */
export const MUTATION_TOOL_DENYLIST_CLAUDE = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
] as const;

/**
 * The Task tool, which spawns subagents. Kept separate so callers can opt in
 * (e.g. read-only reviewers that also block subagents) or opt out (e.g. compile
 * reviewers that use a custom submission tool but still need to block File writes).
 */
export const SUBAGENT_TOOL_DENYLIST = ['Task'] as const;

/**
 * Pi (lowercase) names of tools that write or mutate files.
 * Pi uses lowercase tool names unlike the Claude SDK's PascalCase convention.
 */
export const MUTATION_TOOL_DENYLIST_PI = ['write', 'edit', 'bash'] as const;

/**
 * Map from Claude SDK PascalCase tool names to their Pi lowercase equivalents.
 * MultiEdit maps to `edit` (Pi has a single edit tool).
 * NotebookEdit maps to `edit` as Pi has no separate notebook tool.
 */
const CLAUDE_TO_PI_ALIASES: Readonly<Record<string, string>> = {
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Bash: 'bash',
};

/**
 * Expand a disallowed-tools list to include Pi-lowercase equivalents for
 * every Claude SDK PascalCase mutation tool it contains.
 *
 * Used in the Pi harness so that a caller who sets
 * `disallowedTools: ['Write', 'Edit', 'Bash']` (as they would for Claude SDK)
 * automatically also blocks `write`, `edit`, and `bash` in Pi without
 * requiring separate per-harness callsites.
 *
 * Returns a new array (never mutates the input). Duplicates are removed via Set.
 */
export function expandDisallowedToolAliasesForPi(disallowedTools: readonly string[]): string[] {
  const expanded = new Set<string>(disallowedTools);
  for (const tool of disallowedTools) {
    const piAlias = CLAUDE_TO_PI_ALIASES[tool];
    if (piAlias !== undefined) {
      expanded.add(piAlias);
    }
  }
  return Array.from(expanded);
}

/**
 * Merge an existing `disallowedTools` list with the shared mutation denylist
 * (both Claude SDK and Pi names) and optionally the subagent denylist.
 *
 * This is the single entry point for building the denylist for any agent that
 * must not mutate files. Use it in:
 *
 *  - Build reviewers (before switching to `tools: 'read-only'`, the harness
 *    also calls this on the effective denylist for belt-and-suspenders safety).
 *  - Compile reviewers (plan-reviewer, planning-quality reviewer)
 *    which keep `tools: 'coding'` but must still block file writes.
 *  - Evaluators (builder.ts, plan-evaluator.ts) which must not write files.
 *
 * Returns a new deduplicated array.
 */
export function mergeMutationDisallowedTools(
  existing?: readonly string[],
  options?: { includeSubagent?: boolean },
): string[] {
  const acc = new Set<string>(existing ?? []);
  for (const tool of MUTATION_TOOL_DENYLIST_CLAUDE) {
    acc.add(tool);
  }
  for (const tool of MUTATION_TOOL_DENYLIST_PI) {
    acc.add(tool);
  }
  if (options?.includeSubagent) {
    for (const tool of SUBAGENT_TOOL_DENYLIST) {
      acc.add(tool);
    }
  }
  return Array.from(acc);
}
