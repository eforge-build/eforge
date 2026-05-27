/**
 * Stack provider interface and factory.
 *
 * Exposes a single provider — git-spice — via a typed interface. The factory
 * accepts the resolved StackingConfig and returns the appropriate adapter.
 * No other providers (native, gh-stack, Graphite, commit-per-PR) are exposed.
 */

import type { StackingConfig } from '../config.js';
import { createGitSpiceAdapter } from './git-spice.js';

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * Metadata returned by a successful provider command invocation.
 *
 * Consumers emit this as a `stack:provider:command` event so the monitor and
 * session log capture the full argv and outcome of every git-spice call.
 */
export interface ProviderCommandResult {
  /** The resolved executable path (never 'gs'). */
  command: string;
  /** The argv passed to the command (without the executable). */
  args: string[];
  /** Captured stdout from the command (may be empty). */
  stdout: string;
  /** Captured stderr from the command (may be empty). */
  stderr: string;
  /** Exit code — always 0 on success (non-zero causes a throw). */
  exitCode: number;
}

/**
 * Provider adapter interface for stack management operations.
 *
 * All operations accept a `cwd` (working directory) where the target branch
 * is already checked out. The implementation uses the configured command
 * without requiring shell aliases like `gs`.
 *
 * Methods return `ProviderCommandResult` so callers can emit
 * `stack:provider:command` events from actual invocations.
 */
export interface StackProviderAdapter {
  /**
   * Verify the provider is available.
   * Throws an actionable error if the command is missing or misconfigured.
   */
  requireAvailable(cwd: string): Promise<void>;

  /**
   * Track the current branch against a base branch.
   * Must be run in a worktree with the target branch checked out.
   */
  trackBranch(cwd: string, base: string): Promise<ProviderCommandResult>;

  /**
   * Submit the current branch as a pull request.
   */
  submitBranch(cwd: string): Promise<ProviderCommandResult>;

  /**
   * Submit the entire stack as pull requests.
   */
  submitStack(cwd: string): Promise<ProviderCommandResult>;

  /**
   * Sync the repo with the remote.
   */
  syncRepo(cwd: string): Promise<ProviderCommandResult>;

  /**
   * Restack the current branch onto its updated base.
   */
  restackBranch(cwd: string): Promise<ProviderCommandResult>;

  /**
   * Restack the entire stack onto updated bases.
   */
  restackStack(cwd: string): Promise<ProviderCommandResult>;

  /**
   * Rebase the current branch's upstack onto a new target.
   */
  upstackOnto(cwd: string, target: string): Promise<ProviderCommandResult>;

  // --- eforge:region plan-01-core-daemon-stack-sync ---
  /**
   * Return the dry-run command preview for the given argv.
   *
   * Returns the command and args the provider would pass to execFile,
   * without executing anything. Used by sync.ts for dry-run records.
   */
  commandPreview(argv: string[]): { command: string; args: string[] };

  /**
   * Extract a PR URL from the provider's stdout output.
   *
   * Returns the first URL found in stdout, or undefined when none is present.
   */
  parsePrUrl(stdout: string): string | undefined;

  /**
   * Returns true when the given string is a valid PR URL for this provider.
   */
  isValidPrUrl(url: string): boolean;

  /**
   * Redact common secret shapes from a provider message before persisting or
   * displaying it.
   */
  redactMessage(message: string): string;
  // --- eforge:endregion plan-01-core-daemon-stack-sync ---
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the appropriate stack provider adapter from the resolved StackingConfig.
 *
 * Only 'git-spice' is supported. No native, gh-stack, Graphite, or
 * commit-per-PR provider is exposed.
 */
export function createProvider(config: StackingConfig): StackProviderAdapter {
  // The provider literal type enforces only 'git-spice' at compile time.
  return createGitSpiceAdapter(config);
}
