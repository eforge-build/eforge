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
 * Provider adapter interface for stack management operations.
 *
 * All operations accept a `cwd` (working directory) where the target branch
 * is already checked out. The implementation uses the configured command
 * without requiring shell aliases like `gs`.
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
  trackBranch(cwd: string, base: string): Promise<void>;

  /**
   * Submit the current branch as a pull request.
   */
  submitBranch(cwd: string): Promise<void>;

  /**
   * Submit the entire stack as pull requests.
   */
  submitStack(cwd: string): Promise<void>;

  /**
   * Sync the repo with the remote.
   */
  syncRepo(cwd: string): Promise<void>;

  /**
   * Restack the current branch onto its updated base.
   */
  restackBranch(cwd: string): Promise<void>;

  /**
   * Restack the entire stack onto updated bases.
   */
  restackStack(cwd: string): Promise<void>;

  /**
   * Rebase the current branch's upstack onto a new target.
   */
  upstackOnto(cwd: string, target: string): Promise<void>;
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
