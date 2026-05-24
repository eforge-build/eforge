/**
 * Shared landing-action vocabulary for CLI commands.
 *
 * The canonical landing-action values (`pr`, `merge`, `leave`) are used across
 * the engine, daemon request bodies, and CLI flags. The old `--on-success` flag
 * with full-string values (`issue-pr`, `merge-to-base-branch`, `leave-branch`) has
 * been removed. Use `--landing-action pr|merge|leave` instead.
 */

export type LandingAction = 'pr' | 'merge' | 'leave';

/** All accepted values for `--landing-action`. */
export const LANDING_ACTION_VALUES: readonly LandingAction[] = ['pr', 'merge', 'leave'];

/**
 * Validate a `--landing-action` CLI flag value.
 *
 * Returns the validated `LandingAction`, or `undefined` when no value was supplied.
 * Throws a `CLILandingFlagError` when the value is not a recognised action.
 */
export function resolveAndValidateLandingFlags(opts: {
  landingAction?: string;
}): LandingAction | undefined {
  const { landingAction } = opts;

  if (landingAction === undefined) return undefined;

  if (!LANDING_ACTION_VALUES.includes(landingAction as LandingAction)) {
    throw new CLILandingFlagError(
      `--landing-action must be one of: ${LANDING_ACTION_VALUES.join(', ')}`,
    );
  }

  return landingAction as LandingAction;
}

/** Thrown when landing flag validation fails. */
export class CLILandingFlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CLILandingFlagError';
  }
}
