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
import type {
  ProviderCommandResult,
  StackProviderConflictKind,
  StackProviderErrorClassification,
  StackProviderInterruptedOperation,
  StackProviderOperationKind,
} from './provider.js';

const execFileAsync = promisify(execFile);
const GITHUB_PR_URL_PATTERN = 'https:\\/\\/github\\.com\\/[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+\\/pull\\/\\d+';
const GITHUB_PR_URL_REGEX = new RegExp(GITHUB_PR_URL_PATTERN);
const GITHUB_PR_URL_EXACT_REGEX = new RegExp(`^${GITHUB_PR_URL_PATTERN}$`);
const CONFLICT_DIAGNOSTIC_RE = /conflict|could not apply|fix conflicts|resolve all conflicts|rebase in progress|rebase --continue|continue.*rebase/i;
const AUTH_DIAGNOSTIC_RE = /authentication|authorization|permission denied|bad credentials|unauthorized|forbidden|token/i;
const NETWORK_DIAGNOSTIC_RE = /network|timed out|timeout|could not resolve|connection refused|connection reset|temporary failure|tls|ssl/i;

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
        ? ` Configured command: ${redactProviderMessage(command)}.`
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
  readonly command: string;
  readonly args: string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(command: string, args: string[], exitCode: number | null, stderr: string, stdout = '') {
    const safeCommand = redactProviderMessage(command);
    const safeArgs = args.map((arg) => redactProviderMessage(arg));
    const safeStderr = redactProviderMessage(stderr);
    const safeStdout = redactProviderMessage(stdout);
    super(
      `git-spice command failed: ${[safeCommand, ...safeArgs].join(' ')}\n` +
        `Exit code: ${exitCode ?? 'unknown'}` +
        (safeStderr ? `\nStderr: ${safeStderr}` : ''),
    );
    this.name = 'GitSpiceCommandError';
    this.command = command;
    this.args = args;
    this.exitCode = exitCode;
    this.stdout = safeStdout;
    this.stderr = safeStderr;
  }
}

/**
 * Redact common secret shapes before provider failures are persisted or shown.
 */
export function redactProviderMessage(message: string): string {
  return message
    .replace(/https:\/\/[^\s/@]+@/g, 'https://[redacted]@')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\bgh[oprsu]_[A-Za-z0-9_]+\b/g, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, '[redacted]')
    .replace(/\b(token|password|secret|api[_-]?key|authorization)\s*[:=]\s*[^\s]+/gi, '$1=[redacted]');
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
   * Returns command metadata on success; throws on non-zero exit or missing executable.
   */
  private async run(cwd: string, args: string[]): Promise<ProviderCommandResult> {
    try {
      const { stdout, stderr } = await execFileAsync(this.command, args, { cwd });
      return { command: this.command, args, stdout, stderr, exitCode: 0 };
    } catch (err) {
      // ENOENT means the command was not found in PATH or at the given path
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new GitSpiceNotAvailableError(this.command, err);
      }
      const execErr = err as { code?: number | string; stdout?: string; stderr?: string };
      const exitCode = typeof execErr.code === 'number' ? execErr.code : null;
      throw new GitSpiceCommandError(this.command, args, exitCode, execErr.stderr ?? '', execErr.stdout ?? '');
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
  async trackBranch(cwd: string, base: string): Promise<ProviderCommandResult> {
    return this.run(cwd, ['branch', 'track', '--base', base]);
  }

  /**
   * Submit the current branch as a pull request.
   * Runs: git-spice branch submit --fill --no-web --no-prompt
   *
   * eforge runs in a non-interactive daemon context, so submission must provide
   * PR metadata from commits and explicitly disable browser/prompt behavior.
   */
  async submitBranch(cwd: string): Promise<ProviderCommandResult> {
    return this.run(cwd, ['branch', 'submit', '--fill', '--no-web', '--no-prompt']);
  }

  /**
   * Submit the entire stack as pull requests.
   * Runs: git-spice stack submit --fill --no-web --no-prompt
   *
   * eforge runs in a non-interactive daemon context, so submission must provide
   * PR metadata from commits and explicitly disable browser/prompt behavior.
   */
  async submitStack(cwd: string): Promise<ProviderCommandResult> {
    return this.run(cwd, ['stack', 'submit', '--fill', '--no-web', '--no-prompt']);
  }

  /**
   * Sync the repo with the remote.
   * Runs: git-spice repo sync
   */
  async syncRepo(cwd: string): Promise<ProviderCommandResult> {
    return this.run(cwd, ['repo', 'sync']);
  }

  /**
   * Restack the current branch onto its updated base.
   * Runs: git-spice branch restack
   */
  async restackBranch(cwd: string): Promise<ProviderCommandResult> {
    return this.run(cwd, ['branch', 'restack']);
  }

  /**
   * Restack the entire stack onto updated bases.
   * Runs: git-spice stack restack
   */
  async restackStack(cwd: string): Promise<ProviderCommandResult> {
    return this.run(cwd, ['stack', 'restack']);
  }

  /**
   * Rebase the current branch's upstack onto a new target.
   * Runs: git-spice upstack onto <target>
   */
  async upstackOnto(cwd: string, target: string): Promise<ProviderCommandResult> {
    return this.run(cwd, ['upstack', 'onto', target]);
  }

  async classifyError(cwd: string, err: unknown): Promise<StackProviderErrorClassification> {
    if (err instanceof GitSpiceNotAvailableError) {
      return classification('tooling', 'unknown', err.message, false);
    }

    if (err instanceof GitSpiceCommandError) {
      const operation = operationFromArgs(err.args);
      const diagnostic = redactProviderMessage(`${err.stdout}\n${err.stderr}\n${err.message}`);
      if (AUTH_DIAGNOSTIC_RE.test(diagnostic)) return classification('auth', operation, diagnostic, false);
      if (NETWORK_DIAGNOSTIC_RE.test(diagnostic)) return classification('network', operation, diagnostic, false);

      const hasUnmergedPaths = await repoHasUnmergedPaths(cwd);
      if (operation === 'branch-restack' && (CONFLICT_DIAGNOSTIC_RE.test(diagnostic) || hasUnmergedPaths)) {
        return {
          kind: 'recoverable-conflict',
          operation,
          conflictKind: conflictKindFromDiagnostic(diagnostic),
          message: diagnostic,
          recoverable: true,
        };
      }

      return classification('provider-failure', operation, diagnostic, false);
    }

    const message = redactProviderMessage(err instanceof Error ? err.message : String(err));
    return classification('unknown', 'unknown', message, false);
  }

  async getInterruptedOperation(
    cwd: string,
    classificationResult: StackProviderErrorClassification,
  ): Promise<StackProviderInterruptedOperation | undefined> {
    if (classificationResult.kind !== 'recoverable-conflict' || !classificationResult.recoverable) return undefined;
    const conflictedFiles = await getGitOutputLines(cwd, ['diff', '--name-only', '--diff-filter=U']);
    if (conflictedFiles.length === 0) return undefined;
    const branch = (await getGitOutput(cwd, ['branch', '--show-current'])).trim() || undefined;
    const conflictDiff = await getGitOutput(cwd, ['diff']);
    return {
      operation: classificationResult.operation,
      conflictKind: classificationResult.conflictKind ?? 'unknown',
      ...(branch !== undefined && { branch }),
      conflictedFiles,
      conflictDiff,
    };
  }

  async continueInterruptedOperation(cwd: string, _operation: StackProviderInterruptedOperation): Promise<ProviderCommandResult> {
    return this.run(cwd, ['rebase', 'continue']);
  }

  async abortInterruptedOperation(cwd: string, _operation: StackProviderInterruptedOperation): Promise<ProviderCommandResult> {
    return this.run(cwd, ['rebase', 'abort']);
  }

  /**
   * Return the dry-run command preview for the given argv.
   *
   * Returns the command (the configured git-spice path) and the given args,
   * without executing anything. Used by sync.ts for dry-run records.
   */
  commandPreview(argv: string[]): { command: string; args: string[] } {
    return { command: this.command, args: argv };
  }

  /**
   * Return the dry-run command preview for `repo sync` without executing it.
   */
  syncRepoPreview(): { command: string; args: string[] } {
    return { command: this.command, args: ['repo', 'sync'] };
  }

  /**
   * Return the dry-run command preview for `stack restack` without executing it.
   */
  restackStackPreview(): { command: string; args: string[] } {
    return { command: this.command, args: ['stack', 'restack'] };
  }

  /**
   * Extract a GitHub PR URL from git-spice stdout output.
   */
  parsePrUrl(stdout: string): string | undefined {
    return parseGitSpicePrUrl(stdout);
  }

  /**
   * Returns true when the given string is an exact GitHub pull-request URL.
   */
  isValidPrUrl(url: string): boolean {
    return isGitHubPullRequestUrl(url);
  }

  /**
   * Redact common secret shapes from a provider message before persisting or
   * displaying it.
   */
  redactMessage(message: string): string {
    return redactProviderMessage(message);
  }
}

function operationFromArgs(args: string[]): StackProviderOperationKind {
  const joined = args.join(' ');
  if (joined === 'branch restack') return 'branch-restack';
  if (joined === 'stack restack') return 'stack-restack';
  if (joined === 'repo sync') return 'repo-sync';
  return 'unknown';
}

function conflictKindFromDiagnostic(diagnostic: string): StackProviderConflictKind {
  if (/merge/i.test(diagnostic) && !/rebase/i.test(diagnostic)) return 'git-merge';
  if (/rebase|could not apply|continue/i.test(diagnostic)) return 'git-rebase';
  return 'unknown';
}

function classification(
  kind: StackProviderErrorClassification['kind'],
  operation: StackProviderOperationKind,
  message: string,
  recoverable: boolean,
): StackProviderErrorClassification {
  return { kind, operation, message: redactProviderMessage(message), recoverable };
}

async function repoHasUnmergedPaths(cwd: string): Promise<boolean> {
  try {
    const lines = await getGitOutputLines(cwd, ['diff', '--name-only', '--diff-filter=U']);
    return lines.length > 0;
  } catch {
    return false;
  }
}

async function getGitOutput(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout;
  } catch {
    return '';
  }
}

async function getGitOutputLines(cwd: string, args: string[]): Promise<string[]> {
  const output = await getGitOutput(cwd, args);
  return output.trim().split('\n').filter(Boolean);
}

// ---------------------------------------------------------------------------
// PR URL parsing helper
// ---------------------------------------------------------------------------

/**
 * Extract a GitHub PR URL from git-spice stdout output.
 *
 * git-spice prints the PR URL when a branch is submitted for the first time
 * or when updating an existing PR. Returns the first URL found, or undefined
 * when the output does not contain a recognizable PR URL.
 */
export function parseGitSpicePrUrl(stdout: string): string | undefined {
  const match = stdout.match(GITHUB_PR_URL_REGEX);
  return match?.[0];
}

/** Returns true when the string is an exact GitHub pull-request URL. */
export function isGitHubPullRequestUrl(url: string): boolean {
  return GITHUB_PR_URL_EXACT_REGEX.test(url);
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
