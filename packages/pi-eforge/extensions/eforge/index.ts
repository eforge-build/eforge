/**
 * eforge Pi extension — bridges eforge daemon operations into Pi as tools and commands.
 *
 * Provides the same tool surface as the Claude Code MCP proxy (src/cli/mcp-proxy.ts),
 * but as native Pi tools that talk directly to the daemon HTTP API.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { readFileSync, accessSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Extension's own package version. Read at module load time from this
 * package's package.json. Surfaced via eforge_status alongside the daemon's
 * baked version so the user can spot a stale daemon vs the installed Pi
 * extension.
 */
const PI_EFORGE_VERSION: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

import {
  readLockfile,
  isServerAlive,
  ensureDaemon,
  daemonRequestIfRunning,
  sleep,
  sanitizeProfileName,
  parseRawConfigLegacy,
  apiGetRunningRunsIfRunning,
  apiGetRunningSessionSummariesIfRunning,
  apiListExtensionsIfRunning,
  apiShowExtensionIfRunning,
  apiValidateExtensionsIfRunning,
  apiTestExtensionIfRunning,
  apiNewExtensionIfRunning,
  apiReloadExtensionsIfRunning,
  apiTrustExtensionIfRunning,
  apiUntrustExtensionIfRunning,
  apiInstallExtensionIfRunning,
  apiUpdateExtensionIfRunning,
  apiRemoveExtensionIfRunning,
  apiPromoteExtensionIfRunning,
  apiDemoteExtensionIfRunning,
  // --- eforge:region host-queue-controls ---
  apiUpdateQueuePriorityIfRunning,
  apiRemoveQueueItemIfRunning,
  // --- eforge:endregion host-queue-controls ---
  dispatchEforgeExtensionAction,
  appendExtensionErrorVersionHint,
  hostOutputMetadataDetail,
  projectExtensionManagementResponse,
  renderHostOutput,
  LOCKFILE_POLL_INTERVAL_MS,
  LOCKFILE_POLL_TIMEOUT_MS,
  API_ROUTES,
  buildPath,
  buildProfileListPath,
  apiStackSyncIfRunning,
} from '@eforge-build/client';
import { requireDaemon, piDaemonRequest, DAEMON_NOT_RUNNING_GUIDANCE } from './daemon-requests.js';
import { getPiDaemonVersionMismatch } from './version-compat.js';
import { deriveProfileName } from '@eforge-build/engine/config';
import type {
  EnqueueRequest,
  EnqueueResponse,
  ConfigValidateResponse,
  QueueItem,
  AutoBuildState,
  ConfigShowResponse,
  VersionResponse,
  EforgeExtensionActionHelpers,
  ContinueRepairRequest,
  ProfileListResponse,
} from '@eforge-build/client';
import { handleBuildCommand } from './build-command';
import { handleProfileCommand, handleProfileNewCommand } from './profile-commands';
import { handleConfigCommand } from './config-command';
import { handleRestartCommand } from './restart-command';
import { handleStatusCommand } from './status-command';
import { handleWorkflowCommand, handleWorkflowInitCommand, handleWorkflowReconfigureCommand } from './workflow-wizard';
import { handleStackSyncCommand } from './stack-sync-command';
import { registerExtensionContributionTool, registerExtensionContributionsCommand } from './extension-contributions';
import { showSelectPanel, type UIContext } from './ui-helpers';
import {
  type LandingAction,
} from './trunk-landing';
import { promptForBuildLandingGate } from './landing-gate.js';
export {
  formatSingleBuildFooter,
  formatAggregateFooter,
  formatQueueFooter,
  aggregateRunningSummaries,
  checkActiveBuildsMessage,
} from './pure-helpers.js';
import {
  formatSingleBuildFooter,
  formatAggregateFooter,
  formatQueueFooter,
  checkActiveBuildsMessage,
  formatDuration,
} from './pure-helpers.js';

const piExtensionActionHelpers = {
  list: apiListExtensionsIfRunning,
  show: apiShowExtensionIfRunning,
  validate: apiValidateExtensionsIfRunning,
  test: apiTestExtensionIfRunning,
  new: apiNewExtensionIfRunning,
  reload: apiReloadExtensionsIfRunning,
  trust: apiTrustExtensionIfRunning,
  untrust: apiUntrustExtensionIfRunning,
  install: apiInstallExtensionIfRunning,
  update: apiUpdateExtensionIfRunning,
  remove: apiRemoveExtensionIfRunning,
  promote: apiPromoteExtensionIfRunning,
  demote: apiDemoteExtensionIfRunning,
} satisfies EforgeExtensionActionHelpers;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Quote a string for safe YAML scalar interpolation. */
function yamlQuote(value: string): string {
  if (/[:\[\]{}&*?|>!%#`@,\n"']/.test(value) || value !== value.trim()) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

export function jsonResult(data: unknown): { content: { type: "text"; text: string }[]; details: Record<string, unknown> } {
  const rendered = renderHostOutput(data);
  return { content: [{ type: "text", text: rendered.text }], details: hostOutputMetadataDetail(rendered) };
}

function withMonitorUrl(
  data: Record<string, unknown>,
  port: number,
): Record<string, unknown> {
  return { ...data, monitorUrl: `http://localhost:${port}` };
}

async function checkActiveBuilds(
  cwd: string,
): Promise<string | null> {
  try {
    const result = await apiGetRunningRunsIfRunning({ cwd });
    if (result === null) return null;
    return checkActiveBuildsMessage(result.data);
  } catch {
    return null;
  }
}

async function stopDaemon(
  cwd: string,
  force: boolean,
): Promise<{ stopped: boolean; message: string }> {
  const lock = readLockfile(cwd);
  if (!lock || !(await isServerAlive(lock))) {
    return { stopped: true, message: "Daemon is not running." };
  }

  if (!force) {
    const activeMessage = await checkActiveBuilds(cwd);
    if (activeMessage) {
      return { stopped: false, message: activeMessage };
    }
  }

  try {
    await daemonRequestIfRunning(cwd, "POST", API_ROUTES.daemonStop, { force });
  } catch {
    // Daemon may have already shut down before responding
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
    message:
      "Daemon stop requested. Lockfile may take a moment to clear.",
  };
}

// --- eforge:region status-rendering ---
type StatusToolPayload = {
  status?: string;
  message?: string;
  builds?: StatusBuild[];
  daemonVersion?: string;
  piExtensionVersion?: string;
  versionMismatch?: string;
};

type StatusBuild = {
  sessionId: string;
  runId: string;
  command: string;
  status: string;
  runs?: StatusRun[];
  plans?: StatusPlan[];
  currentPhase?: string | null;
  currentAgent?: string | null;
  eventCounts?: { total: number; errors: number };
  duration?: { startedAt: string | null; completedAt: string | null; seconds: number | null };
};

type StatusPlan = {
  id: string;
  status: string;
  branch: string | null;
  dependsOn: string[];
};

type StatusRun = {
  id: string;
  command: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
};

type StatusTheme = {
  fg(color: string, text: string): string;
};

type StatusStyle = {
  icon: string;
  color: string;
};

type StatusRenderResult = {
  content: ReadonlyArray<{ type: string; text?: string }>;
};

const STATUS_STYLE_BY_STATUS: Record<string, StatusStyle> = {
  completed: { icon: "✓", color: "success" },
  running: { icon: "⟳", color: "warning" },
  failed: { icon: "✗", color: "error" },
};

function statusStyle(status: string, unknownIcon: "?" | "○" = "?"): StatusStyle {
  return STATUS_STYLE_BY_STATUS[status] ?? { icon: unknownIcon, color: "muted" };
}

function renderStatusPayload(data: StatusToolPayload, expanded: boolean, theme: StatusTheme): Text {
  if (data.status === "idle") {
    return new Text(theme.fg("muted", "⊘ No active sessions"), 0, 0);
  }

  const builds = data.builds ?? [];
  if (builds.length === 0) {
    return new Text(theme.fg("muted", "⊘ No active sessions"), 0, 0);
  }

  const lines = builds.length === 1
    ? renderSingleBuildStatus(builds[0], expanded, theme)
    : renderMultiBuildStatus(builds, theme);
  return new Text(lines.join("\n"), 0, 0);
}

function renderSingleBuildStatus(build: StatusBuild, expanded: boolean, theme: StatusTheme): string[] {
  const lines: string[] = [];
  const { icon, color } = statusStyle(build.status);
  let header = theme.fg(color, `${icon} ${build.status}`);
  if (build.duration?.seconds != null) {
    header += theme.fg("dim", `  ${formatDuration(build.duration.seconds)}`);
  }
  lines.push(header);

  if (build.status === "running") {
    appendActivityLine(lines, build, theme, { color: "accent", indent: "  ", marker: "▸" });
  }

  if (appendPlansProgress(lines, build.plans, theme, "  ")) {
    appendPlanRows(lines, build.plans ?? [], theme);
  }

  appendEventCounts(lines, build, theme);
  appendExpandedRuns(lines, build, expanded, theme);
  return lines;
}

function renderMultiBuildStatus(builds: StatusBuild[], theme: StatusTheme): string[] {
  const lines: string[] = [theme.fg("warning", `⟳ ${builds.length} builds running`)];
  for (const build of builds) {
    lines.push("");
    lines.push(theme.fg("accent", `  ▸ ${build.command}`));
    lines.push(theme.fg("dim", `    ${build.sessionId}`));
    appendActivityLine(lines, build, theme, { color: "dim", indent: "    " });
    appendPlansProgress(lines, build.plans, theme, "    ");
    if (build.eventCounts && build.eventCounts.errors > 0) {
      lines.push(theme.fg("error", `    ${build.eventCounts.errors} errors`));
    }
  }
  return lines;
}

function appendActivityLine(
  lines: string[],
  build: Pick<StatusBuild, "currentPhase" | "currentAgent">,
  theme: StatusTheme,
  options: { color: string; indent: string; marker?: string },
): void {
  const parts: string[] = [];
  if (build.currentPhase) parts.push(build.currentPhase);
  if (build.currentAgent) parts.push(build.currentAgent);
  if (parts.length === 0) return;

  const prefix = options.marker ? `${options.indent}${options.marker} ` : options.indent;
  lines.push(theme.fg(options.color, `${prefix}${parts.join(" › ")}`));
}

function appendPlansProgress(
  lines: string[],
  plans: StatusPlan[] | undefined,
  theme: StatusTheme,
  indent: string,
): boolean {
  if (!plans || plans.length === 0) return false;

  const complete = plans.filter((plan) => plan.status === "completed").length;
  lines.push(theme.fg("dim", `${indent}${complete}/${plans.length} plans`));
  return true;
}

function appendPlanRows(lines: string[], plans: StatusPlan[], theme: StatusTheme): void {
  lines.push("");
  for (const plan of plans) {
    const { icon, color } = statusStyle(plan.status, "○");
    lines.push(`  ${theme.fg(color, icon)} ${theme.fg("text", plan.id)}`);
  }
}

function appendEventCounts(lines: string[], build: Pick<StatusBuild, "eventCounts">, theme: StatusTheme): void {
  if (!build.eventCounts) return;

  lines.push("");
  let countsStr = theme.fg("dim", `${build.eventCounts.total} events`);
  if (build.eventCounts.errors > 0) {
    countsStr += theme.fg("error", ` · ${build.eventCounts.errors} errors`);
  } else {
    countsStr += theme.fg("dim", " · 0 errors");
  }
  lines.push(`  ${countsStr}`);
}

function appendExpandedRuns(lines: string[], build: Pick<StatusBuild, "runs">, expanded: boolean, theme: StatusTheme): void {
  if (!expanded || !build.runs || build.runs.length === 0) return;

  lines.push("");
  lines.push(theme.fg("muted", "  Runs:"));
  for (const run of build.runs) {
    const { icon, color } = statusStyle(run.status, "○");
    lines.push(`    ${theme.fg(color, icon)} ${theme.fg("text", run.command)} ${theme.fg("dim", `(${run.status})`)}`);
  }
}

function renderStatusParseFallback(result: StatusRenderResult, theme: StatusTheme): Text {
  const text = result.content[0];
  if (text?.type === "text") {
    return new Text(theme.fg("muted", (text as { text: string }).text), 0, 0);
  }
  return new Text(theme.fg("muted", "Parse error"), 0, 0);
}
// --- eforge:endregion status-rendering ---

// ---------------------------------------------------------------------------
// .gitignore helper
// ---------------------------------------------------------------------------

function ensureGitignoreEntries(cwd: string, entries: string[]): void {
  const gitignorePath = join(cwd, ".gitignore");
  let content = "";
  try {
    content = readFileSync(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet
  }

  const lines = content.split("\n");
  const missing = entries.filter(
    (entry) => !lines.some((line) => line.trim() === entry),
  );

  if (missing.length === 0) return;

  const suffix =
    (content.length > 0 && !content.endsWith("\n") ? "\n" : "") +
    missing.join("\n") +
    "\n";
  writeFileSync(gitignorePath, content + suffix, "utf-8");
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function eforgeExtension(pi: ExtensionAPI) {
  // Module-scope context for refreshing footer status after harness/queue/build changes.
  let _latestCtx: UIContext | null = null;
  let _statusPollTimer: ReturnType<typeof setInterval> | null = null;
  let _statusRefreshInFlight = false;

  function clearFooterStatus(ctx: { ui: { setStatus(key: string, text: string | undefined): void } }): void {
    ctx.ui.setStatus('eforge', undefined);
    ctx.ui.setStatus('eforge-build', undefined);
    ctx.ui.setStatus('eforge-queue', undefined);
  }

  /** Refresh the Pi footer status with active profile, build progress, and queue state. Best-effort. */
  async function refreshStatus(ctx: { cwd: string; ui: { setStatus(key: string, text: string | undefined): void } }): Promise<void> {
    if (_statusRefreshInFlight) return;
    _statusRefreshInFlight = true;
    try {
      // Profile check: null means no daemon running — clear all footer keys and bail.
      let profileResult: { data: { active: string | null; source: string; resolved: { harness?: string; name?: string } | null }; port: number } | null;
      try {
        profileResult = await piDaemonRequest<{
          active: string | null;
          source: string;
          resolved: { harness?: string; name?: string } | null;
        }>(ctx.cwd, 'GET', API_ROUTES.profileShow);
      } catch {
        profileResult = null;
      }

      if (profileResult === null) {
        // Daemon not running — clear all three footer keys and return.
        ctx.ui.setStatus('eforge', undefined);
        ctx.ui.setStatus('eforge-build', undefined);
        ctx.ui.setStatus('eforge-queue', undefined);
        return;
      }

      const profileData = profileResult.data;
      if (profileData.active && profileData.resolved?.harness) {
        ctx.ui.setStatus('eforge', `eforge: ${profileData.active} (${profileData.resolved.harness})`);
      } else {
        ctx.ui.setStatus('eforge', undefined);
      }

      let queueItems: QueueItem[] = [];
      try {
        const queueResult = await piDaemonRequest<QueueItem[]>(ctx.cwd, 'GET', API_ROUTES.queue);
        if (queueResult !== null) queueItems = queueResult.data;
      } catch {
        queueItems = [];
      }

      let hasRunningBuild = false;
      try {
        const summaries = await apiGetRunningSessionSummariesIfRunning({ cwd: ctx.cwd });
        if (summaries === null || summaries.length === 0) {
          ctx.ui.setStatus('eforge-build', undefined);
        } else if (summaries.length === 1) {
          hasRunningBuild = true;
          ctx.ui.setStatus('eforge-build', formatSingleBuildFooter(summaries[0].summary));
        } else {
          hasRunningBuild = true;
          ctx.ui.setStatus('eforge-build', formatAggregateFooter(summaries));
        }
      } catch {
        ctx.ui.setStatus('eforge-build', undefined);
      }

      ctx.ui.setStatus('eforge-queue', formatQueueFooter(queueItems, hasRunningBuild));
    } finally {
      _statusRefreshInFlight = false;
    }
  }

  function startStatusPolling(ctx: UIContext): void {
    _latestCtx = ctx;
    if (_statusPollTimer) clearInterval(_statusPollTimer);
    void refreshStatus(ctx);
    _statusPollTimer = setInterval(() => {
      if (_latestCtx) void refreshStatus(_latestCtx);
    }, 5_000);
    _statusPollTimer.unref?.();
  }

  function stopStatusPolling(): void {
    if (_statusPollTimer) {
      clearInterval(_statusPollTimer);
      _statusPollTimer = null;
    }
    if (_latestCtx) clearFooterStatus(_latestCtx);
    _latestCtx = null;
  }

  // Register session lifecycle listeners for Pi footer status.
  pi.on('session_start', async (_ev: unknown, ctx: unknown) => {
    startStatusPolling(ctx as UIContext);
  });
  pi.on('session_shutdown', async () => {
    stopStatusPolling();
  });
  // ------------------------------------------------------------------
  // Tool: eforge_build
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_build",
    label: "eforge build",
    description:
      "Enqueue a PRD source for the eforge daemon to build. Returns a sessionId and autoBuild status.",
    parameters: Type.Object({
      source: Type.String({
        description:
          "PRD file path or inline description to enqueue for building",
      }),
      profile: Type.Optional(Type.String({
        description: "Run this build on the named profile instead of the active profile",
      })),
      landingAction: Type.Optional(StringEnum(['pr', 'merge', 'leave'], {
        description: "Override the project-level landing action for this build. 'pr' opens a PR targeting the resolved base branch (requires gh CLI). 'merge' auto-merges the artifact branch into the base branch. 'leave' commits to the artifact branch and exits without merging or opening a PR.",
      })),
      landingAutoMerge: Type.Optional(Type.Boolean({
        description: "When true and landingAction is 'pr' (or default), enable GitHub PR auto-merge — the PR will be merged automatically once all required checks pass. When false, explicitly disable auto-merge even if the project default is 'always'. Omit to use the project default.",
      })),
      afterQueueId: Type.Optional(Type.String({
        description: "Optional upstream queue entry ID. When provided, the enqueued PRD gains depends_on: [afterQueueId]. Active upstream items (pending/running/waiting) are held in waiting/ and start when the upstream completes. Completed upstream items with a usable artifact are enqueued immediately as eligible dependents. Failed, skipped, and unknown IDs are rejected.",
      })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const policyChoice = await promptForBuildLandingGate(
        pi,
        ctx as unknown as UIContext,
        params.landingAction as LandingAction | undefined,
        signal,
        { landingAutoMergeOverride: params.landingAutoMerge },
      );
      if (policyChoice.cancelled) {
        return jsonResult({ status: "cancelled", message: "Build cancelled before enqueue." });
      }

      const body: EnqueueRequest = { source: params.source };
      if (params.profile) body.profile = params.profile;
      const effectiveLandingAction = policyChoice.landingAction ?? (params.landingAction as LandingAction | undefined);
      if (effectiveLandingAction) body.landingAction = effectiveLandingAction;
      const effectiveLandingAutoMerge = policyChoice.landingAutoMerge ?? params.landingAutoMerge;
      if (effectiveLandingAutoMerge !== undefined) body.landingAutoMerge = effectiveLandingAutoMerge;
      if (params.afterQueueId !== undefined) body.afterQueueId = params.afterQueueId;
      const { data, port } = await requireDaemon<EnqueueResponse>(
        ctx.cwd,
        "POST",
        API_ROUTES.enqueue,
        body,
      );
      if (_latestCtx) void refreshStatus(_latestCtx);
      return jsonResult(withMonitorUrl({ ...data, ...(policyChoice.configUpdated ? { configUpdated: true } : {}) }, port));
    },
  });

  // ------------------------------------------------------------------
  // Tool: eforge_status
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_status",
    label: "eforge status",
    description:
      "Get the current run status including plan progress, session state, event summary, and the daemon vs Pi-extension version.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      // Always include version info — diagnostic for "is the running daemon
      // stale relative to the Pi extension I have installed?". Best-effort:
      // a daemon with no eforgeVersion is pre-version-aware.
      const { data: versionData } = await requireDaemon<VersionResponse>(
        ctx.cwd,
        "GET",
        API_ROUTES.version,
      );
      const daemonVersion = versionData.eforgeVersion ?? 'unknown (pre-version-aware daemon)';
      const piExtensionVersion = PI_EFORGE_VERSION;
      const versionMismatch = getPiDaemonVersionMismatch(versionData.eforgeVersion, piExtensionVersion);
      const versions = {
        daemonVersion,
        piExtensionVersion,
        ...(versionMismatch && { versionMismatch }),
      };

      const summariesResult = await apiGetRunningSessionSummariesIfRunning({ cwd: ctx.cwd });
      if (summariesResult === null) {
        throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
      }
      const summaries = summariesResult;
      if (summaries.length === 0) {
        return jsonResult({
          status: "idle",
          message: "No active eforge sessions.",
          ...versions,
        });
      }
      return jsonResult({
        status: "active",
        builds: summaries.map(({ run, summary }) => ({
          ...summary,
          runId: run.id,
          command: run.command,
        })),
        ...versions,
      });
    },

    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("eforge status")), 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      try {
        const text = result.content[0];
        if (!text || text.type !== "text") {
          return new Text(theme.fg("muted", "No data"), 0, 0);
        }
        return renderStatusPayload(JSON.parse(text.text) as StatusToolPayload, expanded, theme);
      } catch {
        return renderStatusParseFallback(result, theme);
      }
    },
  });

  // ------------------------------------------------------------------
  // Tool: eforge_queue_list
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_queue_list",
    label: "eforge queue list",
    description:
      "List all PRDs currently in the eforge queue with their metadata.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      const { data } = await requireDaemon<QueueItem[]>(ctx.cwd, "GET", API_ROUTES.queue);
      return jsonResult(data);
    },
  });

  // --- eforge:region host-queue-controls ---
  // ------------------------------------------------------------------
  // Tool: eforge_queue_priority
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_queue_priority",
    label: "eforge queue priority",
    description:
      "Update priority for a pending or waiting PRD queue item. Lower numbers run earlier; cancel running builds by session id instead.",
    parameters: Type.Object({
      prdId: Type.String({ description: "PRD queue item id" }),
      priority: Type.Integer({ description: "Queue priority; lower numbers run earlier" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { prdId, priority } = params;
      const result = await apiUpdateQueuePriorityIfRunning({ cwd: ctx.cwd, prdId, priority });
      if (result === null) throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
      const { data } = result;
      return jsonResult(data);
    },
  });

  // ------------------------------------------------------------------
  // Tool: eforge_queue_remove
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_queue_remove",
    label: "eforge queue remove",
    description:
      "Remove a non-running PRD queue item, including failed recovery sidecars. Refuses running items and live-dependent conflicts.",
    parameters: Type.Object({
      prdId: Type.String({ description: "PRD queue item id" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { prdId } = params;
      const result = await apiRemoveQueueItemIfRunning({ cwd: ctx.cwd, prdId });
      if (result === null) throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
      const { data } = result;
      return jsonResult(data);
    },
  });
  // --- eforge:endregion host-queue-controls ---

  // ------------------------------------------------------------------
  // Tool: eforge_config
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_config",
    label: "eforge config",
    description:
      "Show resolved eforge configuration or validate eforge/config.yaml.",
    parameters: Type.Object({
      action: StringEnum(["show", "validate"] as const, {
        description:
          "'show' returns resolved config, 'validate' checks for errors",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const path =
        params.action === "validate"
          ? API_ROUTES.configValidate
          : API_ROUTES.configShow;
      const { data } = await requireDaemon(ctx.cwd, "GET", path);
      return jsonResult(data);
    },
  });

  // ------------------------------------------------------------------
  // Tool: eforge_profile
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_profile",
    label: "eforge profile",
    description:
      'Manage named profiles in eforge/profiles/. Actions: "list" enumerates profiles and reports which is active; "show" returns the resolved active profile with harness; "use" writes eforge/.active-profile to switch profiles; "create" writes a new eforge/profiles/<name>.yaml (optionally pass `metadata` with `description`, `whenToUse`, and `tags` — descriptive only, does not affect runtime behavior); "delete" removes a profile (refuses when active unless force: true).',
    parameters: Type.Object({
      action: StringEnum(["list", "show", "use", "create", "delete"] as const, {
        description:
          "'list' enumerates profiles, 'show' returns the resolved active profile, 'use' switches the active profile, 'create' writes a new profile, 'delete' removes a profile",
      }),
      name: Type.Optional(
        Type.String({
          description:
            'Profile name (required for "use", "create", and "delete")',
        }),
      ),
      harness: Type.Optional(
        StringEnum(["claude-sdk", "pi"] as const, {
          description: 'Harness kind (required for "create")',
        }),
      ),
      pi: Type.Optional(
        Type.Record(Type.String(), Type.Any(), {
          description:
            'Pi-specific config to embed in the profile (optional, "create" only)',
        }),
      ),
      agents: Type.Optional(
        Type.Record(Type.String(), Type.Any(), {
          description:
            'Agents config block to embed in the profile (optional, "create" only)',
        }),
      ),
      metadata: Type.Optional(
        Type.Object({
          description: Type.Optional(Type.String({ description: 'Human-readable description of what this profile is for' })),
          whenToUse: Type.Optional(Type.Array(Type.String(), { description: 'Scenarios when this profile should be used' })),
          tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for categorizing this profile' })),
        }, { description: 'Descriptive metadata for the profile (does not affect runtime behavior)' }),
      ),
      overwrite: Type.Optional(
        Type.Boolean({
          description:
            "Overwrite an existing profile when creating. Default: false.",
        }),
      ),
      force: Type.Optional(
        Type.Boolean({
          description:
            "Delete even if the profile is currently active. Default: false.",
        }),
      ),
      scope: Type.Optional(
        Type.Union([Type.Literal("local"), Type.Literal("project"), Type.Literal("user"), Type.Literal("all")], {
          description:
            'Scope for the operation. "list" accepts local|project|user|all (default: all). "use", "create", "delete" accept local|project|user (default: project). "local" targets .eforge/ (gitignored, dev-personal, highest precedence). "show" ignores scope (resolves via precedence).',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { action, name, harness, pi: piCfg, agents, metadata, overwrite, force, scope } =
        params;

      if (action === "list") {
        const { data } = await requireDaemon(
          ctx.cwd,
          "GET",
          buildProfileListPath({ scope: scope ?? "all" }),
        );
        return jsonResult(data);
      }

      if (action === "show") {
        const { data } = await requireDaemon(ctx.cwd, "GET", API_ROUTES.profileShow);
        return jsonResult(data);
      }

      if (action === "use") {
        if (!name) {
          throw new Error('"name" is required when action is "use"');
        }
        const useBody: Record<string, unknown> = { name };
        if (scope) useBody.scope = scope;
        const { data } = await requireDaemon(
          ctx.cwd,
          "POST",
          API_ROUTES.profileUse,
          useBody,
        );
        if (_latestCtx) await refreshStatus(_latestCtx);
        return jsonResult(data);
      }

      if (action === "create") {
        if (!name) {
          throw new Error('"name" is required when action is "create"');
        }
        if (harness !== "claude-sdk" && harness !== "pi") {
          throw new Error(
            '"harness" is required when action is "create" (must be "claude-sdk" or "pi")',
          );
        }
        const body: Record<string, unknown> = { name, harness };
        if (piCfg !== undefined) body.pi = piCfg;
        if (agents !== undefined) body.agents = agents;
        if (metadata !== undefined) body.metadata = metadata;
        if (overwrite !== undefined) body.overwrite = overwrite;
        if (scope) body.scope = scope;
        const { data } = await requireDaemon(
          ctx.cwd,
          "POST",
          API_ROUTES.profileCreate,
          body,
        );
        if (_latestCtx) await refreshStatus(_latestCtx);
        return jsonResult(data);
      }

      // action === 'delete'
      if (!name) {
        throw new Error('"name" is required when action is "delete"');
      }
      const body: Record<string, unknown> = {};
      if (force !== undefined) body.force = force;
      if (scope) body.scope = scope;
      const { data } = await requireDaemon(
        ctx.cwd,
        "DELETE",
        buildPath(API_ROUTES.profileDelete, { name }),
        body,
      );
      return jsonResult(data);
    },

    renderCall(args, theme) {
      const action = typeof args.action === "string" ? args.action : "?";
      const name = typeof args.name === "string" ? args.name : "";
      const suffix = name ? ` ${name}` : "";
      return new Text(
        theme.fg("toolTitle", theme.bold(`eforge profile ${action}${suffix}`)),
        0,
        0,
      );
    },

    renderResult(result, _options, theme) {
      const text = result.content[0];
      if (!text || text.type !== "text") {
        return new Text(theme.fg("muted", "No data"), 0, 0);
      }
      try {
        const data = JSON.parse(text.text) as Record<string, unknown>;
        const lines: string[] = [];

        if (Array.isArray((data as { profiles?: unknown }).profiles)) {
          const profileList = data as unknown as ProfileListResponse;
          const profiles = profileList.profiles;
          const active = profileList.active;
          const source = profileList.source;
          lines.push(
            theme.fg("accent", `${profiles.length} profile(s)`) +
              theme.fg("dim", `  source: ${source}`),
          );
          for (const p of profiles) {
            const marker = active === p.name ? theme.fg("success", "● ") : theme.fg("muted", "○ ");
            lines.push(`  ${marker}${theme.fg("text", p.name)}`);
          }
        } else if ("resolved" in data) {
          const active = (data as { active?: string | null }).active ?? null;
          const source = (data as { source?: string }).source ?? "none";
          const resolved = (data as { resolved?: { harness?: string; profile?: unknown } }).resolved;
          lines.push(
            theme.fg("accent", `active: ${active ?? "(none)"}`) +
              theme.fg("dim", `  source: ${source}`),
          );
          if (resolved?.harness) {
            lines.push(theme.fg("dim", `  harness: ${resolved.harness}`));
          }
          // Show tier toolbelt assignments when present in the resolved profile config
          const profileCfg = resolved?.profile as {
            agents?: { tiers?: Record<string, { toolbelt?: string }> };
            tools?: { toolbelts?: Record<string, { mcpServers?: string[] }> };
          } | null | undefined;
          const tiers = profileCfg?.agents?.tiers;
          if (tiers && Object.keys(tiers).length > 0) {
            const toolbeltsRegistry = profileCfg?.tools?.toolbelts ?? {};
            const hasTierToolbelts = Object.values(tiers).some((t) => t.toolbelt !== undefined);
            if (hasTierToolbelts) {
              lines.push(theme.fg("dim", "  tier toolbelts:"));
              for (const [tierName, tier] of Object.entries(tiers)) {
                if (tier.toolbelt === undefined) continue;
                const tb = tier.toolbelt;
                const servers = tb !== 'none' ? (toolbeltsRegistry[tb]?.mcpServers ?? []) : [];
                const serverSuffix = servers.length > 0 ? ` (${[...servers].sort().join(', ')})` : '';
                lines.push(theme.fg("dim", `    ${tierName}: ${tb}${serverSuffix}`));
              }
            }
          }
        } else if ("active" in data) {
          lines.push(theme.fg("success", `✓ active: ${String((data as { active?: unknown }).active)}`));
        } else if ("path" in data) {
          lines.push(theme.fg("success", `✓ created: ${String((data as { path?: unknown }).path)}`));
        } else if ("deleted" in data) {
          lines.push(theme.fg("success", `✓ deleted: ${String((data as { deleted?: unknown }).deleted)}`));
        } else {
          lines.push(theme.fg("muted", text.text));
        }
        return new Text(lines.join("\n"), 0, 0);
      } catch {
        return new Text(theme.fg("muted", text.text), 0, 0);
      }
    },
  });

  // ------------------------------------------------------------------
  // Tool: eforge_extension
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_extension",
    label: "eforge extension",
    description:
      'Manage native eforge extensions with compact host-safe output by default. For extension-authored actions, page through eforge_extension_contribution list results and use eforge_extension_contribution show for selected detail before falling back to CLI --json or daemon/client HTTP diagnostics. Actions: "list" returns compact extension entries with status/provenance/diagnostic counts; "show" returns one compact extension by name; "validate" returns valid:false when extension load errors exist, optionally scoped to a name or ad-hoc path; "test" dry-runs onEvent hooks against fixture or monitor events; "new" scaffolds an extension; "reload" refreshes discovery and restarts the runtime watcher when running; "trust" writes a local trust record for a project-team extension without executing it; "untrust" removes the trust record for a project-team extension; "install" installs a package extension from npm, a local path, or tarball; "update" updates an installed extension package; "remove" removes an installed extension package; "promote" promotes a project-local extension to project-team scope; "demote" demotes a project-team extension to project-local scope.',
    parameters: Type.Object({
      action: StringEnum(["list", "show", "validate", "test", "new", "reload", "trust", "untrust", "install", "update", "remove", "promote", "demote"] as const, {
        description: "Extension operation to perform",
      }),
      name: Type.Optional(
        Type.String({
          minLength: 1,
          description: 'Extension name (required for "show" and "new", optional for "validate", "test", "trust", "untrust", "update", "remove", "promote", and "demote"; name override for "install")',
        }),
      ),
      path: Type.Optional(
        Type.String({
          minLength: 1,
          description: 'Ad-hoc extension file/directory path to validate, test, trust, untrust, update, remove, promote, or demote',
        }),
      ),
      fixture: Type.Optional(Type.String({
        minLength: 1,
        description: 'Project-local JSON/JSONL event fixture to replay ("test" only)',
      })),
      run: Type.Optional(Type.String({
        minLength: 1,
        description: 'Monitor DB event source to replay: "latest" or a session/run id ("test" only)',
      })),
      event: Type.Optional(Type.String({
        minLength: 1,
        description: 'Exact event type filter for replay ("test" only)',
      })),
      scope: Type.Optional(StringEnum(["local", "project", "user"] as const, {
        description: 'Scope for "new" or "install". Defaults to local.',
      })),
      template: Type.Optional(StringEnum(["event-logger", "blank"] as const, {
        description: 'Scaffold template for "new". Defaults to event-logger.',
      })),
      force: Type.Optional(Type.Boolean({
        description: 'Overwrite an existing extension or force operation. Default: false.',
      })),
      trustedBy: Type.Optional(Type.String({
        minLength: 1,
        description: 'Optional annotation identifying who is trusting the extension ("trust", "install", "update", and "promote" only).',
      })),
      source: Type.Optional(Type.String({
        minLength: 1,
        description: 'Package source for "install": npm package name, local path, or local tarball path.',
      })),
      trust: Type.Optional(Type.Boolean({
        description: 'Trust the extension after the operation ("install", "update", and "promote" only).',
      })),
      version: Type.Optional(Type.String({
        minLength: 1,
        description: 'Version specifier or dist-tag for npm-installed extensions ("update" only).',
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const result = await dispatchEforgeExtensionAction({
          cwd: ctx.cwd,
          params,
          helpers: piExtensionActionHelpers,
        });
        if (result === null) throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
        return jsonResult(projectExtensionManagementResponse(params.action, result.data));
      } catch (err) {
        throw await appendExtensionErrorVersionHint(err, { cwd: ctx.cwd, callerVersion: PI_EFORGE_VERSION });
      }
    },
  });

  registerExtensionContributionTool(pi);

  // ------------------------------------------------------------------
  // Tool: eforge_models
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_models",
    label: "eforge models",
    description:
      'List providers or models available for a given harness. Actions: "providers" returns provider names (claude-sdk is implicit / returns []); "list" returns models, optionally filtered to a single provider, newest-first.',
    parameters: Type.Object({
      action: StringEnum(["providers", "list"] as const, {
        description:
          "'providers' returns provider names, 'list' returns available models",
      }),
      harness: StringEnum(["claude-sdk", "pi"] as const, {
        description: "Which harness to query",
      }),
      provider: Type.Optional(
        Type.String({
          description:
            'Optional provider filter for "list" (Pi only). Ignored for claude-sdk.',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === "providers") {
        const { data } = await requireDaemon(
          ctx.cwd,
          "GET",
          `${API_ROUTES.modelProviders}?harness=${encodeURIComponent(params.harness)}`,
        );
        return jsonResult(data);
      }
      const searchParams = new URLSearchParams({ harness: params.harness });
      if (params.provider) searchParams.set("provider", params.provider);
      const { data } = await requireDaemon(
        ctx.cwd,
        "GET",
        `${API_ROUTES.modelList}?${searchParams.toString()}`,
      );
      return jsonResult(data);
    },

    renderCall(args, theme) {
      const action = typeof args.action === "string" ? args.action : "?";
      const harness = typeof args.harness === "string" ? args.harness : "?";
      const provider = typeof args.provider === "string" ? args.provider : "";
      const suffix = provider ? ` / ${provider}` : "";
      return new Text(
        theme.fg(
          "toolTitle",
          theme.bold(`eforge models ${action} ${harness}${suffix}`),
        ),
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      const text = result.content[0];
      if (!text || text.type !== "text") {
        return new Text(theme.fg("muted", "No data"), 0, 0);
      }
      try {
        const data = JSON.parse(text.text) as Record<string, unknown>;
        const lines: string[] = [];

        if (Array.isArray((data as { providers?: unknown }).providers)) {
          const providers = (data as { providers: string[] }).providers;
          lines.push(theme.fg("accent", `${providers.length} provider(s)`));
          for (const p of providers) {
            lines.push(`  ${theme.fg("text", p)}`);
          }
        } else if (Array.isArray((data as { models?: unknown }).models)) {
          const models = (data as {
            models: Array<{ id: string; provider?: string; releasedAt?: string }>;
          }).models;
          lines.push(theme.fg("accent", `${models.length} model(s)`));
          const limit = expanded ? models.length : Math.min(10, models.length);
          for (let i = 0; i < limit; i += 1) {
            const m = models[i];
            const provider = m.provider ? theme.fg("dim", ` [${m.provider}]`) : "";
            const released = m.releasedAt ? theme.fg("dim", `  ${m.releasedAt}`) : "";
            lines.push(`  ${theme.fg("text", m.id)}${provider}${released}`);
          }
          if (!expanded && models.length > limit) {
            lines.push(theme.fg("dim", `  ... ${models.length - limit} more (expand to see all)`));
          }
        } else {
          lines.push(theme.fg("muted", text.text));
        }
        return new Text(lines.join("\n"), 0, 0);
      } catch {
        return new Text(theme.fg("muted", text.text), 0, 0);
      }
    },
  });

  // ------------------------------------------------------------------
  // Tool: eforge_daemon
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_daemon",
    label: "eforge daemon",
    description:
      "Manage the eforge daemon lifecycle: start, stop, or restart the daemon.",
    parameters: Type.Object({
      action: StringEnum(["start", "stop", "restart"] as const, {
        description:
          "'start' ensures daemon is running, 'stop' gracefully stops it, 'restart' stops then starts",
      }),
      force: Type.Optional(
        Type.Boolean({
          description:
            'When action is "stop" or "restart", force shutdown even if builds are active. Default: false.',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { action, force } = params;

      if (action === "start") {
        const port = await ensureDaemon(ctx.cwd);
        return jsonResult({ status: "running", port });
      }

      if (action === "stop") {
        const result = await stopDaemon(ctx.cwd, force === true);
        if (!result.stopped) {
          throw new Error(result.message);
        }
        return jsonResult({
          status: "stopped",
          message: result.message,
        });
      }

      // restart
      const stopResult = await stopDaemon(ctx.cwd, force === true);
      if (!stopResult.stopped) {
        throw new Error(stopResult.message);
      }
      const port = await ensureDaemon(ctx.cwd);
      return jsonResult({
        status: "restarted",
        port,
        message: "Daemon restarted successfully.",
      });
    },
  });

  // ------------------------------------------------------------------
  // Tool: eforge_auto_build
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_auto_build",
    label: "eforge auto build",
    description:
      "Get or set the daemon auto-build state. When enabled, the daemon automatically builds PRDs as they are enqueued.",
    parameters: Type.Object({
      action: StringEnum(["get", "set"] as const, {
        description:
          "'get' returns current auto-build state, 'set' updates it",
      }),
      enabled: Type.Optional(
        Type.Boolean({
          description:
            'Required when action is "set". Whether auto-build should be enabled.',
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (params.action === "get") {
        const { data } = await requireDaemon<AutoBuildState>(
          ctx.cwd,
          "GET",
          API_ROUTES.autoBuildGet,
        );
        return jsonResult(data);
      }
      if (params.enabled === undefined) {
        throw new Error('"enabled" is required when action is "set"');
      }
      const { data } = await requireDaemon<AutoBuildState>(
        ctx.cwd,
        "POST",
        API_ROUTES.autoBuildSet,
        { enabled: params.enabled },
      );
      return jsonResult(data);
    },
  });

  // ------------------------------------------------------------------
  // Tool: eforge_init
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_init",
    label: "eforge init",
    description:
      "Initialize eforge in a project. The skill is responsible for picking provider/model interactively; the tool is a pure persister. Pass `profile` with the assembled multi-runtime spec (every runtime must use harness: 'pi'). With migrate: true, extracts legacy harness config from a pre-overhaul config.yaml. Pass `trunkBranch` and `allowLocalMergeToTrunk` to configure the branch protection policy.",
    parameters: Type.Object({
      force: Type.Optional(
        Type.Boolean({
          description:
            "Overwrite existing eforge/config.yaml if it already exists. Default: false.",
        }),
      ),
      postMergeCommands: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Post-merge validation commands. Only applied when creating a new config.',
        }),
      ),
      landingAction: Type.Optional(StringEnum(['pr', 'merge', 'leave'], {
        description: "Landing action to persist in eforge/config.yaml under landing.action. 'pr' opens a PR targeting the resolved base branch (requires gh CLI). 'merge' auto-merges the artifact branch into the base branch. 'leave' commits to the artifact branch and exits without merging or opening a PR.",
      })),
      trunkBranch: Type.Optional(
        Type.String({
          description: "The trunk branch name (e.g. 'main', 'master'). Stored as build.trunkBranch in eforge/config.yaml. When omitted, eforge resolves trunk via git symbolic-ref at runtime.",
        }),
      ),
      allowLocalMergeToTrunk: Type.Optional(
        Type.Boolean({
          description: "When true, landing.action: merge is allowed to land directly on the trunk branch without a PR. Default: false (trunk is protected). Enable only for solo developers on unprotected branches.",
        }),
      ),
      stackingEnabled: Type.Optional(
        Type.Boolean({
          description: "Persist stacking.enabled for git-spice-backed stacked PR workflows.",
        }),
      ),
      gitSpiceCommand: Type.Optional(
        Type.String({
          description: "Persist stacking.gitSpice.command (path or command name for the git-spice executable).",
        }),
      ),
      migrate: Type.Optional(
        Type.Boolean({
          description:
            "Extract legacy harness config from existing pre-overhaul config.yaml into a named profile and strip config.yaml. Default: false.",
        }),
      ),
      existingProfile: Type.Optional(
        Type.Object({
          name: Type.String({ description: 'Name of the existing local- or user-scope profile to activate.' }),
          scope: StringEnum(['local', 'user']),
        }, { description: 'Existing local- or user-scope profile to activate. Existing profiles may use any supported harness. When provided, skips profile creation and activates directly. Mutually exclusive with `profile` and `migrate`.' }),
      ),
      profile: Type.Optional(
        Type.Object({
          name: Type.Optional(Type.String({ description: "Profile name. Auto-derived via deriveProfileName when omitted." })),
          agentRuntimes: Type.Record(
            Type.String(),
            Type.Object({
              harness: StringEnum(["pi"]),
              pi: Type.Optional(Type.Object({ provider: Type.String() })),
            }),
          ),
          defaultAgentRuntime: Type.String(),
          models: Type.Optional(Type.Object({
            max: Type.Optional(Type.Object({ id: Type.String() })),
            balanced: Type.Optional(Type.Object({ id: Type.String() })),
            fast: Type.Optional(Type.Object({ id: Type.String() })),
          })),
          tiers: Type.Optional(Type.Object({
            max: Type.Optional(Type.Object({ agentRuntime: Type.String() })),
            balanced: Type.Optional(Type.Object({ agentRuntime: Type.String() })),
            fast: Type.Optional(Type.Object({ agentRuntime: Type.String() })),
          })),
        }, { description: "Multi-runtime profile spec. All runtimes must use harness: 'pi'. When omitted, falls back to a minimal pi-anthropic default and emits a deprecation note." }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const configDir = join(ctx.cwd, "eforge");
      const configPath = join(configDir, "config.yaml");

      // Ensure .gitignore has daemon state and active-profile marker
      ensureGitignoreEntries(ctx.cwd, [".eforge/", "eforge/.active-profile"]);

      // --- Conflict validation ---
      if (params.existingProfile) {
        if (params.profile) {
          throw new Error('`existingProfile` and `profile` cannot be set at the same time.');
        }
        if (params.migrate) {
          throw new Error('`existingProfile` and `migrate` cannot be set at the same time.');
        }
        if (params.existingProfile.scope !== 'local' && params.existingProfile.scope !== 'user') {
          throw new Error('The init skill only supports local- or user-scope existing profiles. Use `existingProfile.scope: "local"` or `"user"`.');
        }
      }

      // --- Migrate mode ---
      if (params.migrate) {
        let rawYaml: string;
        try {
          rawYaml = readFileSync(configPath, "utf-8");
        } catch {
          throw new Error("No existing eforge/config.yaml found. Nothing to migrate.");
        }

        let parsed: unknown;
        try {
          parsed = parseYaml(rawYaml);
          if (!parsed || typeof parsed !== "object") {
            throw new Error("Existing config.yaml is empty or not an object.");
          }
        } catch (err) {
          throw new Error(`Failed to parse config.yaml: ${err instanceof Error ? err.message : String(err)}`);
        }

        const data = parsed as Record<string, unknown>;
        if (data.backend === undefined) {
          throw new Error('config.yaml has no top-level "backend:" field. Nothing to migrate.');
        }

        const { profile: legacyProfile, remaining } = parseRawConfigLegacy(data);
        const harness = legacyProfile.backend as string;

        let maxModelId: string | undefined;
        let provider: string | undefined;
        const agents = legacyProfile.agents as Record<string, unknown> | undefined;
        if (agents?.models) {
          const models = agents.models as Record<string, unknown>;
          const maxModel = models.max as { id?: string; provider?: string } | undefined;
          maxModelId = maxModel?.id;
          provider = maxModel?.provider;
        } else if (agents?.model) {
          const model = agents.model as { id?: string; provider?: string };
          maxModelId = model.id;
          provider = model.provider;
        }

        const profileName = maxModelId
          ? sanitizeProfileName(harness, provider, maxModelId)
          : harness;

        const createBody: Record<string, unknown> = {
          name: profileName,
          harness,
          overwrite: true,
        };
        if (legacyProfile.agents) createBody.agents = legacyProfile.agents;
        if (legacyProfile.pi) createBody.pi = legacyProfile.pi;

        await requireDaemon(ctx.cwd, "POST", API_ROUTES.profileCreate, createBody);

        // Rewrite config.yaml with remaining fields only (no backend:) before
        // activating the profile, so a failed write leaves the profile inactive
        // (cleanly recoverable by re-running migrate).
        const yamlOut = Object.keys(remaining).length > 0
          ? stringifyYaml(remaining)
          : "";
        writeFileSync(configPath, yamlOut, "utf-8");

        await requireDaemon(ctx.cwd, "POST", API_ROUTES.profileUse, { name: profileName });

        if (_latestCtx) await refreshStatus(_latestCtx);

        return jsonResult({
          status: "migrated",
          configPath: "eforge/config.yaml",
          profileName,
          profilePath: `eforge/profiles/${profileName}.yaml`,
          harness,
          moved: Object.keys(legacyProfile),
          kept: Object.keys(remaining),
        });
      }

      // --- Existing profile mode ---

      if (params.existingProfile) {
        let configExists = false;
        try {
          accessSync(configPath);
          configExists = true;
        } catch (err) {
          if (err instanceof Error && !('code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')) {
            throw err;
          }
          // File does not exist - proceed
        }
        if (configExists && !params.force) {
          throw new Error(
            "eforge/config.yaml already exists. Use force: true to overwrite, or migrate: true to extract legacy harness config into a profile.",
          );
        }

        // Write a sentinel file before calling profile/use so the daemon can
        // discover this fresh project's eforge config directory.
        let wroteExistingProfileSentinel = false;
        if (!configExists) {
          mkdirSync(configDir, { recursive: true });
          writeFileSync(configPath, "", "utf-8");
          wroteExistingProfileSentinel = true;
        }

        try {
          await requireDaemon(ctx.cwd, "POST", API_ROUTES.profileUse, { name: params.existingProfile.name, scope: params.existingProfile.scope });
        } catch (err) {
          if (wroteExistingProfileSentinel) {
            try {
              unlinkSync(configPath);
            } catch (cleanupErr) {
              process.stderr.write(`eforge_init: failed to remove sentinel ${configPath} after profileUse error: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}\n`);
            }
          }
          throw err;
        }

        const existingProfileConfigData: Record<string, unknown> = {};
        const existingProfileBuildBlock: Record<string, unknown> = {};
        if (params.postMergeCommands && params.postMergeCommands.length > 0) existingProfileBuildBlock.postMergeCommands = params.postMergeCommands;
        if (params.trunkBranch) existingProfileBuildBlock.trunkBranch = params.trunkBranch;
        if (params.allowLocalMergeToTrunk !== undefined) existingProfileBuildBlock.allowLocalMergeToTrunk = params.allowLocalMergeToTrunk;
        if (Object.keys(existingProfileBuildBlock).length > 0) existingProfileConfigData.build = existingProfileBuildBlock;
        if (params.landingAction) existingProfileConfigData.landing = { action: params.landingAction };
        if (params.stackingEnabled !== undefined || params.gitSpiceCommand !== undefined) {
          existingProfileConfigData.stacking = {
            ...(params.stackingEnabled !== undefined && { enabled: params.stackingEnabled }),
            ...(params.gitSpiceCommand !== undefined && { gitSpice: { command: params.gitSpiceCommand } }),
          };
        }
        const existingProfileConfigContent = Object.keys(existingProfileConfigData).length > 0
          ? stringifyYaml(existingProfileConfigData)
          : "";
        writeFileSync(configPath, existingProfileConfigContent, "utf-8");

        let existingProfileValidation: ConfigValidateResponse | null = null;
        try {
          const { data } = await requireDaemon<ConfigValidateResponse>(
            ctx.cwd,
            "GET",
            API_ROUTES.configValidate,
          );
          existingProfileValidation = data;
        } catch {
          // Daemon validation is best-effort
        }

        if (_latestCtx) await refreshStatus(_latestCtx);

        const existingProfileResponse: Record<string, unknown> = {
          status: "initialized",
          configPath: "eforge/config.yaml",
          profileName: params.existingProfile.name,
          source: `${params.existingProfile.scope}-scope`,
          activatedExistingProfile: true,
        };
        if (existingProfileValidation) existingProfileResponse.validation = existingProfileValidation;
        return jsonResult(existingProfileResponse);
      }

      // --- Fresh init mode ---

      let freshConfigExists = false;
      try {
        accessSync(configPath);
        freshConfigExists = true;
      } catch (err) {
        if (err instanceof Error && !('code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')) {
          throw err;
        }
        // File does not exist - proceed
      }
      if (freshConfigExists && !params.force) {
        throw new Error(
          "eforge/config.yaml already exists. Use force: true to overwrite, or migrate: true to extract legacy harness config into a profile.",
        );
      }

      // Resolve effective profile spec
      let deprecation: string | undefined;
      let resolvedSpec: {
        agentRuntimes: Record<string, { harness: "pi"; pi?: { provider: string } }>;
        defaultAgentRuntime: string;
        models?: { max?: { id: string }; balanced?: { id: string }; fast?: { id: string } };
        tiers?: { max?: { agentRuntime: string }; balanced?: { agentRuntime: string }; fast?: { agentRuntime: string } };
      };

      if (params.profile) {
        // Validate that every runtime uses harness: 'pi'
        for (const [runtimeName, runtimeEntry] of Object.entries(params.profile.agentRuntimes)) {
          if ((runtimeEntry as { harness: string }).harness !== "pi") {
            throw new Error(
              `Runtime "${runtimeName}" uses harness "${(runtimeEntry as { harness: string }).harness}" but the Pi extension only supports harness: "pi". Use the Claude Code MCP proxy for claude-sdk runtimes.`,
            );
          }
          if (!(runtimeEntry as { pi?: { provider: string } }).pi?.provider) {
            throw new Error(
              `Runtime "${runtimeName}" is missing pi.provider. Each pi runtime must specify a provider (e.g. "anthropic", "openrouter").`,
            );
          }
        }
        resolvedSpec = {
          agentRuntimes: params.profile.agentRuntimes as Record<string, { harness: "pi"; pi?: { provider: string } }>,
          defaultAgentRuntime: params.profile.defaultAgentRuntime,
          models: params.profile.models,
          tiers: params.profile.tiers,
        };
      } else {
        // Pi-only minimal default fallback
        resolvedSpec = {
          agentRuntimes: { "pi-anthropic": { harness: "pi", pi: { provider: "anthropic" } } },
          defaultAgentRuntime: "pi-anthropic",
          models: {
            max: { id: "claude-opus-4-7" },
            balanced: { id: "claude-opus-4-7" },
            fast: { id: "claude-opus-4-7" },
          },
        };
        deprecation = "eforge_init was called without a profile parameter. Future versions will require it.";
      }

      // Compute profile name (use skill-supplied name if present, otherwise derive)
      const derivedProfileSpec = {
        agents: {
          tiers: Object.fromEntries(
            (['max', 'balanced', 'fast'] as const).map((tier) => {
              const runtimeName = resolvedSpec.tiers?.[tier]?.agentRuntime ?? resolvedSpec.defaultAgentRuntime;
              const runtime = resolvedSpec.agentRuntimes[runtimeName] ?? resolvedSpec.agentRuntimes[resolvedSpec.defaultAgentRuntime];
              return [tier, {
                harness: 'pi' as const,
                pi: runtime?.pi,
                model: resolvedSpec.models?.[tier]?.id,
              }];
            }),
          ),
        },
      };
      const profileName = params.profile?.name ?? deriveProfileName(derivedProfileSpec);

      // Build agents block
      const agentsBlock: Record<string, unknown> = {};
      if (resolvedSpec.models) agentsBlock.models = resolvedSpec.models;
      if (resolvedSpec.tiers) agentsBlock.tiers = resolvedSpec.tiers;

      const createBody: Record<string, unknown> = {
        name: profileName,
        overwrite: !!params.force,
        agentRuntimes: resolvedSpec.agentRuntimes,
        defaultAgentRuntime: resolvedSpec.defaultAgentRuntime,
      };
      if (Object.keys(agentsBlock).length > 0) createBody.agents = agentsBlock;

      // Write a sentinel file so the daemon can discover the config directory.
      let wroteSentinel = false;
      if (!freshConfigExists) {
        mkdirSync(configDir, { recursive: true });
        writeFileSync(configPath, "", "utf-8");
        wroteSentinel = true;
      }

      try {
        await requireDaemon(ctx.cwd, "POST", API_ROUTES.profileCreate, createBody);

        // Activate the profile
        await requireDaemon(ctx.cwd, "POST", API_ROUTES.profileUse, { name: profileName });
      } catch (err) {
        if (wroteSentinel) {
          try {
            unlinkSync(configPath);
          } catch (cleanupErr) {
            process.stderr.write(`eforge_init: failed to remove sentinel ${configPath} after profile setup error: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}\n`);
          }
        }
        throw err;
      }

      // Write config.yaml
      const configData: Record<string, unknown> = {};
      const buildBlock: Record<string, unknown> = {};
      if (params.postMergeCommands && params.postMergeCommands.length > 0) buildBlock.postMergeCommands = params.postMergeCommands;
      if (params.trunkBranch) buildBlock.trunkBranch = params.trunkBranch;
      if (params.allowLocalMergeToTrunk !== undefined) buildBlock.allowLocalMergeToTrunk = params.allowLocalMergeToTrunk;
      if (Object.keys(buildBlock).length > 0) configData.build = buildBlock;
      if (params.landingAction) configData.landing = { action: params.landingAction };
      if (params.stackingEnabled !== undefined || params.gitSpiceCommand !== undefined) {
        configData.stacking = {
          ...(params.stackingEnabled !== undefined && { enabled: params.stackingEnabled }),
          ...(params.gitSpiceCommand !== undefined && { gitSpice: { command: params.gitSpiceCommand } }),
        };
      }
      const configContent = Object.keys(configData).length > 0
        ? stringifyYaml(configData)
        : "";
      writeFileSync(configPath, configContent, "utf-8");

      // Validate config via daemon (best-effort)
      let validation: ConfigValidateResponse | null = null;
      try {
        const { data } = await requireDaemon<ConfigValidateResponse>(
          ctx.cwd,
          "GET",
          API_ROUTES.configValidate,
        );
        validation = data;
      } catch {
        // Daemon validation is best-effort
      }

      if (_latestCtx) await refreshStatus(_latestCtx);

      const response: Record<string, unknown> = {
        status: "initialized",
        configPath: "eforge/config.yaml",
        profileName,
        profilePath: `eforge/profiles/${profileName}.yaml`,
        agentRuntimes: Object.keys(resolvedSpec.agentRuntimes),
      };

      if (validation) response.validation = validation;
      if (deprecation) response.deprecation = deprecation;

      return jsonResult(response);
    },
  });

  // ------------------------------------------------------------------
  // Tool: eforge_confirm_build
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_confirm_build",
    label: "eforge confirm build",
    description:
      "Open an editor-first review flow so the user can revise, confirm, or cancel a build source before enqueuing. Returns the user's choice and confirmed source.",
    parameters: Type.Object({
      source: Type.String({
        description:
          "The assembled PRD source text to preview for confirmation",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return jsonResult({ choice: "confirm", source: params.source, note: "No UI available, auto-confirming" });
      }

      const items = [
        { value: "confirm", label: "✓ Confirm", description: "Enqueue this edited source" },
        { value: "edit", label: "✎ Revise again", description: "Return to the editor" },
        { value: "cancel", label: "✗ Cancel", description: "Abort" },
      ];

      let source = params.source;
      while (true) {
        const editedSource = await ctx.ui.editor("eforge - Review Build Source", source);
        if (editedSource === undefined) {
          return jsonResult({ choice: "cancel" });
        }
        source = editedSource;

        const choice = await showSelectPanel(ctx, "eforge - Confirm Build", items);
        if (choice === "confirm") {
          return jsonResult({ choice: "confirm", source });
        }
        if (choice !== "edit") {
          return jsonResult({ choice: "cancel" });
        }
      }
    },

    renderCall(args, theme) {
      const source = typeof args.source === "string" ? args.source : "";
      const truncated = (source.length > 200 ? source.slice(0, 200) + "..." : source).replace(/\n/g, " ");
      const text =
        theme.fg("toolTitle", theme.bold("eforge confirm build ")) +
        theme.fg("muted", `Source preview (${source.length} chars)`) +
        "\n" +
        theme.fg("dim", `  ${truncated}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const text = result.content[0];
      let choice = "unknown";
      try {
        if (text?.type === "text") {
          const parsed = JSON.parse(text.text);
          choice = parsed.choice ?? "unknown";
        }
      } catch {
        // fallback
      }

      const icons: Record<string, string> = {
        confirm: theme.fg("success", "✓ ") + theme.fg("accent", "Confirmed"),
        edit: theme.fg("warning", "✎ ") + theme.fg("accent", "Edit requested"),
        cancel: theme.fg("error", "✗ ") + theme.fg("muted", "Cancelled"),
      };

      return new Text(icons[choice] ?? theme.fg("muted", choice), 0, 0);
    },
  });


  // ------------------------------------------------------------------
  // Tool: eforge_recover
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_recover",
    label: "eforge recover",
    description:
      "Trigger failure recovery analysis for a failed build plan. Spawns the recovery agent as a background subprocess and returns its sessionId and pid.",
    parameters: Type.Object({
      setName: Type.String({
        description: "The plan set name (e.g. the orchestration set that contained the failing plan)",
      }),
      prdId: Type.String({
        description: "The plan ID (prdId) that failed and needs recovery analysis",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { data } = await requireDaemon(
        ctx.cwd,
        "POST",
        API_ROUTES.recover,
        { setName: params.setName, prdId: params.prdId },
      );
      return jsonResult(data);
    },
  });

  // ------------------------------------------------------------------
  // Tool: eforge_read_recovery_sidecar
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_read_recovery_sidecar",
    label: "eforge read recovery sidecar",
    description:
      "Read the recovery analysis sidecar files for a failed build plan. Returns both the markdown summary and the structured JSON verdict produced by the recovery agent.",
    parameters: Type.Object({
      prdId: Type.String({
        description: "The plan ID (prdId) whose recovery sidecar to read",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const queryParams = new URLSearchParams({ prdId: params.prdId });
      const { data } = await requireDaemon(
        ctx.cwd,
        "GET",
        `${API_ROUTES.readRecoverySidecar}?${queryParams.toString()}`,
      );
      return jsonResult(data);
    },
  });


  // ------------------------------------------------------------------
  // Tool: eforge_apply_recovery
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_apply_recovery",
    label: "eforge apply recovery",
    description:
      "Apply the recovery verdict for a failed build plan. The action is performed in-process by the daemon and completes synchronously — no worker subprocess is spawned. " +
      "Response shape includes verdict: 'retry' | 'continue-repair' | 'abandon' | 'manual'. " +
      "retry starts fresh, continue-repair queues preserved compiled artifacts for repair, abandon archives the failed PRD, and manual returns noAction: true without mutation.",
    parameters: Type.Object({
      prdId: Type.String({
        description: "The plan ID (prdId) whose recovery verdict to apply",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { data } = await requireDaemon(
        ctx.cwd,
        "POST",
        API_ROUTES.applyRecovery,
        { prdId: params.prdId },
      );
      return jsonResult(data);
    },
  });



  // ------------------------------------------------------------------
  // Tool: eforge_continue_repair
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_continue_repair",
    label: "eforge continue repair",
    description: "Queue a continue-and-repair build from preserved compiled artifacts. Use when a failed PRD has eligible compiled artifacts and should continue from them with repair work. Returns queued metadata including PRD id, set name, branches, moved descendants, and optional profile; no sessionId or pid is returned. Always confirm with the user before calling this tool.",
    parameters: Type.Object({
      prdId: Type.String({
        description: "The plan ID (prdId) of the failed build to continue and repair from compiled artifacts",
      }),
      setName: Type.Optional(Type.String({
        description: "Override the set name. When omitted, the set name is resolved from the recovery sidecar when available, otherwise derived from the prdId.",
      })),
      profile: Type.Optional(Type.String({
        description: "Run this continue-and-repair build on the named profile instead of the active profile",
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const body: ContinueRepairRequest = { prdId: params.prdId };
      if (params.setName !== undefined) body.setName = params.setName;
      if (params.profile !== undefined) body.profile = params.profile;
      const { data } = await requireDaemon(
        ctx.cwd,
        "POST",
        API_ROUTES.continueRepair,
        body,
      );
      if (_latestCtx) void refreshStatus(_latestCtx);
      return jsonResult(data);
    },
  });




  // ------------------------------------------------------------------
  // Tool: eforge_session_plan
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_session_plan",
    label: "eforge session-plan",
    description:
      'Manage session plans in eforge. Actions: "list-active" returns all active (planning/ready) session plans; "show" returns a single session plan\'s data and readiness detail; "create" creates a new session plan file; "set-section" writes a dimension section to the session file; "skip-dimension" records a skipped dimension with a reason; "set-status" updates the session plan status (e.g. to "ready" or "abandoned"); "select-dimensions" sets planning type and depth and populates the required/optional dimension lists from the selected planning template; "readiness" checks whether all required dimensions are covered; "migrate-legacy" converts a legacy boolean-dimensions session file to the current shape. Status source: canonical eforge-plan SQLite session-plan status records; projections, monitor events, event-tail output, and status fields are derived evidence or diagnostics. Pass open: true on "create" or "show" to best-effort open the session plan file in the default application.',
    parameters: Type.Object({
      action: StringEnum(
        ["list-active", "show", "create", "set-section", "skip-dimension", "set-status", "select-dimensions", "readiness", "migrate-legacy"] as const,
        { description: "Operation to perform on session plans" },
      ),
      session: Type.Optional(
        Type.String({
          description: 'Session ID (required for all actions except "list-active")',
        }),
      ),
      topic: Type.Optional(
        Type.String({
          description: 'Session topic (required for "create")',
        }),
      ),
      dimension: Type.Optional(
        Type.String({
          description: 'Dimension name in kebab-case (required for "set-section" and "skip-dimension")',
        }),
      ),
      content: Type.Optional(
        Type.String({
          description: 'Dimension content (required for "set-section")',
        }),
      ),
      reason: Type.Optional(
        Type.String({
          description: 'Reason for skipping (required for "skip-dimension")',
        }),
      ),
      status: Type.Optional(
        StringEnum(["planning", "ready", "abandoned", "submitted"] as const, {
          description: 'New status (required for "set-status")',
        }),
      ),
      planning_type: Type.Optional(
        StringEnum(["bugfix", "feature", "refactor", "architecture", "docs", "maintenance", "unknown"] as const, {
          description: 'Planning work type (optional for "create" and "select-dimensions")',
        }),
      ),
      planning_depth: Type.Optional(
        StringEnum(["quick", "focused", "deep"] as const, {
          description: 'Planning depth (optional for "create" and "select-dimensions")',
        }),
      ),
      open: Type.Optional(
        Type.Boolean({
          description: 'When true, best-effort opens the resulting session plan file in the user\'s default application after a session is created or shown.',
        }),
      ),
      agent_profile: Type.Optional(
        Type.String({
          description: 'Optional agent runtime profile name supplied by the producer that creates the session plan. Not validated at create time; used when the session plan is enqueued.',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { action, session, topic, dimension, content, reason, status, planning_type, planning_depth, open, agent_profile } = params;

      if (action === "list-active") {
        const { data } = await requireDaemon(ctx.cwd, "GET", API_ROUTES.sessionPlanList);
        return jsonResult(data);
      }

      if (action === "show") {
        if (!session) throw new Error('"session" is required when action is "show"');
        const { data } = await requireDaemon(
          ctx.cwd,
          "GET",
          `${API_ROUTES.sessionPlanShow}?session=${encodeURIComponent(session)}`,
        );
        if (open === true && typeof (data as Record<string, unknown>).path === 'string') {
          const { openSessionPlanFile } = await import('./open-session-plan.js');
          const openStatus = openSessionPlanFile({ path: (data as Record<string, unknown>).path as string, cwd: ctx.cwd });
          return jsonResult({ ...(data as Record<string, unknown>), open: openStatus });
        }
        return jsonResult(data);
      }

      if (action === "create") {
        if (!session) throw new Error('"session" is required when action is "create"');
        if (!topic) throw new Error('"topic" is required when action is "create"');
        const body: Record<string, unknown> = { session, topic };
        if (planning_type !== undefined) body.planning_type = planning_type;
        if (planning_depth !== undefined) body.planning_depth = planning_depth;
        if (agent_profile !== undefined) body.agent_profile = agent_profile;
        const { data } = await requireDaemon(ctx.cwd, "POST", API_ROUTES.sessionPlanCreate, body);
        if (open === true && typeof (data as Record<string, unknown>).path === 'string') {
          const { openSessionPlanFile } = await import('./open-session-plan.js');
          const openStatus = openSessionPlanFile({ path: (data as Record<string, unknown>).path as string, cwd: ctx.cwd });
          return jsonResult({ ...(data as Record<string, unknown>), open: openStatus });
        }
        return jsonResult(data);
      }

      if (action === "set-section") {
        if (!session) throw new Error('"session" is required when action is "set-section"');
        if (!dimension) throw new Error('"dimension" is required when action is "set-section"');
        if (content === undefined) throw new Error('"content" is required when action is "set-section"');
        const { data } = await requireDaemon(ctx.cwd, "POST", API_ROUTES.sessionPlanSetSection, { session, dimension, content });
        return jsonResult(data);
      }

      if (action === "skip-dimension") {
        if (!session) throw new Error('"session" is required when action is "skip-dimension"');
        if (!dimension) throw new Error('"dimension" is required when action is "skip-dimension"');
        if (!reason) throw new Error('"reason" is required when action is "skip-dimension"');
        const { data } = await requireDaemon(ctx.cwd, "POST", API_ROUTES.sessionPlanSkipDimension, { session, dimension, reason });
        return jsonResult(data);
      }

      if (action === "set-status") {
        if (!session) throw new Error('"session" is required when action is "set-status"');
        if (!status) throw new Error('"status" is required when action is "set-status"');
        const { data } = await requireDaemon(ctx.cwd, "POST", API_ROUTES.sessionPlanSetStatus, { session, status });
        return jsonResult(data);
      }

      if (action === "select-dimensions") {
        if (!session) throw new Error('"session" is required when action is "select-dimensions"');
        const body: Record<string, unknown> = { session };
        if (planning_type !== undefined) body.planning_type = planning_type;
        if (planning_depth !== undefined) body.planning_depth = planning_depth;
        const { data } = await requireDaemon(ctx.cwd, "POST", API_ROUTES.sessionPlanSelectDimensions, body);
        return jsonResult(data);
      }

      if (action === "readiness") {
        if (!session) throw new Error('"session" is required when action is "readiness"');
        const { data } = await requireDaemon(
          ctx.cwd,
          "GET",
          `${API_ROUTES.sessionPlanReadiness}?session=${encodeURIComponent(session)}`,
        );
        return jsonResult(data);
      }

      if (action === "migrate-legacy") {
        if (!session) throw new Error('"session" is required when action is "migrate-legacy"');
        const { data } = await requireDaemon(ctx.cwd, "POST", API_ROUTES.sessionPlanMigrateLegacy, { session });
        return jsonResult(data);
      }

      throw new Error(`Unsupported session-plan action: ${String(action)}`);
    },

    renderCall(args, theme) {
      const action = typeof args.action === "string" ? args.action : "?";
      const session = typeof args.session === "string" ? args.session : "";
      const suffix = session ? ` ${session}` : "";
      return new Text(
        theme.fg("toolTitle", theme.bold(`eforge session-plan ${action}${suffix}`)),
        0,
        0,
      );
    },

    renderResult(result, _options, theme) {
      const text = result.content[0];
      if (!text || text.type !== "text") {
        return new Text(theme.fg("muted", "No data"), 0, 0);
      }
      try {
        const data = JSON.parse(text.text) as Record<string, unknown>;
        const lines: string[] = [];

        if (Array.isArray((data as { plans?: unknown }).plans)) {
          const plans = (data as { plans: Array<{ session: string; topic: string; status: string }> }).plans;
          lines.push(theme.fg("accent", `${plans.length} session plan(s)`));
          for (const p of plans) {
            const statusColor = p.status === "ready" ? "success" : "warning";
            lines.push(`  ${theme.fg("text", p.session)}  ${theme.fg(statusColor, p.status)}  ${theme.fg("muted", p.topic)}`);
          }
        } else if ((data as { ready?: unknown }).ready !== undefined && (data as { missingDimensions?: unknown }).missingDimensions !== undefined) {
          const ready = (data as { ready: boolean }).ready;
          const missing = (data as { missingDimensions: string[] }).missingDimensions;
          const acDiagnostics = (data as { acDiagnostics?: Array<{ kind: string; message: string; suggestion: string }> }).acDiagnostics;
          if (ready) {
            lines.push(theme.fg("success", "✓ Ready"));
          } else {
            lines.push(theme.fg("warning", "Not ready"));
            for (const dim of missing) {
              lines.push(`  ${theme.fg("warning", `missing: ${dim}`)}`);
            }
            if (acDiagnostics && acDiagnostics.length > 0) {
              lines.push(`  ${theme.fg("warning", "acceptance criteria issues:")}`);
              for (const d of acDiagnostics) {
                lines.push(`    ${theme.fg("warning", `[${d.kind}]`)} ${theme.fg("text", d.message)}`);
                lines.push(`    ${theme.fg("muted", `Fix: ${d.suggestion}`)}`);
              }
            }
          }
        } else if ((data as { session?: unknown; readiness?: unknown }).session && (data as { readiness?: { ready?: unknown } }).readiness) {
          const nestedReadiness = (data as { session: string; readiness: { ready: boolean; missingDimensions?: string[]; acDiagnostics?: Array<{ kind: string; message: string; suggestion: string }> } }).readiness;
          const nestedSession = (data as { session: string }).session;
          lines.push(theme.fg("success", "✓ ") + theme.fg("text", nestedSession));
          if (nestedReadiness.ready) {
            lines.push(theme.fg("success", "✓ Ready"));
          } else {
            lines.push(theme.fg("warning", "Not ready"));
            for (const dim of nestedReadiness.missingDimensions ?? []) {
              lines.push(`  ${theme.fg("warning", `missing: ${dim}`)}`);
            }
            if (nestedReadiness.acDiagnostics && nestedReadiness.acDiagnostics.length > 0) {
              lines.push(`  ${theme.fg("warning", "acceptance criteria issues:")}`);
              for (const d of nestedReadiness.acDiagnostics) {
                lines.push(`    ${theme.fg("warning", `[${d.kind}]`)} ${theme.fg("text", d.message)}`);
                lines.push(`    ${theme.fg("muted", `Fix: ${d.suggestion}`)}`);
              }
            }
          }
        } else if ((data as { session?: unknown }).session) {
          lines.push(theme.fg("success", "✓ ") + theme.fg("text", String((data as { session: string }).session)));
          if (typeof (data as { statusSourceDisclosure?: unknown }).statusSourceDisclosure === 'string') {
            lines.push(theme.fg("muted", String((data as { statusSourceDisclosure: string }).statusSourceDisclosure)));
          }
        } else {
          lines.push(theme.fg("muted", text.text.slice(0, 200)));
        }
        return new Text(lines.join("\n"), 0, 0);
      } catch {
        return new Text(theme.fg("muted", text.text.slice(0, 200)), 0, 0);
      }
    },
  });


  // ------------------------------------------------------------------
  // Command aliases — map /eforge:* to /skill:eforge-*
  // Pi has no programmatic skill invocation API, so we delegate via
  // sendUserMessage which injects the skill command as user input.
  // ------------------------------------------------------------------

  // Register /eforge:build as a native command with source/profile pickers when UI is available.
  // Falls back to skill alias when headless (no UI).
  pi.registerCommand("eforge:build", {
    description: "Enqueue a build for eforge",
    handler: async (args, ctx) => {
      await handleBuildCommand(pi, ctx as UIContext, args ?? "");
    },
  });

  pi.registerCommand("eforge:status", {
    description: "Check eforge run status and queue state",
    handler: async (args, ctx) => {
      await handleStatusCommand(pi, ctx as UIContext, args ?? "", PI_EFORGE_VERSION);
    },
  });

  pi.registerCommand("eforge:restart", {
    description: "Safely restart the eforge daemon",
    handler: async (args, ctx) => {
      await handleRestartCommand(pi, ctx as UIContext, args ?? "", async () => {
        if (_latestCtx) await refreshStatus(_latestCtx);
      });
    },
  });

  const skillCommands: Array<{
    name: string;
    description: string;
    skill: string;
  }> = [
    {
      name: "eforge:init",
      description: "Initialize eforge in the current project",
      skill: "eforge-init",
    },
    {
      name: "eforge:extend",
      description: "Author eforge TypeScript extensions",
      skill: "eforge-extend",
    },
    {
      name: "eforge:update",
      description: "Check for eforge updates and guide through updating",
      skill: "eforge-update",
    },
    {
      name: "eforge:recover",
      description: "Inspect and apply recovery for a failed PRD",
      skill: "eforge-recover",
    },
  ];

  for (const cmd of skillCommands) {
    pi.registerCommand(cmd.name, {
      description: cmd.description,
      handler: async (args) => {
        const message = `/skill:${cmd.skill}${args ? " " + args : ""}`;
        pi.sendUserMessage(message.trim());
      },
    });
  }

  // ------------------------------------------------------------------
  // Native commands - /eforge:profile, /eforge:profile:new, /eforge:config
  // ------------------------------------------------------------------

  pi.registerCommand("eforge:profile", {
    description: "List, inspect, and switch profiles",
    handler: async (args) => {
      await handleProfileCommand(pi, _latestCtx, args, async () => {
        if (_latestCtx) await refreshStatus(_latestCtx);
      });
    },
  });

  pi.registerCommand("eforge:profile:new", {
    description: "Create a new profile in eforge/profiles/",
    handler: async (args) => {
      await handleProfileNewCommand(pi, _latestCtx, args, async () => {
        if (_latestCtx) await refreshStatus(_latestCtx);
      });
    },
  });

  pi.registerCommand("eforge:config", {
    description: "Initialize or edit eforge configuration",
    handler: async (args) => {
      await handleConfigCommand(pi, _latestCtx, args);
    },
  });


  registerExtensionContributionsCommand(pi, () => _latestCtx);



  // ------------------------------------------------------------------
  // Tool: eforge_stack_sync
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "eforge_stack_sync",
    label: "eforge stack sync",
    description:
      "Synchronize the git-spice stack for the current project. Runs the stack sync operation via the eforge daemon and returns a structured report. Set dryRun: true to preview what commands would run without executing them. When active builds are running, the sync may be deferred — check the outcome field in the response and retry when active builds complete, or use activeBuildPolicy: 'defer' to get a retryable deferred result instead of skipping.",
    parameters: Type.Object({
      dryRun: Type.Optional(
        Type.Boolean({
          description:
            "When true, determine what sync commands would run but do not execute them. Default: false.",
        }),
      ),
      activeBuildPolicy: Type.Optional(
        Type.Union([Type.Literal("skip"), Type.Literal("defer")], {
          description:
            "How to handle concurrent active builds. 'skip' returns a skipped outcome immediately (default). 'defer' returns a deferred outcome that can be retried when active builds complete.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const dryRun = params.dryRun ?? false;
      const body: { dryRun: boolean; trigger: 'manual'; activeBuildPolicy?: 'skip' | 'defer' } = {
        dryRun,
        trigger: 'manual',
      };
      if (params.activeBuildPolicy !== undefined) body.activeBuildPolicy = params.activeBuildPolicy;
      const result = await apiStackSyncIfRunning({ cwd: ctx.cwd, body });
      if (result === null) {
        throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
      }
      return jsonResult(result.data);
    },
  });

  // ------------------------------------------------------------------
  // Command: /eforge:stack:sync
  // ------------------------------------------------------------------
  pi.registerCommand("eforge:stack:sync", {
    description: "Synchronize the git-spice stack (use --dry-run to preview)",
    handler: async (args) => {
      await handleStackSyncCommand(pi, _latestCtx, args ?? "");
    },
  });

  // ------------------------------------------------------------------
  // Commands: /eforge:workflow, /eforge:workflow:init, /eforge:workflow:reconfigure
  // ------------------------------------------------------------------
  pi.registerCommand("eforge:workflow", {
    description: "Set up or reconfigure the eforge workflow (landing action, stacking, PR settings)",
    handler: async (args) => {
      await handleWorkflowCommand(pi, _latestCtx, args ?? "");
    },
  });

  pi.registerCommand("eforge:workflow:init", {
    description: "Run the workflow wizard for initial eforge project configuration",
    handler: async (args) => {
      await handleWorkflowInitCommand(pi, _latestCtx, args ?? "");
    },
  });

  pi.registerCommand("eforge:workflow:reconfigure", {
    description: "Reconfigure eforge workflow settings (shows current config before wizard)",
    handler: async (args) => {
      await handleWorkflowReconfigureCommand(pi, _latestCtx, args ?? "");
    },
  });

}
