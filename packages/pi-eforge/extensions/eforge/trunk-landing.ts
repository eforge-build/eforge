import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Canonical landing action values accepted by the engine and daemon.
 *
 *   pr    → open a pull request
 *   merge → merge to base branch
 *   leave → leave branch as-is
 *
 * The landing.action config key and landingAction request field both accept
 * these canonical values. Legacy wire values (issue-pr, merge-to-base-branch,
 * leave-branch) are rejected with a migration error by the daemon.
 */
export type BuildOnSuccess = "pr" | "merge" | "leave";

export interface BuildLandingConfig {
  allowLocalMergeToTrunk?: boolean;
  trunkBranch?: string;
}

export interface TrunkLandingPromptInput {
  currentBranch: string | null | undefined;
  trunkBranch: string;
  build: BuildLandingConfig | undefined;
  configuredLandingAction?: BuildOnSuccess;
  landingActionOverride?: BuildOnSuccess;
}

export function getEffectiveLandingAction(
  configuredAction: BuildOnSuccess | undefined,
  override?: BuildOnSuccess,
): BuildOnSuccess {
  return override ?? configuredAction ?? "merge";
}

export function shouldPromptForTrunkLanding(input: TrunkLandingPromptInput): boolean {
  const effectiveAction = getEffectiveLandingAction(input.configuredLandingAction, input.landingActionOverride);
  return (
    effectiveAction === "merge" &&
    input.build?.allowLocalMergeToTrunk !== true &&
    Boolean(input.currentBranch) &&
    input.currentBranch === input.trunkBranch
  );
}

/**
 * For explicit playbook landing-gate mode: determine if trunk remediation is
 * required for a given explicit landing action choice.
 *
 * Returns true only when the choice is merge AND the user is on the trunk
 * branch without having opted in via allowLocalMergeToTrunk.
 * Returns false for pr and leave choices regardless of branch.
 */
export function playbookChoiceNeedsTrunkRemediation(
  choice: BuildOnSuccess,
  input: Omit<TrunkLandingPromptInput, "landingActionOverride">,
): boolean {
  if (choice !== "merge") return false;
  return shouldPromptForTrunkLanding({ ...input, landingActionOverride: "merge" });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function enableLocalMergeToTrunkInConfigYaml(rawYaml: string): string {
  const parsed = rawYaml.trim().length > 0 ? parseYaml(rawYaml) : {};
  const data: Record<string, unknown> = parsed === null ? {} : (() => {
    if (!isPlainRecord(parsed)) {
      throw new Error("eforge/config.yaml must contain a YAML object to update build.allowLocalMergeToTrunk.");
    }
    return parsed;
  })();

  const existingBuild = data.build;
  if (existingBuild !== undefined && existingBuild !== null && !isPlainRecord(existingBuild)) {
    throw new Error("eforge/config.yaml build field must be a YAML object to update build.allowLocalMergeToTrunk.");
  }

  return stringifyYaml({
    ...data,
    build: {
      ...(isPlainRecord(existingBuild) ? existingBuild : {}),
      allowLocalMergeToTrunk: true,
    },
  });
}
