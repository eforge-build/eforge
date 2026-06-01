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

export type StackProviderErrorKind =
  | 'recoverable-conflict'
  | 'provider-failure'
  | 'auth'
  | 'network'
  | 'tooling'
  | 'unknown';

export type StackProviderOperationKind = 'branch-restack' | 'stack-restack' | 'repo-sync' | 'unknown';
export type StackProviderConflictKind = 'git-rebase' | 'git-merge' | 'unknown';

export interface StackProviderErrorClassification {
  kind: StackProviderErrorKind;
  operation: StackProviderOperationKind;
  conflictKind?: StackProviderConflictKind;
  message: string;
  recoverable: boolean;
}

export interface StackProviderInterruptedOperation {
  operation: StackProviderOperationKind;
  conflictKind: StackProviderConflictKind;
  branch?: string;
  conflictedFiles: string[];
  conflictDiff: string;
  providerError?: {
    command?: string;
    args?: string[];
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
  };
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

  /**
   * Return the dry-run command preview for the given argv.
   *
   * Returns the command and args the provider would pass to execFile,
   * without executing anything. Used by sync.ts for dry-run records.
   */
  commandPreview(argv: string[]): { command: string; args: string[] };

  /**
   * Return the dry-run command preview for `repo sync` without executing it.
   */
  syncRepoPreview(): { command: string; args: string[] };

  /**
   * Return the dry-run command preview for `stack restack` without executing it.
   */
  restackStackPreview(): { command: string; args: string[] };

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

  /** Classify provider errors without exposing provider-specific orchestration details. */
  classifyError?(cwd: string, err: unknown): Promise<StackProviderErrorClassification>;

  /** Discover the active interrupted operation, if the provider left one behind. */
  getInterruptedOperation?(
    cwd: string,
    classification: StackProviderErrorClassification,
  ): Promise<StackProviderInterruptedOperation | undefined>;

  /** Continue the interrupted operation after conflicts have been resolved. */
  continueInterruptedOperation?(
    cwd: string,
    operation: StackProviderInterruptedOperation,
  ): Promise<ProviderCommandResult>;

  /** Abort the interrupted operation after recovery fails. */
  abortInterruptedOperation?(
    cwd: string,
    operation: StackProviderInterruptedOperation,
  ): Promise<ProviderCommandResult>;
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
