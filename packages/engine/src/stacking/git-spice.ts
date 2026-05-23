/**
 * Git-spice provider adapter.
 *
 * Wraps git-spice commands for branch tracking, submission, sync, and restack.
 * Uses execFile with an argv array — no shell interpolation.
 *
 * The command defaults to 'git-spice'; a configured override is used when set.
 * Never uses the 'gs' alias.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when git-spice is not available or not configured correctly.
 *
 * The message always mentions 'git-spice' (the canonical command name) and
 * 'stacking.gitSpice.command' (the config key for overriding the executable
 * path) so callers receive actionable remediation guidance.
 */
export class GitSpiceNotAvailableError extends Error {
  constructor(command: string, cause?: unknown) {
    const configKey = 'stacking.gitSpice.command';
    const commandHint =
      command !== 'git-spice'
        ? ` Configured command: ${command}.`
        : '';
    super(
      `git-spice is not available.${commandHint} ` +
        `Install it from https://abhinav.github.io/git-spice/ or set ${configKey} to the path of the executable.`,
    );
    this.name = 'GitSpiceNotAvailableError';
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when a git-spice command exits with a non-zero status.
 */
export class GitSpiceCommandError extends Error {
  constructor(command: string, args: string[], exitCode: number | null, stderr: string) {
    super(
      `git-spice command failed: ${[command, ...args].join(' ')}\n` +
        `Exit code: ${exitCode ?? 'unknown'}` +
        (stderr ? `\nStderr: ${stderr}` : ''),
    );
    this.name = 'GitSpiceCommandError';
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Adapter for the git-spice stack provider.
 *
 * All operations accept a `cwd` (working directory) where the target branch
 * is already checked out. The implementation uses the configured command
 * without requiring shell aliases like 'gs'.
 */
export class GitSpiceAdapter {
  private readonly command: string;

  constructor(command: string) {
    this.command = command;
  }

  /** The resolved command used for all invocations. Never 'gs'. */
  get resolvedCommand(): string {
    return this.command;
  }

  /**
   * Run git-spice with the given argv in cwd.
   * Returns stdout on success; throws on non-zero exit or missing executable.
   */
  private async run(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.command, args, { cwd });
      return stdout;
    } catch (err) {
      // ENOENT means the command was not found in PATH or at the given path
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new GitSpiceNotAvailableError(this.command, err);
      }
      const execErr = err as { code?: number | string; stderr?: string };
      const exitCode = typeof execErr.code === 'number' ? execErr.code : null;
      throw new GitSpiceCommandError(this.command, args, exitCode, execErr.stderr ?? '');
    }
  }

  /**
   * Verify that git-spice is available by running `--version`.
   * Throws GitSpiceNotAvailableError if the command is missing or fails.
   */
  async requireAvailable(cwd: string): Promise<void> {
    try {
      await this.run(cwd, ['--version']);
    } catch (err) {
      if (err instanceof GitSpiceNotAvailableError) throw err;
      // Any other failure from --version (e.g., non-zero exit) also means unavailable
      throw new GitSpiceNotAvailableError(this.command, err);
    }
  }

  /**
   * Track the current branch against a base branch.
   * Runs: git-spice branch track --base <base>
   */
  async trackBranch(cwd: string, base: string): Promise<void> {
    await this.run(cwd, ['branch', 'track', '--base', base]);
  }

  /**
   * Submit the current branch as a pull request.
   * Runs: git-spice branch submit
   */
  async submitBranch(cwd: string): Promise<void> {
    await this.run(cwd, ['branch', 'submit']);
  }

  /**
   * Submit the entire stack as pull requests.
   * Runs: git-spice stack submit
   */
  async submitStack(cwd: string): Promise<void> {
    await this.run(cwd, ['stack', 'submit']);
  }

  /**
   * Sync the repo with the remote.
   * Runs: git-spice repo sync
   */
  async syncRepo(cwd: string): Promise<void> {
    await this.run(cwd, ['repo', 'sync']);
  }

  /**
   * Restack the current branch onto its updated base.
   * Runs: git-spice branch restack
   */
  async restackBranch(cwd: string): Promise<void> {
    await this.run(cwd, ['branch', 'restack']);
  }

  /**
   * Restack the entire stack onto updated bases.
   * Runs: git-spice stack restack
   */
  async restackStack(cwd: string): Promise<void> {
    await this.run(cwd, ['stack', 'restack']);
  }

  /**
   * Rebase the current branch's upstack onto a new target.
   * Runs: git-spice upstack onto <target>
   */
  async upstackOnto(cwd: string, target: string): Promise<void> {
    await this.run(cwd, ['upstack', 'onto', target]);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a GitSpiceAdapter from a partial stacking config.
 * Defaults to the canonical 'git-spice' command when no override is configured.
 * Never falls back to 'gs' or any other alias.
 */
export function createGitSpiceAdapter(config: { gitSpice?: { command?: string } }): GitSpiceAdapter {
  const command = config.gitSpice?.command ?? 'git-spice';
  return new GitSpiceAdapter(command);
}
