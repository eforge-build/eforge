/**
 * Native Pi command handler for /eforge:restart.
 *
 * Provides a confirmation-oriented selector/panel flow for safely restarting the
 * daemon. The command is an explicit lifecycle action, so it may start the
 * daemon after user confirmation, but it never starts the daemon from passive
 * status/polling paths.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  API_ROUTES,
  LOCKFILE_POLL_INTERVAL_MS,
  LOCKFILE_POLL_TIMEOUT_MS,
  apiGetRunningRunsIfRunning,
  daemonRequestIfRunning,
  ensureDaemon,
  isServerAlive,
  readLockfile,
  sleep,
} from "@eforge-build/client";
import { checkActiveBuildsMessage } from "./pure-helpers.js";
import { showInfoOverlay, showSelectOverlay, withLoader, type UIContext } from "./ui-helpers";

interface RestartResult {
  action: "started" | "restarted";
  port: number;
  forced: boolean;
  stopMessage?: string;
}

function parseForce(args: string): boolean {
  return /(?:^|\s)(?:--force|force)(?:\s|$)/i.test(args);
}

async function daemonIsRunning(cwd: string): Promise<boolean> {
  const lock = readLockfile(cwd);
  return lock !== null && await isServerAlive(lock);
}

async function activeBuildsMessage(cwd: string): Promise<string | null> {
  try {
    const result = await apiGetRunningRunsIfRunning({ cwd });
    if (result === null) return null;
    return checkActiveBuildsMessage(result.data);
  } catch {
    return null;
  }
}

async function stopDaemonForRestart(
  cwd: string,
  force: boolean,
): Promise<{ stopped: boolean; message: string }> {
  const lock = readLockfile(cwd);
  if (!lock || !(await isServerAlive(lock))) {
    return { stopped: true, message: "Daemon is not running." };
  }

  if (!force) {
    const activeMessage = await activeBuildsMessage(cwd);
    if (activeMessage) {
      return { stopped: false, message: activeMessage };
    }
  }

  try {
    await daemonRequestIfRunning(cwd, "POST", API_ROUTES.daemonStop, { force });
  } catch {
    // Daemon may shut down before sending a response.
  }

  const deadline = Date.now() + LOCKFILE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(LOCKFILE_POLL_INTERVAL_MS);
    const current = readLockfile(cwd);
    if (!current) {
      return { stopped: true, message: "Daemon stopped successfully." };
    }
  }

  return {
    stopped: true,
    message: "Daemon stop requested. Lockfile may take a moment to clear.",
  };
}

async function restartDaemon(cwd: string, force: boolean): Promise<RestartResult> {
  const wasRunning = await daemonIsRunning(cwd);
  const stopResult = await stopDaemonForRestart(cwd, force);
  if (!stopResult.stopped) {
    throw new Error(stopResult.message);
  }

  const port = await ensureDaemon(cwd);
  return {
    action: wasRunning ? "restarted" : "started",
    port,
    forced: force,
    stopMessage: stopResult.message,
  };
}

function formatRestartResult(result: RestartResult): string {
  const title = result.action === "restarted" ? "eforge daemon restarted" : "eforge daemon started";
  const lines = [
    `## ${title}`,
    "",
    `- **Status:** running`,
    `- **Port:** ${result.port}`,
    `- **Monitor:** http://localhost:${result.port}`,
  ];
  if (result.forced) lines.push("- **Mode:** forced restart");
  if (result.stopMessage) lines.push(`- **Stop step:** ${result.stopMessage}`);
  return lines.join("\n");
}

export async function handleRestartCommand(
  pi: ExtensionAPI,
  ctx: UIContext | null,
  args: string,
  onStatusRefresh: () => Promise<void>,
): Promise<void> {
  if (!ctx || !ctx.hasUI) {
    pi.sendUserMessage(`/skill:eforge-restart${args ? " " + args : ""}`.trim());
    return;
  }

  let force = parseForce(args);

  try {
    const running = await withLoader(ctx, "Checking daemon...", () => daemonIsRunning(ctx.cwd));

    if (!running) {
      const choice = await showSelectOverlay(ctx, "eforge - Daemon Not Running", [
        {
          value: "start",
          label: "Start daemon",
          description: "/eforge:restart was requested, but no daemon is currently running",
        },
        { value: "cancel", label: "Cancel", description: "Leave the daemon stopped" },
      ]);
      if (choice !== "start") return;
    } else if (!force) {
      const activeMessage = await withLoader(ctx, "Checking active builds...", () => activeBuildsMessage(ctx.cwd));
      if (activeMessage) {
        const choice = await showSelectOverlay(ctx, "eforge - Active Builds Detected", [
          {
            value: "cancel",
            label: "Cancel",
            description: "Wait for active builds to finish before restarting",
          },
          {
            value: "force",
            label: "Force restart",
            description: "Stop the daemon even though builds are active",
          },
        ]);
        if (choice !== "force") return;
        force = true;
      }
    }

    const result = await withLoader(ctx, force ? "Force restarting daemon..." : "Restarting daemon...", () =>
      restartDaemon(ctx.cwd, force),
    );
    await onStatusRefresh();
    await showInfoOverlay(ctx, "eforge - Daemon", formatRestartResult(result));
  } catch (err) {
    await showInfoOverlay(
      ctx,
      "eforge - Restart Error",
      `Failed to restart the daemon:\n\n${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export { parseForce, formatRestartResult };
