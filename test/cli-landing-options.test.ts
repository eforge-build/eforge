/**
 * Tests for CLI landing-action vocabulary (plan-01-landing-vocabulary-clean-break).
 *
 * Covers:
 *  1. resolveLandingAction validates canonical shorthands (pr|merge|leave) and
 *     returns the value directly — no wire-value mapping.
 *  2. resolveAndValidateLandingFlags:
 *     a. Returns the canonical value when --landing-action is provided.
 *     b. Returns undefined when no flag is supplied.
 *     c. Throws CLILandingFlagError when --landing-action is unrecognised.
 *     d. Throws CLILandingFlagError for old wire values (migration: use pr|merge|leave).
 *
 * Follows AGENTS.md conventions: no mocks, real code, inline data.
 */

// --- eforge:region plan-04-consumer-surfaces ---

import { describe, it, expect } from 'vitest';
import {
  resolveLandingAction,
  resolveAndValidateLandingFlags,
  CLILandingFlagError,
  // --- eforge:region plan-02-request-surfaces-and-pi-ux ---
  resolveAndValidateLandingAutoMergeFlags,
  // --- eforge:endregion plan-02-request-surfaces-and-pi-ux ---
} from '../packages/eforge/src/cli/landing-options.js';

describe('resolveLandingAction', () => {
  it('accepts "pr" and returns "pr"', () => {
    expect(resolveLandingAction('pr')).toBe('pr');
  });

  it('accepts "merge" and returns "merge"', () => {
    expect(resolveLandingAction('merge')).toBe('merge');
  });

  it('accepts "leave" and returns "leave"', () => {
    expect(resolveLandingAction('leave')).toBe('leave');
  });

  it('returns undefined for unknown values', () => {
    expect(resolveLandingAction('unknown')).toBeUndefined();
    expect(resolveLandingAction('')).toBeUndefined();
  });

  it('returns undefined for old wire values (migration: use pr|merge|leave)', () => {
    expect(resolveLandingAction('issue-pr')).toBeUndefined();
    expect(resolveLandingAction('merge-to-base-branch')).toBeUndefined();
    expect(resolveLandingAction('leave-branch')).toBeUndefined();
  });
});

describe('resolveAndValidateLandingFlags', () => {
  it('returns undefined when no flag is supplied', () => {
    expect(resolveAndValidateLandingFlags({})).toBeUndefined();
  });

  it('returns "pr" for --landing-action "pr"', () => {
    expect(resolveAndValidateLandingFlags({ landingAction: 'pr' })).toBe('pr');
  });

  it('returns "merge" for --landing-action "merge"', () => {
    expect(resolveAndValidateLandingFlags({ landingAction: 'merge' })).toBe('merge');
  });

  it('returns "leave" for --landing-action "leave"', () => {
    expect(resolveAndValidateLandingFlags({ landingAction: 'leave' })).toBe('leave');
  });

  it('throws CLILandingFlagError for unrecognised --landing-action value', () => {
    expect(() => resolveAndValidateLandingFlags({ landingAction: 'bad' })).toThrow(CLILandingFlagError);
    expect(() => resolveAndValidateLandingFlags({ landingAction: '' })).toThrow(CLILandingFlagError);
  });

  it('throws CLILandingFlagError for old wire values (migration: use pr|merge|leave)', () => {
    expect(() => resolveAndValidateLandingFlags({ landingAction: 'issue-pr' })).toThrow(CLILandingFlagError);
    expect(() => resolveAndValidateLandingFlags({ landingAction: 'merge-to-base-branch' })).toThrow(CLILandingFlagError);
    expect(() => resolveAndValidateLandingFlags({ landingAction: 'leave-branch' })).toThrow(CLILandingFlagError);
  });
});

// --- eforge:endregion plan-04-consumer-surfaces ---

// --- eforge:region plan-02-request-surfaces-and-pi-ux ---

describe('resolveAndValidateLandingAutoMergeFlags', () => {
  it('returns undefined when landingAutoMerge is not provided', () => {
    expect(resolveAndValidateLandingAutoMergeFlags({})).toBeUndefined();
  });

  it('returns true when landingAutoMerge is true', () => {
    expect(resolveAndValidateLandingAutoMergeFlags({ landingAutoMerge: true })).toBe(true);
  });

  it('returns false when landingAutoMerge is false', () => {
    expect(resolveAndValidateLandingAutoMergeFlags({ landingAutoMerge: false })).toBe(false);
  });

  it('returns undefined when landingAutoMerge is explicitly undefined', () => {
    expect(resolveAndValidateLandingAutoMergeFlags({ landingAutoMerge: undefined })).toBeUndefined();
  });
});

// --- eforge:endregion plan-02-request-surfaces-and-pi-ux ---
