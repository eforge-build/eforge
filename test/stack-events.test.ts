/**
 * Tests for new stack wire events.
 *
 * Verifies:
 *   1. safeParseEforgeEvent accepts stack:layer:recorded with required fields.
 *   2. safeParseEforgeEvent accepts stack:provider:command with required fields.
 *   3. safeParseEforgeEvent accepts stack:landing:update with required fields.
 *   4. safeParseEforgeEvent rejects each event when required fields are missing.
 */

import { describe, it, expect } from 'vitest';
import { safeParseEforgeEvent } from '@eforge-build/client';
import { stackProviderCommandEventFromError } from '@eforge-build/engine/stacking';

const envelope = {
  sessionId: 'test-session',
  runId: 'test-run',
  timestamp: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// stack:layer:recorded
// ---------------------------------------------------------------------------

describe('stack:layer:recorded', () => {
  it('accepts a valid payload', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:layer:recorded',
      prdId: 'my-prd',
      stackId: 'stack-abc',
      provider: 'git-spice',
      branch: 'feat/my-prd',
      status: 'pending',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional parentPrdId and baseBranch', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:layer:recorded',
      prdId: 'child-prd',
      stackId: 'stack-abc',
      parentPrdId: 'parent-prd',
      provider: 'git-spice',
      branch: 'feat/child',
      baseBranch: 'feat/parent',
      status: 'pending',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing prdId', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:layer:recorded',
      stackId: 'stack-abc',
      provider: 'git-spice',
      branch: 'feat/my-prd',
      status: 'pending',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid provider', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:layer:recorded',
      prdId: 'my-prd',
      stackId: 'stack-abc',
      provider: 'github-stacking',
      branch: 'feat/my-prd',
      status: 'pending',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stack:provider:command
// ---------------------------------------------------------------------------

describe('stack:provider:command', () => {
  it('accepts a valid payload', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:provider:command',
      provider: 'git-spice',
      command: 'branch create',
      exitCode: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional branch field', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:provider:command',
      provider: 'git-spice',
      command: 'branch submit',
      exitCode: 0,
      branch: 'feat/my-prd',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null exitCode for unknown provider command failures', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:provider:command',
      provider: 'git-spice',
      command: 'git-spice',
      args: ['branch', 'restack', '--continue'],
      exitCode: null,
      branch: 'feat/my-prd',
    });
    expect(result.success).toBe(true);
  });

  it('emits null exitCode from command-like provider errors', () => {
    const event = stackProviderCommandEventFromError('git-spice', 'feat/my-prd', {
      command: 'git-spice',
      args: ['branch', 'restack', '--continue'],
      exitCode: null,
    }, (message) => message);

    expect(event).toMatchObject({
      type: 'stack:provider:command',
      exitCode: null,
      branch: 'feat/my-prd',
    });
    expect(safeParseEforgeEvent(event).success).toBe(true);
  });

  it('rejects missing command', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:provider:command',
      provider: 'git-spice',
      exitCode: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stack:landing:update
// ---------------------------------------------------------------------------

describe('stack:landing:update', () => {
  it('accepts a valid started payload', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:landing:update',
      prdId: 'my-prd',
      stackId: 'stack-abc',
      action: 'pr',
      branch: 'feat/my-prd',
      status: 'started',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional prUrl', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:landing:update',
      prdId: 'my-prd',
      stackId: 'stack-abc',
      action: 'pr',
      branch: 'feat/my-prd',
      status: 'complete',
      prUrl: 'https://github.com/org/repo/pull/42',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional base repair metadata', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:landing:update',
      prdId: 'my-prd',
      stackId: 'stack-abc',
      action: 'pr',
      branch: 'feat/my-prd',
      status: 'complete',
      originalBaseBranch: 'eforge/parent-prd',
      effectiveBaseBranch: 'main',
      baseRepairReason: 'parent-artifact-already-integrated',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:landing:update',
      prdId: 'my-prd',
      stackId: 'stack-abc',
      action: 'issue-pr',
      branch: 'feat/my-prd',
      status: 'started',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing prdId', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:landing:update',
      stackId: 'stack-abc',
      action: 'pr',
      branch: 'feat/my-prd',
      status: 'started',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stack landing conflict recovery lifecycle events
// ---------------------------------------------------------------------------

describe('stack landing conflict recovery lifecycle events', () => {
  it('accepts valid recovery lifecycle payloads', () => {
    const common = {
      ...envelope,
      prdId: 'my-prd',
      stackId: 'stack-abc',
      provider: 'git-spice',
      branch: 'feat/my-prd',
    };

    const events = [
      {
        ...common,
        type: 'stack:landing:conflict:detected',
        operation: 'branch-restack',
        conflictKind: 'git-rebase',
        conflictedFiles: ['src/a.ts'],
      },
      {
        ...common,
        type: 'stack:landing:conflict:recovery:start',
        attempt: 1,
        maxAttempts: 3,
      },
      {
        ...common,
        type: 'stack:landing:conflict:recovery:complete',
        attempts: 1,
      },
      {
        ...common,
        type: 'stack:landing:conflict:recovery:failed',
        attempts: 2,
        reason: 'still conflicted',
        abortAttempted: true,
        abortSucceeded: true,
      },
    ];

    for (const event of events) {
      expect(safeParseEforgeEvent(event).success).toBe(true);
    }
  });

  it('rejects recovery lifecycle payloads missing required identifiers', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:landing:conflict:recovery:start',
      provider: 'git-spice',
      branch: 'feat/my-prd',
      attempt: 1,
      maxAttempts: 3,
    });
    expect(result.success).toBe(false);
  });

  it('rejects recovery:start when attempt exceeds maxAttempts', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:landing:conflict:recovery:start',
      prdId: 'my-prd',
      stackId: 'stack-abc',
      provider: 'git-spice',
      branch: 'feat/my-prd',
      attempt: 4,
      maxAttempts: 3,
    });
    expect(result.success).toBe(false);
  });

  it('rejects recovery:failed when abort succeeded without an abort attempt', () => {
    const result = safeParseEforgeEvent({
      ...envelope,
      type: 'stack:landing:conflict:recovery:failed',
      prdId: 'my-prd',
      stackId: 'stack-abc',
      provider: 'git-spice',
      branch: 'feat/my-prd',
      attempts: 1,
      reason: 'failed',
      abortAttempted: false,
      abortSucceeded: true,
    });
    expect(result.success).toBe(false);
  });
});
