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
 * Resolve a string to a `LandingAction` if it is a recognised canonical value,
 * or `undefined` otherwise. Does not throw — unknown and old wire values both
 * return `undefined`.
 */
export function resolveLandingAction(value: string): LandingAction | undefined {
  if (LANDING_ACTION_VALUES.includes(value as LandingAction)) {
    return value as LandingAction;
  }
  return undefined;
}

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

/**
 * Resolve paired boolean auto-merge flags into a `boolean | undefined`.
 *
 * Commander paired booleans (`--landing-auto-merge` / `--no-landing-auto-merge`)
 * produce a single `landingAutoMerge?: boolean` option where:
 *   - `--landing-auto-merge` → `true`
 *   - `--no-landing-auto-merge` → `false`
 *   - neither flag → `undefined`
 *
 * Commander handles conflict resolution (last flag wins), so this function is
 * a simple pass-through that documents the contract.
 */
export function resolveAndValidateLandingAutoMergeFlags(opts: {
  landingAutoMerge?: boolean;
}): boolean | undefined {
  return opts.landingAutoMerge;
}
