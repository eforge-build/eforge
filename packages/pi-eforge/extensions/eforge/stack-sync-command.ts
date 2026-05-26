/**
 * Native Pi command/tool handler for stack sync.
 *
 * Calls apiStackSyncIfRunning from the shared client helper and renders
 * a structured report. Supports dry-run mode.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { apiStackSyncIfRunning } from '@eforge-build/client';
import type { StackSyncResponse } from '@eforge-build/client';
import { showInfoPanel, type UIContext } from './ui-helpers.js';
import { DAEMON_NOT_RUNNING_GUIDANCE } from './daemon-requests.js';

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

/** Format a stack sync response as a markdown string for display in an info panel. */
export function formatStackSyncReport(report: StackSyncResponse): string {
  const lines: string[] = [];

  // Header
  const outcomeLabel =
    report.outcome === 'complete'
      ? '✓ complete'
      : report.outcome === 'skipped'
        ? '⊘ skipped'
        : report.outcome === 'conflict'
          ? '⚠ conflict'
          : '✗ failed';

  const dryRunLabel = report.dryRun ? ' (dry-run)' : '';
  lines.push(`## Stack Sync${dryRunLabel}: ${outcomeLabel}`);
  lines.push('');

  if (report.reason) {
    lines.push(`**Reason:** ${report.reason}`);
    lines.push('');
  }

  if (!report.stackingActive) {
    lines.push('*Stacking is not enabled. Enable it via `/eforge:workflow:init` or set `stacking.enabled: true` in `eforge/config.yaml`.*');
    lines.push('');
  }

  // Trunk SHA info
  if (report.localTrunkSha || report.originTrunkSha) {
    if (report.localTrunkSha) {
      lines.push(`- Local trunk SHA: \`${report.localTrunkSha}\``);
    }
    if (report.originTrunkSha) {
      lines.push(`- Origin trunk SHA: \`${report.originTrunkSha}\``);
    }
    if (report.fastForward !== undefined) {
      lines.push(`- Fast-forward eligible: ${report.fastForward ? 'yes' : 'no'}`);
    }
    lines.push('');
  }

  // Restack candidates
  if (report.restackCandidates && report.restackCandidates.length > 0) {
    lines.push('**Restack candidates:**');
    lines.push('');
    for (const branch of report.restackCandidates) {
      lines.push(`- \`${branch}\``);
    }
    lines.push('');
  }

  // Active-build skips
  if (report.activeBuildSkips.length > 0) {
    lines.push('**Active-build skips** (excluded from sync):');
    lines.push('');
    for (const skip of report.activeBuildSkips) {
      const detail = skip.worktree ? ` (${skip.worktree})` : '';
      lines.push(`- \`${skip.branch}\`${detail}: ${skip.reason}`);
    }
    lines.push('');
  }

  // Provider commands
  if (report.providerCommands.length > 0) {
    const header = report.dryRun ? '**Provider commands (dry-run):**' : '**Provider commands:**';
    lines.push(header);
    lines.push('');
    for (const cmd of report.providerCommands) {
      const argv = [cmd.command, ...cmd.args].join(' ');
      const status = cmd.ran ? '✓ ran' : '- not run';
      lines.push(`- [${status}] \`${argv}\``);
      if (cmd.exitCode !== undefined && cmd.exitCode !== 0) {
        lines.push(`  - Exit code: ${cmd.exitCode}`);
      }
      if (cmd.stderr) {
        lines.push(`  - stderr: ${cmd.stderr}`);
      }
    }
    lines.push('');
  }

  // Error
  if (report.error) {
    lines.push(`**Error:** ${report.error}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Handle the /eforge:stack:sync command and the eforge_stack_sync tool.
 *
 * Parses --dry-run (or dry-run) from args, calls apiStackSyncIfRunning,
 * and renders a structured report in an info panel.
 *
 * Falls back to plain sendUserMessage when no UI is available.
 */
export async function handleStackSyncCommand(
  pi: ExtensionAPI,
  ctx: UIContext | null,
  args: string,
  dryRunOverride?: boolean,
): Promise<void> {
  const dryRun = dryRunOverride ?? /\b(--dry-run|dry-run)\b/.test(args);

  if (!ctx || !ctx.hasUI) {
    // Headless: report via skill or simple message
    pi.sendUserMessage(
      `Stack sync requested (dryRun: ${dryRun}). Use \`eforge_stack_sync\` tool for programmatic access.`,
    );
    return;
  }

  let report: StackSyncResponse;
  try {
    const result = await apiStackSyncIfRunning({ cwd: ctx.cwd, body: { dryRun } });
    if (result === null) {
      await showInfoPanel(
        ctx,
        'eforge - Stack Sync',
        `Cannot run stack sync: ${DAEMON_NOT_RUNNING_GUIDANCE}`,
      );
      return;
    }
    report = result.data;
  } catch (err) {
    await showInfoPanel(
      ctx,
      'eforge - Stack Sync Error',
      `Stack sync failed:\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const reportMd = formatStackSyncReport(report);
  const title = report.dryRun ? 'eforge - Stack Sync (dry-run)' : 'eforge - Stack Sync';
  await showInfoPanel(ctx, title, reportMd);
}
