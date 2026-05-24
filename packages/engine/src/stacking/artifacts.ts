/**
 * Stack layer projection helper.
 *
 * This module writes the stack layer record to `.eforge/stacks/layers.json`
 * for stacked builds. It is a projection for stacked topology and provider
 * visibility only — NOT the primary artifact record.
 *
 * The provider-neutral artifact registry write (`.eforge/artifacts/builds.json`)
 * happens first in `recordArtifact` (phases.ts) via `upsertArtifact` from
 * `artifacts/registry.ts`. That registry is the engine-wide source of truth
 * for dependency readiness and is written for ALL queued PRD builds (stacked
 * and non-stacked). This function is called only for stacked builds, after
 * the registry write succeeds.
 */

import { getRefSha } from '../worktree-ops.js';
import type { EforgeEvent } from '../events.js';
import type { LandingConfig } from '../config.js';
import { loadStackState, lookupLayerByPrdId, upsertStackLayer } from './state.js';
import type { StackBaseContext } from './base-resolver.js';
import type { StackLayer } from './types.js';

export interface RecordStackArtifactOptions {
  cwd: string;
  mergeWorktreePath: string;
  stackContext: StackBaseContext;
  landingAction?: LandingConfig['action'];
}

export async function recordSuccessfulBuildArtifact(options: RecordStackArtifactOptions): Promise<EforgeEvent> {
  const { cwd, mergeWorktreePath, stackContext } = options;
  const state = await loadStackState(cwd);
  const existing = lookupLayerByPrdId(state, stackContext.prdId);
  const now = new Date().toISOString();
  const commitSha = await getRefSha(mergeWorktreePath, 'HEAD');

  const layer: StackLayer = {
    prdId: stackContext.prdId,
    stackId: stackContext.stackId,
    ...(stackContext.parentPrdId !== undefined && { parentPrdId: stackContext.parentPrdId }),
    provider: stackContext.provider,
    branch: stackContext.branch,
    baseBranch: stackContext.baseBranch,
    artifact: {
      branch: stackContext.branch,
      commitSha,
    },
    ...(options.landingAction !== undefined && { landingAction: options.landingAction }),
    // Preserve any existing landing record when retrying — do not overwrite a
    // previously persisted landing outcome (e.g., 'complete' from a prior run).
    ...(existing?.landing !== undefined && { landing: existing.landing }),
    status: 'built',
    recordedAt: existing?.recordedAt ?? now,
    updatedAt: now,
  };

  await upsertStackLayer(cwd, layer);

  return {
    timestamp: now,
    type: 'stack:layer:recorded',
    prdId: layer.prdId,
    stackId: layer.stackId,
    ...(layer.parentPrdId !== undefined && { parentPrdId: layer.parentPrdId }),
    provider: layer.provider,
    branch: layer.branch,
    baseBranch: layer.baseBranch,
    artifact: layer.artifact,
    ...(layer.landingAction !== undefined && { landingAction: layer.landingAction }),
    status: layer.status,
  } as EforgeEvent;
}
