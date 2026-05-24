/**
 * Shared Pi landing-gate helper for eforge_build and /eforge:playbook run.
 *
 * Canonical landing action values: pr, merge, leave.
 * These are sent directly as landingAction in request bodies.
 *
 * Build mode (tool path with explicit landingActionOverride): prompts the user for
 * trunk remediation only when `merge` would land on trunk without opt-in.
 *
 * Build mode (command path, no explicit override): always shows the full
 * landing selector with "Use project default" so the user can choose explicitly.
 *
 * Playbook mode: always shows the full landing selector with "Use project
 * default" before enqueueing. If the user selects `merge` on an unsafe trunk,
 * falls through to the same trunk remediation choices.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { API_ROUTES, apiShowConfigVerboseIfRunning, type ConfigShowVerboseResponse } from "@eforge-build/client";
import { resolveTrunkBranch } from "@eforge-build/engine/branch-policy";
import { DAEMON_NOT_RUNNING_GUIDANCE, piDaemonRequest } from "./daemon-requests.js";
import { showSelectOverlay, type UIContext } from "./ui-helpers.js";
import {
  enableLocalMergeToTrunkInConfigYaml,
  shouldPromptForTrunkLanding,
  getEffectiveLandingAction,
  type BuildOnSuccess,
  type BuildLandingConfig,
} from "./trunk-landing.js";
import { buildLandingMenuModel } from "./landing-policy.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function loadLandingConfig(cwd: string): Promise<ConfigShowVerboseResponse> {
  const result = await apiShowConfigVerboseIfRunning({ cwd });
  if (result === null) {
    throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
  }
  return result.data;
}

async function getGitBranch(
  pi: ExtensionAPI,
  cwd: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const result = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      signal,
      timeout: 5000,
    });
    if (result.code !== 0) return null;
    const branch = result.stdout.trim();
    return branch && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface LandingGateResult {
  landingAction?: BuildOnSuccess;
  cancelled?: boolean;
  configUpdated?: boolean;
}

export interface BuildLandingGateOptions {
  mode?: "selector" | "guard";
}

// ---------------------------------------------------------------------------
// Internal: handle config update side effect
// ---------------------------------------------------------------------------

async function applyConfigUpdate(
  cwd: string,
  projectConfigPath: string,
): Promise<LandingGateResult> {
  await withFileMutationQueue(projectConfigPath, async () => {
    const currentYaml = readFileSync(projectConfigPath, "utf-8");
    const updatedYaml = enableLocalMergeToTrunkInConfigYaml(currentYaml);
    writeFileSync(projectConfigPath, updatedYaml, "utf-8");
  });

  // Best-effort extension reload so the updated config is visible to the daemon
  try {
    await piDaemonRequest(cwd, "POST", API_ROUTES.extensionReload);
  } catch {
    // Non-fatal: the daemon loads config fresh at enqueue time
  }

  return { configUpdated: true };
}

// ---------------------------------------------------------------------------
// Shared full landing selector
// ---------------------------------------------------------------------------

/**
 * Full landing selector — loads verbose config, builds the policy model,
 * renders the choice menu, and returns the user's selection.
 *
 * Returns `{}` for "Use project default" (no landingAction → daemon inherits
 * project-level config). Returns `{ landingAction }` for explicit selections.
 * Returns `{ cancelled: true }` when the user cancels.
 *
 * Exported for direct use where neither the build nor playbook gate-specific
 * wrapper logic is needed.
 */
export async function promptForLandingSelection(
  pi: ExtensionAPI,
  ctx: UIContext,
  signal?: AbortSignal,
): Promise<LandingGateResult> {
  const verboseConfig = await loadLandingConfig(ctx.cwd);
  const resolved = asRecord(verboseConfig.resolved) ?? {};
  const build = asRecord(resolved.build) as BuildLandingConfig | undefined;
  const landing = asRecord(resolved.landing) as { action?: BuildOnSuccess } | undefined;
  const configuredLandingAction = landing?.action;
  const trunkBranch = await resolveTrunkBranch(
    { build: build ?? {} } as Parameters<typeof resolveTrunkBranch>[0],
    ctx.cwd,
  );
  const currentBranch = await getGitBranch(pi, ctx.cwd, signal);
  const effectiveLanding = getEffectiveLandingAction(configuredLandingAction);
  const projectConfigPath = verboseConfig.sources?.project?.path ?? null;

  const model = buildLandingMenuModel({
    effectiveLanding,
    currentBranch,
    trunkBranch,
    allowLocalMergeToTrunk: build?.allowLocalMergeToTrunk ?? false,
    offerProjectDefault: true,
    projectConfigPath,
  });

  const title = model.warning
    ? `eforge: ${model.warning}`
    : "eforge - Choose Landing Action (pr / merge / leave)";

  // On protected trunk, show remediation choices (includes update-config).
  // On normal branches, show the full normal choices.
  const choices = model.warning ? model.remediationChoices : model.normalChoices;
  const choice = await showSelectOverlay(ctx, title, choices);

  if (!choice || choice === "cancel") {
    return { cancelled: true };
  }

  if (choice === "project-default") {
    return {};
  }

  if (choice === "update-config") {
    if (!projectConfigPath) {
      throw new Error(
        "Cannot update config: eforge/config.yaml was not found for this project.",
      );
    }
    return { ...(await applyConfigUpdate(ctx.cwd, projectConfigPath)), landingAction: "merge" };
  }

  return { landingAction: choice as BuildOnSuccess };
}

// ---------------------------------------------------------------------------
// Build mode
// ---------------------------------------------------------------------------

/**
 * Build landing gate.
 *
 * **Tool/override path** (landingActionOverride provided):
 *   Checks whether trunk remediation is needed. If the override is already safe
 *   (not merge, or not on trunk, or local-trunk opt-in is active), returns `{}`
 *   immediately. Otherwise shows the remediation selector.
 *   Throws when hasUI is false and remediation is required (non-interactive).
 *
 * **Command path** (landingActionOverride === undefined):
 *   Shows the full landing selector via `promptForLandingSelection` so the
 *   user can choose an explicit action or accept the project default.
 */
export async function promptForBuildLandingGate(
  pi: ExtensionAPI,
  ctx: UIContext,
  landingActionOverride: BuildOnSuccess | undefined,
  signal?: AbortSignal,
  options: BuildLandingGateOptions = {},
): Promise<LandingGateResult> {
  if (landingActionOverride === undefined && options.mode === "selector") {
    // Native /eforge:build command path: full landing selector with "Use project default".
    return promptForLandingSelection(pi, ctx, signal);
  }

  // Direct tool guard path: only prompt when the explicit override or effective
  // project default would perform an unsafe merge from trunk.
  const verboseConfig = await loadLandingConfig(ctx.cwd);
  const resolved = asRecord(verboseConfig.resolved) ?? {};
  const build = asRecord(resolved.build) as BuildLandingConfig | undefined;
  const landing = asRecord(resolved.landing) as { action?: BuildOnSuccess } | undefined;
  const configuredLandingAction = landing?.action;
  const trunkBranch = await resolveTrunkBranch(
    { build: build ?? {} } as Parameters<typeof resolveTrunkBranch>[0],
    ctx.cwd,
  );
  const currentBranch = await getGitBranch(pi, ctx.cwd, signal);

  if (!shouldPromptForTrunkLanding({ currentBranch, trunkBranch, build, configuredLandingAction, landingActionOverride })) {
    return {};
  }

  if (!ctx.hasUI) {
    throw new Error(
      `Building from trunk '${trunkBranch}' with merge landing requires a choice: ` +
        `pass landingAction: "pr" for this build, or set build.allowLocalMergeToTrunk: true in eforge/config.yaml.`,
    );
  }

  const projectConfigPath = verboseConfig.sources?.project?.path ?? null;
  const effectiveLanding = getEffectiveLandingAction(configuredLandingAction, landingActionOverride);
  const model = buildLandingMenuModel({
    effectiveLanding,
    currentBranch,
    trunkBranch,
    allowLocalMergeToTrunk: build?.allowLocalMergeToTrunk ?? false,
    offerProjectDefault: false,
    projectConfigPath,
  });

  const choice = await showSelectOverlay(
    ctx,
    `eforge: on trunk (${trunkBranch}) with merge landing`,
    model.remediationChoices,
  );

  if (!choice || choice === "cancel") {
    return { cancelled: true };
  }

  if (choice === "update-config") {
    if (!projectConfigPath) {
      throw new Error(
        "Cannot update config: eforge/config.yaml was not found for this project.",
      );
    }
    return { ...(await applyConfigUpdate(ctx.cwd, projectConfigPath)), landingAction: "merge" };
  }

  return { landingAction: choice as BuildOnSuccess };
}

// ---------------------------------------------------------------------------
// Playbook mode
// ---------------------------------------------------------------------------

/**
 * Playbook landing gate.
 *
 * Always shows the full landing selector with "Use project default".
 * Delegates to `promptForLandingSelection` for consistent policy rendering.
 *
 * Returns `{}` for "Use project default" (daemon inherits project config).
 * Returns `{ landingAction }` for explicit selections.
 * Returns `{ cancelled: true }` when the user cancels.
 */
export async function promptForPlaybookLandingGate(
  pi: ExtensionAPI,
  ctx: UIContext,
  signal?: AbortSignal,
): Promise<LandingGateResult> {
  return promptForLandingSelection(pi, ctx, signal);
}
