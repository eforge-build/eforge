/**
 * Validation provider extension — demonstrates runtime validation provider registration.
 *
 * This extension registers two custom validation providers that run during the per-plan
 * `validate` build stage, after the implement stage completes and before the review stage.
 * Both providers enforce project-level quality gates without mutating engine state.
 *
 * Demonstrates:
 *
 * - `registerValidationProvider` with a function-form provider (`type-check-gate`) — uses
 *   `ctx.exec.run` to invoke `pnpm type-check` programmatically, giving access to stdout/stderr
 *   and the exit code for custom failure messages.
 * - `registerValidationProvider` with a command-form provider (`lint-gate`) — uses the
 *   `commands` array for simpler subprocess dispatch when exit-code-is-failure is sufficient.
 * - `ValidationProviderContext` — the rich context object carrying `planId`, `planOutputDir`,
 *   `worktreePath`, `logger`, `exec`, `signal`, and `changedFiles`.
 * - `ValidationProviderResult` — the structured result shape for explicit status, message,
 *   details, and per-file annotations.
 *
 * Failure semantics:
 *
 * - A provider is a **fail-closed quality gate**. Normal failures (`status: 'failed'`
 *   result or command-form non-zero exit) are recoverable first within the
 *   `review.maxRounds` budget. Narrow or unspecified structured failures use the
 *   review-fixer path first; structural failures use the validation-fixer path.
 *   After each recovery attempt, eforge reruns all validation providers from the first
 *   provider. Unresolved recoverable failures still fail the current plan and emit
 *   `plan:build:failed`.
 * - Hard failures bypass recovery: thrown errors/rejections, provider timeouts,
 *   non-empty string returns, and unexpected return shapes fail the current plan immediately. The daemon process
 *   itself is never crashed by a provider failure.
 * - The provider runs under a wall-clock timeout controlled by
 *   `extensions.validationProviderTimeoutMs` (falls back to `extensions.eventHookTimeoutMs`).
 *   On expiry the subprocess tree is killed and an `extension:validation-provider:timeout`
 *   event is emitted.
 * - Providers emit `extension:validation-provider:start`, `extension:validation-provider:complete`,
 *   `extension:validation-provider:error`, and `extension:validation-provider:timeout` events
 *   during execution.
 * - Structured annotations on failed results improve recovery precision by pointing the
 *   repair agent at specific files and lines. Include `fix`, `retryGuidance`,
 *   `failureKind`, `repairClass`, and small JSON-safe `metadata` when available.
 *
 * No-mutation contract:
 *
 * - Providers may read the plan worktree via `ctx.exec.run` or the filesystem. They must not
 *   mutate engine state, the extension registry, or orchestration metadata from within
 *   `validate`. The `planOutputDir` / `worktreePath` represent the plan worktree — writes to
 *   those directories are allowed but uncommon; do not write outside the plan worktree.
 *
 * For the full API reference, see docs/extensions-api.md — `registerValidationProvider`.
 * For the conceptual overview and execution position, see docs/extensions.md — "Validation providers".
 */

import type { EforgeExtensionAPI, ValidationProviderResult } from '@eforge-build/extension-sdk';

export default function validationProviders(eforge: EforgeExtensionAPI): void {
  // Function-form provider: programmatic validation logic using ctx.exec.run.
  //
  // Use function form when you need:
  // - Access to stdout/stderr for a custom failure message
  // - Conditional logic based on changed files (ctx.changedFiles)
  // - Multiple subprocess calls in sequence
  // - Structured annotations attached to specific files so recovery can target exact lines
  eforge.registerValidationProvider({
    name: 'type-check-gate',
    description: 'Runs TypeScript type checking via pnpm type-check and fails the plan on type errors.',
    validate: async (planOutputDir, ctx): Promise<ValidationProviderResult | null> => {
      ctx?.logger.info('Running type-check-gate', { planId: ctx.planId });

      const result = await ctx!.exec.run('pnpm', ['type-check'], {
        cwd: planOutputDir,
      });

      if (result.exitCode !== 0) {
        const errorOutput = result.stderr.trim() || result.stdout.trim();
        return {
          status: 'failed',
          message: 'TypeScript type checking failed',
          details: errorOutput,
          annotations: [{
            severity: 'error',
            message: 'TypeScript diagnostics must be resolved before review can continue.',
            details: errorOutput,
            fix: 'Run pnpm type-check locally and fix the reported TypeScript errors.',
            retryGuidance: 'Make the smallest type-safe change that resolves the diagnostic; do not broaden public API types unless the error requires it.',
            failureKind: 'typescript-diagnostics',
            repairClass: 'narrow',
            metadata: { command: 'pnpm type-check' },
          }],
        };
      }

      ctx?.logger.info('type-check-gate passed');
      return null; // passed
    },
  });

  // Command-form provider: simpler subprocess dispatch for exit-code-is-failure gates.
  // A non-zero exit code is a recoverable generic validation failure before terminal failure.
  //
  // Use command form when:
  // - A non-zero exit code is the only failure signal you need
  // - The command output is surfaced as-is (stderr, or stdout if stderr is empty)
  // - No conditional logic or structured annotations are required
  //
  // Each command string is split on whitespace into [executable, ...args] and run via
  // execFile — shell interpretation, quoted args, env-var expansion, redirects, and
  // pipes are not supported. Use the function form if you need shell features.
  eforge.registerValidationProvider({
    name: 'lint-gate',
    description: 'Runs the project linter via pnpm lint and fails the plan on lint errors.',
    commands: ['pnpm lint'],
  });
}
