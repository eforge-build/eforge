/**
 * Native Pi command handler for /eforge:status.
 *
 * Presents a read-only overlay dashboard without involving the agent. The
 * command is passive: it only talks to an already-running daemon and never
 * starts one implicitly.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  API_ROUTES,
  apiGetRunningSessionSummariesIfRunning,
  type ConfigValidateResponse,
  type QueueItem,
  type RunSummary,
  type VersionResponse,
} from "@eforge-build/client";
import { DAEMON_NOT_RUNNING_GUIDANCE, piDaemonRequest } from "./daemon-requests.js";
import { formatDuration } from "./pure-helpers.js";
import { showInfoOverlay, withLoader, type UIContext } from "./ui-helpers";

interface ProfileShowData {
  active: string | null;
  source: string;
  resolved: { harness?: string; name?: string } | null;
}

interface StatusBuild extends RunSummary {
  runId: string;
  command: string;
}

interface StatusSnapshot {
  daemonRunning: boolean;
  monitorUrl?: string;
  daemonVersion?: string;
  piExtensionVersion: string;
  versionMismatch?: string;
  profile?: ProfileShowData | null;
  config?: ConfigValidateResponse | null;
  queue?: QueueItem[];
  builds?: StatusBuild[];
}

function statusIcon(status: string): string {
  switch (status) {
    case "completed":
      return "✓";
    case "running":
      return "⟳";
    case "failed":
      return "✗";
    case "queued":
      return "○";
    case "pending":
      return "○";
    default:
      return "?";
  }
}

function planProgress(build: StatusBuild): string {
  const complete = build.plans.filter((p) => p.status === "completed").length;
  return `${complete}/${build.plans.length}`;
}

function formatBuild(build: StatusBuild): string[] {
  const lines: string[] = [];
  const title = build.command || build.runId;
  lines.push(`### ${statusIcon(build.status)} ${title}`);
  lines.push("");
  lines.push(`- **Session:** \`${build.sessionId}\``);
  lines.push(`- **Run:** \`${build.runId}\``);
  lines.push(`- **Status:** ${build.status}`);
  if (build.duration.seconds != null) {
    lines.push(`- **Elapsed:** ${formatDuration(build.duration.seconds)}`);
  }
  const current = [build.currentPhase, build.currentAgent].filter(Boolean).join(" › ");
  if (current) {
    lines.push(`- **Current:** ${current}`);
  }
  lines.push(`- **Plans:** ${planProgress(build)}`);
  lines.push(`- **Events:** ${build.eventCounts.total} total, ${build.eventCounts.errors} error(s)`);

  if (build.plans.length > 0) {
    lines.push("");
    lines.push("| Plan | Status | Branch | Depends on |");
    lines.push("|------|--------|--------|------------|");
    for (const plan of build.plans) {
      const branch = plan.branch ? `\`${plan.branch}\`` : "—";
      const dependsOn = plan.dependsOn.length > 0 ? plan.dependsOn.map((id) => `\`${id}\``).join(", ") : "—";
      lines.push(`| \`${plan.id}\` | ${statusIcon(plan.status)} ${plan.status} | ${branch} | ${dependsOn} |`);
    }
  }

  return lines;
}

function formatQueue(queue: QueueItem[]): string[] {
  if (queue.length === 0) {
    return ["## Queue", "", "No queued PRDs."];
  }

  const lines: string[] = ["## Queue", "", `**${queue.length} PRD(s)**`, ""];
  const visible = queue.slice(0, 10);
  for (const item of visible) {
    const created = item.created ? ` · ${item.created}` : "";
    const dependsOn = item.dependsOn && item.dependsOn.length > 0 ? ` · depends on ${item.dependsOn.join(", ")}` : "";
    lines.push(`- ${statusIcon(item.status)} **${item.title}** — \`${item.status}\`${created}${dependsOn}`);
  }
  if (queue.length > visible.length) {
    lines.push(`- … ${queue.length - visible.length} more`);
  }
  return lines;
}

function formatNativeStatus(snapshot: StatusSnapshot): string {
  if (!snapshot.daemonRunning) {
    return [
      "The eforge daemon is not running.",
      "",
      DAEMON_NOT_RUNNING_GUIDANCE,
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push("## Daemon");
  lines.push("");
  lines.push(`- **Status:** running`);
  if (snapshot.monitorUrl) lines.push(`- **Monitor:** ${snapshot.monitorUrl}`);
  if (snapshot.daemonVersion) lines.push(`- **Daemon version:** \`${snapshot.daemonVersion}\``);
  lines.push(`- **Pi extension version:** \`${snapshot.piExtensionVersion}\``);
  if (snapshot.versionMismatch) {
    lines.push(`- **Version warning:** ${snapshot.versionMismatch}`);
  }

  lines.push("");
  lines.push("## Profile");
  lines.push("");
  if (snapshot.profile?.active) {
    const harness = snapshot.profile.resolved?.harness ? ` (${snapshot.profile.resolved.harness})` : "";
    lines.push(`Active profile: **${snapshot.profile.active}**${harness}`);
  } else {
    lines.push("No active profile reported.");
  }

  lines.push("");
  lines.push("## Config");
  lines.push("");
  if (!snapshot.config) {
    lines.push("Config validation unavailable.");
  } else if (!snapshot.config.configFound) {
    lines.push("No eforge config found. Run `/eforge:init` to initialize this project.");
  } else if (snapshot.config.valid) {
    lines.push("✓ Config is valid.");
  } else {
    lines.push("✗ Config validation failed:");
    for (const error of snapshot.config.errors ?? []) {
      lines.push(`- ${error}`);
    }
  }

  lines.push("");
  lines.push("## Active builds");
  lines.push("");
  const builds = snapshot.builds ?? [];
  if (builds.length === 0) {
    lines.push("No active eforge builds. Use `/eforge:build` to enqueue work.");
  } else {
    lines.push(`**${builds.length} active build(s)**`);
    for (const build of builds) {
      lines.push("", ...formatBuild(build));
    }
  }

  lines.push("", ...formatQueue(snapshot.queue ?? []));
  lines.push("", "---", "Re-run `/eforge:status` to refresh.");
  return lines.join("\n");
}

async function loadStatusSnapshot(cwd: string, piExtensionVersion: string): Promise<StatusSnapshot> {
  const versionResult = await piDaemonRequest<VersionResponse>(cwd, "GET", API_ROUTES.version);
  if (versionResult === null) {
    return { daemonRunning: false, piExtensionVersion };
  }

  const daemonVersion = versionResult.data.eforgeVersion ?? "unknown (pre-version-aware daemon)";
  const versionMismatch = versionResult.data.eforgeVersion !== undefined && daemonVersion !== piExtensionVersion
    ? "Daemon was built from a different version than the installed Pi extension. Restart the daemon (or update the Pi extension) so they match."
    : undefined;

  const [profileResult, configResult, queueResult, summariesResult] = await Promise.all([
    piDaemonRequest<ProfileShowData>(cwd, "GET", API_ROUTES.profileShow).catch(() => null),
    piDaemonRequest<ConfigValidateResponse>(cwd, "GET", API_ROUTES.configValidate).catch(() => null),
    piDaemonRequest<QueueItem[]>(cwd, "GET", API_ROUTES.queue).catch(() => null),
    apiGetRunningSessionSummariesIfRunning({ cwd }).catch(() => null),
  ]);

  return {
    daemonRunning: true,
    monitorUrl: `http://localhost:${versionResult.port}`,
    daemonVersion,
    piExtensionVersion,
    versionMismatch,
    profile: profileResult?.data ?? null,
    config: configResult?.data ?? null,
    queue: queueResult?.data ?? [],
    builds: (summariesResult ?? []).map(({ run, summary }) => ({
      ...summary,
      runId: run.id,
      command: run.command,
    })),
  };
}

export async function handleStatusCommand(
  pi: ExtensionAPI,
  ctx: UIContext | null,
  args: string,
  piExtensionVersion: string,
): Promise<void> {
  if (!ctx || !ctx.hasUI) {
    pi.sendUserMessage(`/skill:eforge-status${args ? " " + args : ""}`.trim());
    return;
  }

  try {
    const snapshot = await withLoader(ctx, "Loading eforge status...", () =>
      loadStatusSnapshot(ctx.cwd, piExtensionVersion),
    );
    await showInfoOverlay(ctx, "eforge - Status", formatNativeStatus(snapshot));
  } catch (err) {
    await showInfoOverlay(
      ctx,
      "eforge - Status Error",
      `Failed to load status:\n\n${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export { formatNativeStatus };
