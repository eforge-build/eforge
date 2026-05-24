// --- eforge:region plan-04-consumer-surfaces ---
/**
 * Shared landing-action vocabulary mapper for CLI commands.
 *
 * The user-facing shorthands (`pr`, `merge`, `leave`) map to the wire-protocol
 * values used by the engine and daemon (`issue-pr`, `merge-to-base-branch`,
 * `leave-branch`).  Both vocabularies are accepted so users can choose whichever
 * form is more readable for their context.
 */

export type LandingActionShorthand = 'pr' | 'merge' | 'leave';
export type LandingActionFull = 'issue-pr' | 'merge-to-base-branch' | 'leave-branch';

/** All accepted values for `--landing-action` (shorthands only). */
export const LANDING_ACTION_SHORTHANDS: readonly LandingActionShorthand[] = ['pr', 'merge', 'leave'];

/** All accepted wire-protocol values for `--on-success`. */
export const ON_SUCCESS_VALUES: readonly LandingActionFull[] = [
  'merge-to-base-branch',
  'issue-pr',
  'leave-branch',
];

const SHORTHAND_MAP: Record<LandingActionShorthand, LandingActionFull> = {
  pr: 'issue-pr',
  merge: 'merge-to-base-branch',
  leave: 'leave-branch',
};

/**
 * Convert a landing-action shorthand to the full wire-protocol value.
 * Returns `undefined` if `value` is not a recognised shorthand.
 */
export function resolveLandingAction(value: string): LandingActionFull | undefined {
  return SHORTHAND_MAP[value as LandingActionShorthand];
}

/**
 * Validate and resolve CLI landing-action flags for a single command invocation.
 *
 * Accepts the two flag values (`--landing-action` and `--on-success`) and:
 *   1. Maps `landingAction` shorthand to the full wire value.
 *   2. Validates `onSuccess` against the allowed set.
 *   3. Rejects conflicting values (both provided and they disagree).
 *
 * Returns the resolved `LandingActionFull` value, or `undefined` when neither
 * flag was supplied.  Throws a `CLILandingFlagError` on validation/conflict.
 */
export function resolveAndValidateLandingFlags(opts: {
  landingAction?: string;
  onSuccess?: string;
}): LandingActionFull | undefined {
  const { landingAction, onSuccess } = opts;

  let resolvedLanding: LandingActionFull | undefined;
  if (landingAction !== undefined) {
    resolvedLanding = resolveLandingAction(landingAction);
    if (resolvedLanding === undefined) {
      throw new CLILandingFlagError(
        `--landing-action must be one of: ${LANDING_ACTION_SHORTHANDS.join(', ')}`,
      );
    }
  }

  if (onSuccess !== undefined && !ON_SUCCESS_VALUES.includes(onSuccess as LandingActionFull)) {
    throw new CLILandingFlagError(
      `--on-success must be one of: ${ON_SUCCESS_VALUES.join(', ')}`,
    );
  }

  // Conflict check: both provided and they disagree
  if (resolvedLanding !== undefined && onSuccess !== undefined && resolvedLanding !== onSuccess) {
    throw new CLILandingFlagError(
      `--landing-action ${landingAction} (resolves to ${resolvedLanding}) conflicts with --on-success ${onSuccess}`,
    );
  }

  // Prefer --landing-action mapping; fall back to --on-success
  return resolvedLanding ?? (onSuccess as LandingActionFull | undefined);
}

/** Thrown when landing flag validation or conflict detection fails. */
export class CLILandingFlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CLILandingFlagError';
  }
}
// --- eforge:endregion plan-04-consumer-surfaces ---
