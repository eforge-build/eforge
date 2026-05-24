/**
 * Tests for stack state file round-trip, artifact lookup, and branch/ref validation.
 *
 * Verifies:
 *   1. loadStackState returns empty state when file does not exist.
 *   2. upsertStackLayer writes two layers and they round-trip through disk.
 *   3. lookupLayerByPrdId returns the correct layer.
 *   4. getParentArtifactBranch returns the parent's artifact branch for a child PRD.
 *   5. getParentArtifactBranch falls back to parent.branch when no artifact is set.
 *   6. isArtifactAvailable returns correct values based on artifact presence.
 *   7. upsertStackLayer replaces an existing layer in-place (idempotent update).
 *   8. concurrent upserts of different PRDs do not lose layers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadStackState,
  upsertStackLayer,
  lookupLayerByPrdId,
  getParentArtifactBranch,
  isArtifactAvailable,
  stackStateSchema,
  updateStackLayerLanding,
  markStackLayerFailed,
  // --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
  updateStackLayerStatusAndLanding,
  // --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---
} from '@eforge-build/engine/stacking';
import type { StackLayer, StackLayerLanding } from '@eforge-build/engine/stacking';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'eforge-stack-state-'));
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('loadStackState', () => {
  it('returns empty state when file does not exist', async () => {
    const state = await loadStackState(cwd);
    expect(state.version).toBe(1);
    expect(state.layers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: write two layers and reload
// ---------------------------------------------------------------------------

describe('upsertStackLayer — round-trip', () => {
  it('writes two layers and reloads them correctly', async () => {
    const now = new Date().toISOString();

    const parentLayer: StackLayer = {
      prdId: 'feat-parent',
      stackId: 'stack-abc',
      provider: 'git-spice',
      branch: 'feat/parent-branch',
      baseBranch: 'main',
      status: 'built',
      artifact: { branch: 'feat/parent-branch', commitSha: 'abc123' },
      recordedAt: now,
      updatedAt: now,
    };

    const childLayer: StackLayer = {
      prdId: 'feat-child',
      stackId: 'stack-abc',
      parentPrdId: 'feat-parent',
      provider: 'git-spice',
      branch: 'feat/child-branch',
      baseBranch: 'feat/parent-branch',
      status: 'pending',
      recordedAt: now,
      updatedAt: now,
    };

    await upsertStackLayer(cwd, parentLayer);
    await upsertStackLayer(cwd, childLayer);

    // Reload from disk
    const state = await loadStackState(cwd);
    expect(state.version).toBe(1);
    expect(state.layers).toHaveLength(2);

    const reloadedParent = lookupLayerByPrdId(state, 'feat-parent');
    expect(reloadedParent).toBeDefined();
    expect(reloadedParent?.branch).toBe('feat/parent-branch');
    expect(reloadedParent?.artifact?.commitSha).toBe('abc123');

    const reloadedChild = lookupLayerByPrdId(state, 'feat-child');
    expect(reloadedChild).toBeDefined();
    expect(reloadedChild?.parentPrdId).toBe('feat-parent');
    expect(reloadedChild?.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// Parent artifact branch lookup
// ---------------------------------------------------------------------------

describe('getParentArtifactBranch', () => {
  it('returns the parent artifact branch for a child PRD', async () => {
    const now = new Date().toISOString();

    await upsertStackLayer(cwd, {
      prdId: 'parent-prd',
      stackId: 'stack-xyz',
      provider: 'git-spice',
      branch: 'feat/parent',
      status: 'built',
      artifact: { branch: 'feat/parent', commitSha: 'deadbeef' },
      recordedAt: now,
      updatedAt: now,
    });

    await upsertStackLayer(cwd, {
      prdId: 'child-prd',
      stackId: 'stack-xyz',
      parentPrdId: 'parent-prd',
      provider: 'git-spice',
      branch: 'feat/child',
      status: 'pending',
      recordedAt: now,
      updatedAt: now,
    });

    const state = await loadStackState(cwd);
    const parentBranch = getParentArtifactBranch(state, 'child-prd');
    expect(parentBranch).toBe('feat/parent');
  });

  it('falls back to parent.branch when no artifact is set', async () => {
    const now = new Date().toISOString();

    await upsertStackLayer(cwd, {
      prdId: 'parent-noart',
      stackId: 'stack-noart',
      provider: 'git-spice',
      branch: 'feat/parent-noart',
      status: 'building',
      // No artifact
      recordedAt: now,
      updatedAt: now,
    });

    await upsertStackLayer(cwd, {
      prdId: 'child-noart',
      stackId: 'stack-noart',
      parentPrdId: 'parent-noart',
      provider: 'git-spice',
      branch: 'feat/child-noart',
      status: 'pending',
      recordedAt: now,
      updatedAt: now,
    });

    const state = await loadStackState(cwd);
    const parentBranch = getParentArtifactBranch(state, 'child-noart');
    expect(parentBranch).toBe('feat/parent-noart');
  });

  it('returns undefined when child has no parent', async () => {
    const now = new Date().toISOString();

    await upsertStackLayer(cwd, {
      prdId: 'root-layer',
      stackId: 'stack-root',
      provider: 'git-spice',
      branch: 'feat/root',
      status: 'pending',
      recordedAt: now,
      updatedAt: now,
    });

    const state = await loadStackState(cwd);
    const parentBranch = getParentArtifactBranch(state, 'root-layer');
    expect(parentBranch).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isArtifactAvailable
// ---------------------------------------------------------------------------

describe('isArtifactAvailable', () => {
  it('returns false for a pending layer with no artifact', async () => {
    const now = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'pending-layer',
      stackId: 's',
      provider: 'git-spice',
      branch: 'feat/p',
      status: 'pending',
      recordedAt: now,
      updatedAt: now,
    });
    const state = await loadStackState(cwd);
    expect(isArtifactAvailable(state, 'pending-layer')).toBe(false);
  });

  it('returns false for a built layer without an explicit artifact ref', async () => {
    const now = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'built-layer',
      stackId: 's',
      provider: 'git-spice',
      branch: 'feat/b',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
    });
    const state = await loadStackState(cwd);
    expect(isArtifactAvailable(state, 'built-layer')).toBe(false);
  });

  it('returns true for a pending layer that has an explicit artifact ref', async () => {
    const now = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'art-layer',
      stackId: 's',
      provider: 'git-spice',
      branch: 'feat/a',
      status: 'pending',
      artifact: { branch: 'feat/a' },
      recordedAt: now,
      updatedAt: now,
    });
    const state = await loadStackState(cwd);
    expect(isArtifactAvailable(state, 'art-layer')).toBe(true);
  });

  it('returns false for unknown prdId', async () => {
    const state = await loadStackState(cwd);
    expect(isArtifactAvailable(state, 'nonexistent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Concurrent upserts preserve all layers
// ---------------------------------------------------------------------------

describe('upsertStackLayer — concurrent writes', () => {
  it('removes a stale lock file instead of waiting forever', async () => {
    await mkdir(join(cwd, '.eforge', 'stacks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'stacks', 'layers.lock'), 'not-a-pid', 'utf-8');

    const now = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'stale-lock-prd',
      stackId: 'stack-stale-lock',
      provider: 'git-spice',
      branch: 'feat/stale-lock-prd',
      status: 'pending',
      recordedAt: now,
      updatedAt: now,
    });

    const state = await loadStackState(cwd);
    expect(state.layers.map((layer) => layer.prdId)).toEqual(['stale-lock-prd']);
  });

  it('preserves all layers from concurrent upserts of different PRD ids', async () => {
    const now = new Date().toISOString();
    const layers: StackLayer[] = Array.from({ length: 20 }, (_, i) => ({
      prdId: `prd-${i}`,
      stackId: 'stack-concurrent',
      provider: 'git-spice',
      branch: `feat/prd-${i}`,
      status: 'pending',
      recordedAt: now,
      updatedAt: now,
    }));

    await Promise.all(layers.map((layer) => upsertStackLayer(cwd, layer)));

    const state = await loadStackState(cwd);
    expect(state.layers).toHaveLength(layers.length);
    expect(state.layers.map((layer) => layer.prdId).sort()).toEqual(
      layers.map((layer) => layer.prdId).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Upsert replaces existing layer
// ---------------------------------------------------------------------------

describe('upsertStackLayer — idempotent update', () => {
  it('replaces a layer in-place when prdId matches', async () => {
    const now = new Date().toISOString();

    await upsertStackLayer(cwd, {
      prdId: 'my-prd',
      stackId: 'stack-1',
      provider: 'git-spice',
      branch: 'feat/my-prd',
      status: 'pending',
      recordedAt: now,
      updatedAt: now,
    });

    const updated = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'my-prd',
      stackId: 'stack-1',
      provider: 'git-spice',
      branch: 'feat/my-prd',
      status: 'built',
      artifact: { branch: 'feat/my-prd', commitSha: '001122' },
      recordedAt: now,
      updatedAt: updated,
    });

    const state = await loadStackState(cwd);
    expect(state.layers).toHaveLength(1);
    expect(state.layers[0].status).toBe('built');
    expect(state.layers[0].artifact?.commitSha).toBe('001122');
  });
});

// ---------------------------------------------------------------------------
// stackStateSchema validation
// ---------------------------------------------------------------------------

describe('stackStateSchema', () => {
  it('accepts a valid state with multiple layers', () => {
    const now = new Date().toISOString();
    const result = stackStateSchema.safeParse({
      version: 1,
      layers: [
        {
          prdId: 'p1',
          stackId: 'stack-1',
          provider: 'git-spice',
          branch: 'feat/p1',
          status: 'pending',
          recordedAt: now,
          updatedAt: now,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown provider values', () => {
    const now = new Date().toISOString();
    const result = stackStateSchema.safeParse({
      version: 1,
      layers: [
        {
          prdId: 'p1',
          stackId: 's',
          provider: 'github-stacking',
          branch: 'feat/p1',
          status: 'pending',
          recordedAt: now,
          updatedAt: now,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown status values', () => {
    const now = new Date().toISOString();
    const result = stackStateSchema.safeParse({
      version: 1,
      layers: [
        {
          prdId: 'p1',
          stackId: 's',
          provider: 'git-spice',
          branch: 'feat/p1',
          status: 'archived',
          recordedAt: now,
          updatedAt: now,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateStackLayerLanding
// ---------------------------------------------------------------------------

describe('updateStackLayerLanding', () => {
  it('updates the landing record for an existing layer', async () => {
    const now = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'landing-prd',
      stackId: 'stack-landing',
      provider: 'git-spice',
      branch: 'feat/landing-prd',
      status: 'built',
      artifact: { branch: 'feat/landing-prd', commitSha: 'abc123' },
      recordedAt: now,
      updatedAt: now,
    });

    const landing: StackLayerLanding = {
      action: 'pr',
      status: 'complete',
      prUrl: 'https://github.com/owner/repo/pull/42',
      startedAt: now,
      completedAt: now,
    };
    await updateStackLayerLanding(cwd, 'landing-prd', landing);

    const state = await loadStackState(cwd);
    const layer = lookupLayerByPrdId(state, 'landing-prd');
    expect(layer?.landing).toEqual(landing);
    // Preserves artifact and recordedAt
    expect(layer?.artifact?.commitSha).toBe('abc123');
    expect(layer?.recordedAt).toBe(now);
  });

  it('is a no-op when the layer does not exist', async () => {
    const now = new Date().toISOString();
    const landing: StackLayerLanding = {
      action: 'pr',
      status: 'complete',
      startedAt: now,
      completedAt: now,
    };
    await updateStackLayerLanding(cwd, 'nonexistent-prd', landing);
    const state = await loadStackState(cwd);
    expect(state.layers).toHaveLength(0);
  });

  it('preserves recordedAt when updating landing', async () => {
    const originalTime = new Date(Date.now() - 5000).toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'preserve-prd',
      stackId: 's',
      provider: 'git-spice',
      branch: 'feat/preserve',
      status: 'built',
      recordedAt: originalTime,
      updatedAt: originalTime,
    });

    const now = new Date().toISOString();
    await updateStackLayerLanding(cwd, 'preserve-prd', {
      action: 'pr',
      status: 'started',
      startedAt: now,
    });

    const state = await loadStackState(cwd);
    const layer = lookupLayerByPrdId(state, 'preserve-prd');
    expect(layer?.recordedAt).toBe(originalTime);
  });

  it('preserves existing artifact when updating landing', async () => {
    const now = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'artifact-prd',
      stackId: 's',
      provider: 'git-spice',
      branch: 'feat/artifact',
      status: 'built',
      artifact: { branch: 'feat/artifact', commitSha: 'deadbeef' },
      recordedAt: now,
      updatedAt: now,
    });

    await updateStackLayerLanding(cwd, 'artifact-prd', {
      action: 'pr',
      status: 'complete',
      startedAt: now,
      completedAt: now,
    });

    const state = await loadStackState(cwd);
    const layer = lookupLayerByPrdId(state, 'artifact-prd');
    expect(layer?.artifact?.commitSha).toBe('deadbeef');
  });
});

// --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
// ---------------------------------------------------------------------------
// updateStackLayerStatusAndLanding
// ---------------------------------------------------------------------------

describe('updateStackLayerStatusAndLanding', () => {
  it('atomically updates status and landing for an existing layer', async () => {
    const now = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'atomic-prd',
      stackId: 'stack-atomic',
      provider: 'git-spice',
      branch: 'feat/atomic-prd',
      status: 'built',
      artifact: { branch: 'feat/atomic-prd', commitSha: 'abc123' },
      recordedAt: now,
      updatedAt: now,
    });

    const landing: StackLayerLanding = {
      action: 'pr',
      status: 'complete',
      prUrl: 'https://github.com/owner/repo/pull/7',
      startedAt: now,
      completedAt: now,
    };
    await updateStackLayerStatusAndLanding(cwd, 'atomic-prd', 'landed', landing);

    const state = await loadStackState(cwd);
    const layer = lookupLayerByPrdId(state, 'atomic-prd');
    expect(layer?.status).toBe('landed');
    expect(layer?.landing).toEqual(landing);
    // Preserves artifact and recordedAt
    expect(layer?.artifact?.commitSha).toBe('abc123');
    expect(layer?.recordedAt).toBe(now);
  });

  it('sets status to failed when landing failed', async () => {
    const now = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'failed-atomic',
      stackId: 's',
      provider: 'git-spice',
      branch: 'feat/failed-atomic',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
    });

    await updateStackLayerStatusAndLanding(cwd, 'failed-atomic', 'failed', {
      action: 'pr',
      status: 'failed',
      reason: 'submit error',
      startedAt: now,
      completedAt: now,
    });

    const state = await loadStackState(cwd);
    const layer = lookupLayerByPrdId(state, 'failed-atomic');
    expect(layer?.status).toBe('failed');
    expect(layer?.landing?.status).toBe('failed');
    expect(layer?.landing?.reason).toBe('submit error');
  });

  it('sets status to merged when non-pr merge action skips', async () => {
    const now = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'merge-skip',
      stackId: 's',
      provider: 'git-spice',
      branch: 'feat/merge-skip',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
    });

    await updateStackLayerStatusAndLanding(cwd, 'merge-skip', 'merged', {
      action: 'merge',
      status: 'skipped',
      reason: "Landing action is 'merge', not 'pr'",
      startedAt: now,
      completedAt: now,
    });

    const state = await loadStackState(cwd);
    const layer = lookupLayerByPrdId(state, 'merge-skip');
    expect(layer?.status).toBe('merged');
    expect(layer?.landing?.action).toBe('merge');
  });

  it('is a no-op when the layer does not exist', async () => {
    const now = new Date().toISOString();
    await updateStackLayerStatusAndLanding(cwd, 'nonexistent', 'landed', {
      action: 'pr',
      status: 'complete',
      startedAt: now,
      completedAt: now,
    });
    const state = await loadStackState(cwd);
    expect(state.layers).toHaveLength(0);
  });
});
// --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---

// ---------------------------------------------------------------------------
// markStackLayerFailed
// ---------------------------------------------------------------------------

describe('markStackLayerFailed', () => {
  it('marks the layer as failed with a reason', async () => {
    const now = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'fail-prd',
      stackId: 's',
      provider: 'git-spice',
      branch: 'feat/fail',
      landingAction: 'pr',
      status: 'built',
      artifact: { branch: 'feat/fail', commitSha: 'deadbeef' },
      recordedAt: now,
      updatedAt: now,
    });

    await markStackLayerFailed(cwd, 'fail-prd', 'git-spice command failed');

    const state = await loadStackState(cwd);
    const layer = lookupLayerByPrdId(state, 'fail-prd');
    expect(layer?.status).toBe('failed');
    expect(layer?.landing?.status).toBe('failed');
    expect(layer?.landing?.reason).toBe('git-spice command failed');
    // Artifact and recordedAt are preserved
    expect(layer?.artifact?.commitSha).toBe('deadbeef');
    expect(layer?.recordedAt).toBe(now);
  });

  it('is a no-op when the layer does not exist', async () => {
    await markStackLayerFailed(cwd, 'nonexistent', 'some reason');
    const state = await loadStackState(cwd);
    expect(state.layers).toHaveLength(0);
  });

  it('converts an in-progress landing record to failed when marking as failed', async () => {
    const now = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'started-landing',
      stackId: 's',
      provider: 'git-spice',
      branch: 'feat/started-landing',
      status: 'built',
      landing: {
        action: 'pr',
        status: 'started',
        startedAt: now,
      },
      recordedAt: now,
      updatedAt: now,
    });

    await markStackLayerFailed(cwd, 'started-landing', 'submit failed');

    const state = await loadStackState(cwd);
    const layer = lookupLayerByPrdId(state, 'started-landing');
    expect(layer?.status).toBe('failed');
    expect(layer?.landing?.status).toBe('failed');
    expect(layer?.landing?.reason).toBe('submit failed');
    expect(layer?.landing?.startedAt).toBe(now);
    expect(layer?.landing?.completedAt).toBeTruthy();
  });

  it('preserves a completed landing record when marking as failed', async () => {
    const now = new Date().toISOString();
    const existingLanding: StackLayerLanding = {
      action: 'pr',
      status: 'complete',
      prUrl: 'https://github.com/owner/repo/pull/99',
      startedAt: now,
      completedAt: now,
    };
    await upsertStackLayer(cwd, {
      prdId: 'with-landing',
      stackId: 's',
      provider: 'git-spice',
      branch: 'feat/with-landing',
      status: 'built',
      landing: existingLanding,
      recordedAt: now,
      updatedAt: now,
    });

    await markStackLayerFailed(cwd, 'with-landing', 'post-landing failure');

    const state = await loadStackState(cwd);
    const layer = lookupLayerByPrdId(state, 'with-landing');
    // Existing landing should be preserved (not overwritten)
    expect(layer?.landing).toEqual(existingLanding);
    expect(layer?.status).toBe('failed');
  });
});
