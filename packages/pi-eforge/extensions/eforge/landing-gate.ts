/**
 * Shared Pi landing-gate helper for eforge_build and /eforge:playbook run.
 *
 * Build mode: prompts the user for trunk remediation only when
 * merge-to-base-branch would land on trunk without opt-in.
 *
 * Playbook mode: always prompts the user to choose issue-pr,
 * merge-to-base-branch, or leave-branch before enqueueing. If the user
 * selects merge-to-base-branch on an unsafe trunk, falls through to the
 * same trunk remediation choices used by build mode.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { API_ROUTES } from "@eforge-build/client";
import { resolveTrunkBranch } from "@eforge-build/engine/branch-policy";
import { requireDaemon, piDaemonRequest } from "./daemon-requests.js";
import { showSelectOverlay, type UIContext } from "./ui-helpers.js";
import {
  enableLocalMergeToTrunkInConfigYaml,
  shouldPromptForTrunkLanding,
  playbookChoiceNeedsTrunkRemediation,
  type BuildOnSuccess,
  type BuildLandingConfig,
} from "./trunk-landing.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface LandingConfigResponse {
  resolved?: {
    build?: BuildLandingConfig;
  };
  sources?: {
    project?: { path: string | null; found: boolean };
  };
}

export interface LandingGateResult {
  onSuccess?: BuildOnSuccess;
  cancelled?: boolean;
  configUpdated?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function loadLandingConfig(cwd: string): Promise<LandingConfigResponse> {
  const { data } = await requireDaemon<LandingConfigResponse>(
    cwd,
    "GET",
    `${API_ROUTES.configShow}?verbose=true`,
  );
  return data;
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

/**
 * Show the trunk remediation selector used by both build mode and playbook mode
 * when merge-to-base-branch would land on trunk without allowLocalMergeToTrunk.
 */
async function promptTrunkRemediation(
  ctx: UIContext,
  trunkBranch: string,
  projectConfigPath: string | null | undefined,
): Promise<LandingGateResult> {
  const items = [
    {
      value: "issue-pr",
      label: "Open a PR instead (issue-pr)",
      description: "Use issue-pr landing action for this run",
    },
    ...(projectConfigPath
      ? [
          {
            value: "update-config",
            label: "Update eforge/config.yaml to allow local trunk merges",
            description:
              "Sets build.allowLocalMergeToTrunk: true (applies to all future builds)",
          },
        ]
      : []),
    {
      value: "cancel",
      label: "Cancel",
      description: "Do not proceed",
    },
  ];

  const choice = await showSelectOverlay(
    ctx,
    `eforge: on trunk (${trunkBranch}) with merge-to-base-branch`,
    items,
  );

  if (!choice || choice === "cancel") {
    return { cancelled: true };
  }

  if (choice === "issue-pr") {
    return { onSuccess: "issue-pr" };
  }

  // update-config
  if (!projectConfigPath) {
    throw new Error(
      "Cannot update config: eforge/config.yaml was not found for this project.",
    );
  }

  await withFileMutationQueue(projectConfigPath, async () => {
    const currentYaml = readFileSync(projectConfigPath!, "utf-8");
    const updatedYaml = enableLocalMergeToTrunkInConfigYaml(currentYaml);
    writeFileSync(projectConfigPath!, updatedYaml, "utf-8");
  });

  // Best-effort extension reload so the updated config is visible to the daemon
  try {
    await piDaemonRequest(ctx.cwd, "POST", API_ROUTES.extensionReload);
  } catch {
    // Non-fatal: the daemon loads config fresh at enqueue time
  }

  return { configUpdated: true };
}

// ---------------------------------------------------------------------------
// Build mode
// ---------------------------------------------------------------------------

/**
 * Build landing gate.
 *
 * Checks if the current branch is trunk and merge-to-base-branch would land
 * without opt-in. If so, shows the trunk remediation selector. Otherwise
 * returns {} so the build can proceed unchanged.
 *
 * Throws when hasUI is false and remediation is required (non-interactive).
 */
export async function promptForBuildLandingGate(
  pi: ExtensionAPI,
  ctx: UIContext,
  onSuccessOverride: BuildOnSuccess | undefined,
  signal?: AbortSignal,
): Promise<LandingGateResult> {
  const verboseConfig = await loadLandingConfig(ctx.cwd);
  const resolved = asRecord(verboseConfig.resolved) ?? {};
  const build = asRecord(resolved.build) as BuildLandingConfig | undefined;
  const trunkBranch = await resolveTrunkBranch(
    { build: build ?? {} } as Parameters<typeof resolveTrunkBranch>[0],
    ctx.cwd,
  );
  const currentBranch = await getGitBranch(pi, ctx.cwd, signal);

  if (!shouldPromptForTrunkLanding({ currentBranch, trunkBranch, build, onSuccessOverride })) {
    return {};
  }

  if (!ctx.hasUI) {
    throw new Error(
      `Building from trunk '${trunkBranch}' with merge-to-base-branch requires a choice: ` +
        `pass onSuccess: "issue-pr" for this build, or set build.allowLocalMergeToTrunk: true in eforge/config.yaml.`,
    );
  }

  const projectConfigPath = verboseConfig.sources?.project?.path;
  return promptTrunkRemediation(ctx, trunkBranch, projectConfigPath);
}

// ---------------------------------------------------------------------------
// Playbook mode
// ---------------------------------------------------------------------------

/**
 * Playbook landing gate.
 *
 * Always prompts the user to choose a landing action (issue-pr,
 * merge-to-base-branch, or leave-branch). If the user selects
 * merge-to-base-branch and the current branch is trunk without opt-in,
 * falls through to the trunk remediation selector.
 *
 * Returns { cancelled: true } if the user cancels at either prompt.
 * Returns { onSuccess, configUpdated? } otherwise.
 */
export async function promptForPlaybookLandingGate(
  pi: ExtensionAPI,
  ctx: UIContext,
  signal?: AbortSignal,
): Promise<LandingGateResult> {
  const landingItems = [
    {
      value: "issue-pr",
      label: "Open a pull request (issue-pr)",
      description: "Create a GitHub PR for review instead of merging directly",
    },
    {
      value: "merge-to-base-branch",
      label: "Merge to base branch (merge-to-base-branch)",
      description: "Merge the worktree branch back when the build succeeds",
    },
    {
      value: "leave-branch",
      label: "Leave branch (leave-branch)",
      description: "Commit to the worktree branch and exit without merging or opening a PR",
    },
    {
      value: "cancel",
      label: "Cancel",
      description: "Do not enqueue this playbook",
    },
  ];

  const choice = await showSelectOverlay(ctx, "eforge - Choose Landing Action", landingItems);
  if (!choice || choice === "cancel") {
    return { cancelled: true };
  }

  const onSuccess = choice as BuildOnSuccess;

  if (onSuccess === "merge-to-base-branch") {
    // Check if trunk remediation is needed before enqueuing
    const verboseConfig = await loadLandingConfig(ctx.cwd);
    const resolved = asRecord(verboseConfig.resolved) ?? {};
    const build = asRecord(resolved.build) as BuildLandingConfig | undefined;
    const trunkBranch = await resolveTrunkBranch(
      { build: build ?? {} } as Parameters<typeof resolveTrunkBranch>[0],
      ctx.cwd,
    );
    const currentBranch = await getGitBranch(pi, ctx.cwd, signal);

    if (playbookChoiceNeedsTrunkRemediation("merge-to-base-branch", { currentBranch, trunkBranch, build })) {
      const projectConfigPath = verboseConfig.sources?.project?.path;
      const remediationResult = await promptTrunkRemediation(ctx, trunkBranch, projectConfigPath);

      if (remediationResult.cancelled) {
        return { cancelled: true };
      }

      if (remediationResult.onSuccess === "issue-pr") {
        return { onSuccess: "issue-pr" };
      }

      // Config updated — user still wants merge-to-base-branch
      return { onSuccess: "merge-to-base-branch", configUpdated: remediationResult.configUpdated };
    }
  }

  return { onSuccess };
}
