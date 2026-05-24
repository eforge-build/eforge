/**
 * Tests for CLI landing-action vocabulary mapper (plan-04-consumer-surfaces).
 *
 * Covers:
 *  1. resolveLandingAction maps shorthands (pr|merge|leave) to wire values.
 *  2. resolveAndValidateLandingFlags:
 *     a. Returns the mapped wire value when only --landing-action is provided.
 *     b. Returns the wire value when only --on-success is provided.
 *     c. Returns the agreed-upon value when both flags resolve to the same wire value.
 *     d. Throws CLILandingFlagError when --landing-action is unrecognised.
 *     e. Throws CLILandingFlagError when --on-success is invalid.
 *     f. Throws CLILandingFlagError when both flags conflict.
 *     g. Returns undefined when neither flag is supplied.
 *
 * Follows AGENTS.md conventions: no mocks, real code, inline data.
 */

// --- eforge:region plan-04-consumer-surfaces ---

import { describe, it, expect } from 'vitest';
import {
  resolveLandingAction,
  resolveAndValidateLandingFlags,
  CLILandingFlagError,
} from '../packages/eforge/src/cli/landing-options.js';

describe('resolveLandingAction', () => {
  it('maps "pr" to "issue-pr"', () => {
    expect(resolveLandingAction('pr')).toBe('issue-pr');
  });

  it('maps "merge" to "merge-to-base-branch"', () => {
    expect(resolveLandingAction('merge')).toBe('merge-to-base-branch');
  });

  it('maps "leave" to "leave-branch"', () => {
    expect(resolveLandingAction('leave')).toBe('leave-branch');
  });

  it('returns undefined for unknown values', () => {
    expect(resolveLandingAction('unknown')).toBeUndefined();
    expect(resolveLandingAction('issue-pr')).toBeUndefined();
    expect(resolveLandingAction('')).toBeUndefined();
  });
});

describe('resolveAndValidateLandingFlags', () => {
  it('returns undefined when neither flag is supplied', () => {
    expect(resolveAndValidateLandingFlags({})).toBeUndefined();
  });

  it('maps --landing-action "pr" to wire value "issue-pr"', () => {
    expect(resolveAndValidateLandingFlags({ landingAction: 'pr' })).toBe('issue-pr');
  });

  it('maps --landing-action "merge" to wire value "merge-to-base-branch"', () => {
    expect(resolveAndValidateLandingFlags({ landingAction: 'merge' })).toBe('merge-to-base-branch');
  });

  it('maps --landing-action "leave" to wire value "leave-branch"', () => {
    expect(resolveAndValidateLandingFlags({ landingAction: 'leave' })).toBe('leave-branch');
  });

  it('accepts valid --on-success wire values directly', () => {
    expect(resolveAndValidateLandingFlags({ onSuccess: 'issue-pr' })).toBe('issue-pr');
    expect(resolveAndValidateLandingFlags({ onSuccess: 'merge-to-base-branch' })).toBe('merge-to-base-branch');
    expect(resolveAndValidateLandingFlags({ onSuccess: 'leave-branch' })).toBe('leave-branch');
  });

  it('accepts non-conflicting combination: --landing-action pr + --on-success issue-pr', () => {
    expect(
      resolveAndValidateLandingFlags({ landingAction: 'pr', onSuccess: 'issue-pr' }),
    ).toBe('issue-pr');
  });

  it('throws CLILandingFlagError for unrecognised --landing-action value', () => {
    expect(() => resolveAndValidateLandingFlags({ landingAction: 'bad' })).toThrow(CLILandingFlagError);
    expect(() => resolveAndValidateLandingFlags({ landingAction: 'issue-pr' })).toThrow(CLILandingFlagError);
  });

  it('throws CLILandingFlagError for invalid --on-success value', () => {
    expect(() => resolveAndValidateLandingFlags({ onSuccess: 'bad' })).toThrow(CLILandingFlagError);
    expect(() => resolveAndValidateLandingFlags({ onSuccess: 'pr' })).toThrow(CLILandingFlagError);
  });

  it('throws CLILandingFlagError when --landing-action pr conflicts with --on-success merge-to-base-branch', () => {
    expect(() =>
      resolveAndValidateLandingFlags({ landingAction: 'pr', onSuccess: 'merge-to-base-branch' }),
    ).toThrow(CLILandingFlagError);
  });

  it('throws CLILandingFlagError when --landing-action merge conflicts with --on-success issue-pr', () => {
    expect(() =>
      resolveAndValidateLandingFlags({ landingAction: 'merge', onSuccess: 'issue-pr' }),
    ).toThrow(CLILandingFlagError);
  });

  it('throws CLILandingFlagError when --landing-action leave conflicts with --on-success merge-to-base-branch', () => {
    expect(() =>
      resolveAndValidateLandingFlags({ landingAction: 'leave', onSuccess: 'merge-to-base-branch' }),
    ).toThrow(CLILandingFlagError);
  });
});

// --- eforge:endregion plan-04-consumer-surfaces ---
