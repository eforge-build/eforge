/**
 * Native Pi command handler for /eforge:build.
 *
 * Provides a source-first TUI flow before delegating to the build skill for
 * source completeness checks, confirmation, config validation, and enqueueing.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  apiListProfilesIfRunning,
  apiSessionPlanListIfRunning,
  type AgentRuntimeProfileInfo,
  type SessionPlanListEntryWire,
} from "@eforge-build/client";
import { DAEMON_NOT_RUNNING_GUIDANCE } from "./daemon-requests.js";
import {
  showInfoOverlay,
  showSearchableSelectOverlay,
  showSelectOverlay,
  withLoader,
  type UIContext,
} from "./ui-helpers";

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

async function selectProfileArgs(ctx: UIContext, args: string): Promise<string | null> {
  if (hasProfileOverride(args)) return args;

  const profileListResult = await withLoader(ctx, "Loading profiles...", () =>
    apiListProfilesIfRunning({ cwd: ctx.cwd, query: { scope: "all" } }),
  );

  if (profileListResult === null) {
    await showInfoOverlay(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
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
    ...profileListResult.data.profiles.map(formatProfileItem),
  ];

  const selected = await showSearchableSelectOverlay(ctx, "eforge build - select profile", items);
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
    await showInfoOverlay(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
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

  const sourceChoice = await showSelectOverlay(ctx, "eforge - Build Source", sourceItems);
  if (!sourceChoice) return null;

  if (sourceChoice === "__infer__") return "--infer";

  if (sourceChoice === "__manual__") {
    return selectManualSource(ctx);
  }

  const selectedPlanPath = await showSelectOverlay(
    ctx,
    "eforge - Ready Session Plans",
    readyPlans.map(formatReadyPlanItem),
  );
  return selectedPlanPath ? quoteSkillArg(selectedPlanPath) : null;
}

/** Handle /eforge:build with source and profile selectors when Pi UI exists. */
export async function handleBuildCommand(
  pi: ExtensionAPI,
  ctx: UIContext | null,
  args: string,
): Promise<void> {
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

  sendBuildSkill(pi, argsWithProfile);
}
