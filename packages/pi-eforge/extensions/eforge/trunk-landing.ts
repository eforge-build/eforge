import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Wire-protocol values for the landing action.
 *
 * User-facing shorthands (`pr`, `merge`, `leave`) map to these values:
 *   pr    → issue-pr
 *   merge → merge-to-base-branch
 *   leave → leave-branch
 *
 * These wire values are what the daemon and engine accept via `onSuccess`.
 * The `landing.action` config key also accepts these values.
 */
export type BuildOnSuccess = "merge-to-base-branch" | "issue-pr" | "leave-branch";

export interface BuildLandingConfig {
  onSuccess?: BuildOnSuccess | string;
  allowLocalMergeToTrunk?: boolean;
  trunkBranch?: string;
}

export interface TrunkLandingPromptInput {
  currentBranch: string | null | undefined;
  trunkBranch: string;
  build: BuildLandingConfig | undefined;
  onSuccessOverride?: BuildOnSuccess;
}

export function getEffectiveOnSuccess(
  build: BuildLandingConfig | undefined,
  onSuccessOverride?: BuildOnSuccess,
): BuildOnSuccess {
  if (onSuccessOverride) return onSuccessOverride;
  if (
    build?.onSuccess === "merge-to-base-branch" ||
    build?.onSuccess === "issue-pr" ||
    build?.onSuccess === "leave-branch"
  ) {
    return build.onSuccess;
  }
  return "merge-to-base-branch";
}

export function shouldPromptForTrunkLanding(input: TrunkLandingPromptInput): boolean {
  const effectiveOnSuccess = getEffectiveOnSuccess(input.build, input.onSuccessOverride);
  return (
    effectiveOnSuccess === "merge-to-base-branch" &&
    input.build?.allowLocalMergeToTrunk !== true &&
    Boolean(input.currentBranch) &&
    input.currentBranch === input.trunkBranch
  );
}

/**
 * For explicit playbook landing-gate mode: determine if trunk remediation is
 * required for a given explicit onSuccess choice.
 *
 * Returns true only when the choice is merge-to-base-branch AND the user is
 * on the trunk branch without having opted in via allowLocalMergeToTrunk.
 * Returns false for issue-pr and leave-branch choices regardless of branch.
 */
export function playbookChoiceNeedsTrunkRemediation(
  choice: BuildOnSuccess,
  input: Omit<TrunkLandingPromptInput, "onSuccessOverride">,
): boolean {
  if (choice !== "merge-to-base-branch") return false;
  return shouldPromptForTrunkLanding({ ...input, onSuccessOverride: "merge-to-base-branch" });
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
