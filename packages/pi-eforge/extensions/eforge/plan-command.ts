/**
 * Native Pi command handler for /eforge:plan.
 *
 * The planning workflow itself remains conversational and skill-driven, but
 * first-choice menus that used to ask for numeric text input are handled with
 * Pi TUI selectors here. The selected branch/session/playbook is then passed to
 * the skill as an explicit argument so the agent can continue without asking the
 * user to type a number.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  apiPlaybookListIfRunning,
  apiSessionPlanListIfRunning,
  type PlaybookListEntry,
  type SessionPlanListEntryWire,
} from "@eforge-build/client";
import { DAEMON_NOT_RUNNING_GUIDANCE } from "./daemon-requests.js";
import {
  showInfoPanel,
  showSelectPanel,
  withLoader,
  type UIContext,
} from "./ui-helpers";

interface PlanUIContext extends UIContext {
  ui: UIContext["ui"] & {
    input(message: string, placeholder?: string): Promise<string | undefined>;
  };
}

function sendPlanSkill(pi: ExtensionAPI, args = ""): void {
  pi.sendUserMessage(`/skill:eforge-plan${args ? ` ${args}` : ""}`.trim());
}

function quoteSkillArg(value: string): string {
  return JSON.stringify(value);
}

function formatSessionPlanItem(plan: SessionPlanListEntryWire, index: number) {
  const readiness = plan.ready
    ? "ready to build"
    : plan.missingDimensions.length > 0
      ? `missing: ${plan.missingDimensions.join(", ")}`
      : "in progress";

  return {
    value: plan.session,
    label: `${index + 1}. ${plan.session}  [${plan.status}]`,
    description: `${plan.topic} — ${readiness}`,
  };
}

function formatPlanningPlaybookItem(playbook: PlaybookListEntry, index: number) {
  const profileNote = playbook.profile ? ` • profile: ${playbook.profile}` : "";
  return {
    value: playbook.name,
    label: `${index + 1}. ${playbook.name}  [${playbook.source}]`,
    description: `${playbook.description}${profileNote}`,
  };
}

async function handleNewSession(pi: ExtensionAPI, ctx: PlanUIContext): Promise<void> {
  const topic = (await ctx.ui.input(
    "What change are you planning?",
    "Describe the change to plan",
  ))?.trim();

  if (!topic) return;
  sendPlanSkill(pi, quoteSkillArg(topic));
}

async function handleResumeSession(pi: ExtensionAPI, ctx: UIContext): Promise<void> {
  let plans: SessionPlanListEntryWire[];
  try {
    const result = await withLoader(ctx, "Loading planning sessions...", () =>
      apiSessionPlanListIfRunning({ cwd: ctx.cwd }),
    );
    if (result === null) {
      await showInfoPanel(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
      return;
    }
    plans = result.data.plans;
  } catch (err) {
    await showInfoPanel(
      ctx,
      "eforge - Error",
      `Failed to load planning sessions:\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  if (plans.length === 0) {
    await showInfoPanel(
      ctx,
      "eforge - Planning Sessions",
      "No active or ready planning sessions found.\n\nRun `/eforge:plan` again and choose New session to start from scratch.",
    );
    return;
  }

  const selectedSession = await showSelectPanel(
    ctx,
    "eforge - Resume Planning Session",
    plans.map(formatSessionPlanItem),
  );
  if (!selectedSession) return;

  sendPlanSkill(pi, `--session ${quoteSkillArg(selectedSession)}`);
}

async function handlePlanningPlaybook(pi: ExtensionAPI, ctx: UIContext): Promise<void> {
  let playbooks: PlaybookListEntry[];
  try {
    const result = await withLoader(ctx, "Loading playbooks...", () =>
      apiPlaybookListIfRunning({ cwd: ctx.cwd }),
    );
    if (result === null) {
      await showInfoPanel(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
      return;
    }
    playbooks = result.data.playbooks.filter((playbook) => playbook.mode === "planning");
  } catch (err) {
    await showInfoPanel(
      ctx,
      "eforge - Error",
      `Failed to load planning playbooks:\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  if (playbooks.length === 0) {
    await showInfoPanel(
      ctx,
      "eforge - Planning Playbooks",
      "No planning-mode playbooks found.\n\nUse `/eforge:playbook create` to create one, or run `/eforge:plan` again and choose New session.",
    );
    return;
  }

  const selectedPlaybook = await showSelectPanel(
    ctx,
    "eforge - Start from Planning Playbook",
    playbooks.map(formatPlanningPlaybookItem),
  );
  if (!selectedPlaybook) return;

  sendPlanSkill(pi, `--playbook ${quoteSkillArg(selectedPlaybook)}`);
}

/**
 * Handle /eforge:plan using native selectors for the initial branch choices.
 */
export async function handlePlanCommand(
  pi: ExtensionAPI,
  ctx: UIContext | null,
  args: string,
): Promise<void> {
  if (!ctx || !ctx.hasUI) {
    sendPlanSkill(pi, args);
    return;
  }

  const trimmed = args.trim();

  // Preserve power-user/direct skill flows. Only bare resume/playbook branches
  // need native selection; explicit topics and exact flags go straight through.
  if (trimmed) {
    const lower = trimmed.toLowerCase();
    if (lower === "--resume" || lower === "resume") {
      await handleResumeSession(pi, ctx);
      return;
    }
    if (lower === "--playbook" || lower === "playbook") {
      await handlePlanningPlaybook(pi, ctx);
      return;
    }
    sendPlanSkill(pi, trimmed);
    return;
  }

  const choice = await showSelectPanel(ctx, "eforge - Plan", [
    {
      value: "resume",
      label: "Resume an existing planning session",
      description: "Pick from active/ready session plans",
    },
    {
      value: "new",
      label: "New session",
      description: "Start from scratch with a new topic",
    },
    {
      value: "playbook",
      label: "Start from a planning-mode playbook",
      description: "Load a planning playbook, investigate, and seed a session plan",
    },
  ]);

  switch (choice) {
    case "resume":
      await handleResumeSession(pi, ctx);
      return;
    case "new":
      await handleNewSession(pi, ctx as PlanUIContext);
      return;
    case "playbook":
      await handlePlanningPlaybook(pi, ctx);
      return;
    default:
      return;
  }
}
