/**
 * Native Pi command handler for /eforge:build.
 *
 * Provides a source-first TUI flow before delegating to the build skill for
 * source completeness checks, confirmation, config validation, and enqueueing.
 *
 * Flow:
 *   1. Headless/no-UI: delegate directly to /skill:eforge-build with original args.
 *   2. Explicit landing in args: bypass the landing selector and delegate.
 *   3. Source selection (when no args supplied).
 *   4. Profile selection (when no --profile already in args).
 *   5. Landing selection via promptForBuildLandingGate (full selector with
 *      "Use project default").
 *   6. Delegate to /skill:eforge-build with the resolved args.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  apiListProfilesIfRunning,
  apiSessionPlanListIfRunning,
  apiGetQueueIfRunning,
  type AgentRuntimeProfileInfo,
  type SessionPlanListEntryWire,
  type QueueItem,
} from "@eforge-build/client";
import { DAEMON_NOT_RUNNING_GUIDANCE } from "./daemon-requests.js";
import {
  showInfoPanel,
  showSearchableSelectPanel,
  showSelectPanel,
  withLoader,
  type UIContext,
} from "./ui-helpers";
import { promptForBuildLandingGate } from "./landing-gate.js";

interface BuildUIContext extends UIContext {
  ui: UIContext["ui"] & {
    input(message: string, placeholder?: string): Promise<string | undefined>;
  };
}

function sendBuildSkill(pi: ExtensionAPI, args = ""): void {
  pi.sendUserMessage(`/skill:eforge-build${args ? ` ${args}` : ""}`.trim());
}

function quoteSkillArg(value: string): string {
  return JSON.stringify(value);
}

function formatReadyPlanItem(plan: SessionPlanListEntryWire, index: number) {
  return {
    value: plan.path,
    label: `${index + 1}. ${plan.session}`,
    description: `${plan.topic} — ${plan.status}`,
  };
}

function formatProfileItem(profile: AgentRuntimeProfileInfo) {
  return {
    value: profile.name,
    label: profile.name,
    description: `${profile.shadowedBy ? `${profile.scope} (shadowed)` : profile.scope}${profile.harness ? ` - ${profile.harness}` : ""}`,
  };
}

function hasProfileOverride(args: string): boolean {
  return /(?:^|\s)--profile(?:\s|=|$)/.test(args);
}

/**
 * Returns true when args already contain an explicit landing override so the
 * landing selector should be bypassed. Detects: landingAction, --landing-action,
 * --landing-auto-merge, --no-landing-auto-merge, landingAutoMerge.
 */
function hasLandingOverride(args: string): boolean {
  return /(?:^|\s)(--landing-action|landingAction|--landing-auto-merge|--no-landing-auto-merge|landingAutoMerge)(?:\s|=|:|$)/.test(args);
}


/**
 * Returns true when args already contain an explicit --after override so the
 * active-build wait selector should be bypassed.
 */
function hasAfterOverride(args: string): boolean {
  return /(?:^|\s)--after(?:\s|=|$)/.test(args);
}

/** Fetch active (pending/running/queued/waiting) queue items for dependency selection. */
async function fetchActiveBuildsForDependency(cwd: string): Promise<QueueItem[]> {
  try {
    const result = await apiGetQueueIfRunning({ cwd });
    if (result === null) return [];
    return result.data.filter(
      (item) =>
        item.status === "running" ||
        item.status === "pending" ||
        item.status === "queued" ||
        item.status === "waiting",
    );
  } catch {
    return [];
  }
}

/**
 * Show active-build wait selector. Returns updated args string with `--after <id>` appended
 * when the user picks an upstream, original args when "Run now" is chosen, or null if cancelled.
 */
async function selectActiveBuildsForDependency(ctx: UIContext, args: string): Promise<string | null> {
  if (hasAfterOverride(args)) return args;

  const activeItems = await withLoader(ctx, "Checking queue...", () =>
    fetchActiveBuildsForDependency(ctx.cwd),
  );
  if (activeItems.length === 0) return args;

  const waitOptions = [
    {
      value: "__now__",
      label: "Run now",
      description: "Enqueue immediately, no dependency",
    },
    ...activeItems.map((item) => ({
      value: item.id,
      label: `Wait for: ${item.title}`,
      description: `[${item.status}] Runs after this build finishes`,
    })),
  ];

  const choice = await showSelectPanel(ctx, "eforge - Active Builds Detected", waitOptions);
  if (!choice) return null;
  if (choice === "__now__") return args;

  return `${args} --after ${quoteSkillArg(choice)}`;
}


async function selectProfileArgs(ctx: UIContext, args: string): Promise<string | null> {
  if (hasProfileOverride(args)) return args;

  const profileListResult = await withLoader(ctx, "Loading profiles...", () =>
    apiListProfilesIfRunning({ cwd: ctx.cwd, query: { scope: "all" } }),
  );

  if (profileListResult === null) {
    await showInfoPanel(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
    return null;
  }

  const items = [
    {
      value: "__no_override__",
      label: "Use active profile (no override)",
      description: profileListResult.data.active
        ? `Run on active profile: ${profileListResult.data.active}`
        : "Run on the daemon's currently bound profile",
    },
    ...profileListResult.data.profiles.filter((profile) => !profile.shadowedBy).map(formatProfileItem),
  ];

  const selected = await showSearchableSelectPanel(ctx, "eforge build - select profile", items);
  if (!selected) return null;
  if (selected === "__no_override__") return args;
  return `--profile ${quoteSkillArg(selected)}${args ? ` ${args}` : ""}`;
}

async function selectManualSource(ctx: BuildUIContext): Promise<string | null> {
  const source = (await ctx.ui.input(
    "What would you like to build?",
    "Describe the work, or enter a PRD/session-plan path",
  ))?.trim();
  return source || null;
}

async function selectBuildSource(ctx: BuildUIContext): Promise<string | null> {
  let readyPlans: SessionPlanListEntryWire[] = [];

  const result = await withLoader(ctx, "Loading session plans...", () =>
    apiSessionPlanListIfRunning({ cwd: ctx.cwd }),
  );

  if (result === null) {
    await showInfoPanel(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
    return null;
  }

  readyPlans = result.data.plans.filter((plan) => plan.ready || plan.status === "ready");

  const sourceItems = [
    {
      value: "__infer__",
      label: "Infer from context",
      description: "Use recent conversation; ask only if needed",
    },
    ...(readyPlans.length > 0
      ? [
          {
            value: "__ready_plan__",
            label: "Select ready plan",
            description: `${readyPlans.length} ready session plan${readyPlans.length === 1 ? "" : "s"} available`,
          },
        ]
      : []),
    {
      value: "__manual__",
      label: "Enter source manually",
      description: "Inline description, PRD path, or session-plan path",
    },
  ];

  const sourceChoice = await showSelectPanel(ctx, "eforge - Build Source", sourceItems);
  if (!sourceChoice) return null;

  if (sourceChoice === "__infer__") return "--infer";

  if (sourceChoice === "__manual__") {
    return selectManualSource(ctx);
  }

  const selectedPlanPath = await showSelectPanel(
    ctx,
    "eforge - Ready Session Plans",
    readyPlans.map(formatReadyPlanItem),
  );
  return selectedPlanPath ? quoteSkillArg(selectedPlanPath) : null;
}

/** Handle /eforge:build with source, profile, and landing selectors when Pi UI exists. */
export async function handleBuildCommand(
  pi: ExtensionAPI,
  ctx: UIContext | null,
  args: string,
): Promise<void> {
  // Headless path: delegate directly without any prompts
  if (!ctx || !ctx.hasUI) {
    sendBuildSkill(pi, args);
    return;
  }

  let sourceArgs = args.trim();
  if (!sourceArgs) {
    const selectedSource = await selectBuildSource(ctx as BuildUIContext);
    if (!selectedSource) return;
    sourceArgs = selectedSource;
  }

  const argsWithProfile = await selectProfileArgs(ctx, sourceArgs);
  if (argsWithProfile === null) return;

  // If explicit landing override already in args, bypass the landing selector
  if (hasLandingOverride(argsWithProfile)) {
    const afterArgsWithLanding = await selectActiveBuildsForDependency(ctx, argsWithProfile);
    if (afterArgsWithLanding === null) return;
    sendBuildSkill(pi, afterArgsWithLanding);
    return;
  }

  // Landing selection: show the full selector with "Use project default"
  const landingResult = await promptForBuildLandingGate(pi, ctx, undefined, undefined, { mode: "selector" });
  if (landingResult.cancelled) return;

  let finalArgs = argsWithProfile;
  if (landingResult.landingAction) {
    finalArgs = `${finalArgs} --landing-action ${landingResult.landingAction}`;
  }
  if (landingResult.landingAutoMerge === true) {
    finalArgs = `${finalArgs} --landing-auto-merge`;
  } else if (landingResult.landingAutoMerge === false) {
    finalArgs = `${finalArgs} --no-landing-auto-merge`;
  }

  const finalArgsWithDep = await selectActiveBuildsForDependency(ctx, finalArgs);
  if (finalArgsWithDep === null) return;
  sendBuildSkill(pi, finalArgsWithDep);
}
