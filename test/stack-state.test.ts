/**
 * Tests for stack state file round-trip, artifact lookup, and branch/ref validation.
 *
 * Verifies:
 *   1. loadStackState returns empty state when file does not exist.
 *   2. upsertStackLayer writes two layers and they round-trip through disk.
 *   3. lookupLayerByPrdId returns the correct layer.
 *   4. getParentArtifactBranch returns the parent's artifact branch for a child PRD.
 *   5. getParentArtifactBranch falls back to parent.branch when no artifact is set.
 *   6. isArtifactAvailable returns correct values based on status and artifact presence.
 *   7. upsertStackLayer replaces an existing layer in-place (idempotent update).
 *   8. concurrent upserts of different PRDs do not lose layers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadStackState,
  upsertStackLayer,
  lookupLayerByPrdId,
  getParentArtifactBranch,
  isArtifactAvailable,
  stackStateSchema,
} from '@eforge-build/engine/stacking';
import type { StackLayer } from '@eforge-build/engine/stacking';

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

  it('returns true for a built layer', async () => {
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
    expect(isArtifactAvailable(state, 'built-layer')).toBe(true);
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
