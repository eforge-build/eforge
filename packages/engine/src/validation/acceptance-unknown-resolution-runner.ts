import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { EforgeEvent, EforgeState } from '../events.js';
import type { AcceptanceUnknownResolver } from '../orchestrator.js';
import type { ModelTracker } from '../model-tracker.js';
import type { ExpectedAcceptanceCriterion } from './acceptance-criteria.js';
import {
  getExpectedUnknownCriteria,
  hasUnresolvedAcceptanceUnknowns,
  mergeAcceptanceUnknownResolutions,
  shouldRunAcceptanceUnknownResolver,
  type AcceptanceValidationEvent,
  type ValidationCommandEvidence,
} from './acceptance-unknown-resolution.js';

const exec = promisify(execFile);

export interface AcceptanceUnknownResolutionPhaseContext {
  acceptanceUnknownResolver?: AcceptanceUnknownResolver;
  expectedAcceptanceCriteria?: ExpectedAcceptanceCriterion[];
  validationCommandEvidence?: ValidationCommandEvidence[];
  mergeWorktreePath: string;
  state: EforgeState;
  modelTracker: ModelTracker;
}

export async function* resolveAcceptanceUnknownsIfNeeded(
  ctx: AcceptanceUnknownResolutionPhaseContext,
  prdValidationPassed: boolean | undefined,
  event: AcceptanceValidationEvent,
): AsyncGenerator<EforgeEvent, AcceptanceValidationEvent, void> {
  if (!ctx.acceptanceUnknownResolver || !shouldRunAcceptanceUnknownResolver({
    prdValidationPassed,
    expectedAcceptanceCriteria: ctx.expectedAcceptanceCriteria,
    acceptanceEvent: event,
    validationCommandEvidence: ctx.validationCommandEvidence,
  })) return event;

  const expected = ctx.expectedAcceptanceCriteria ?? [];
  const dirtyBefore = await getAcceptanceResolverDirtyStatus(ctx.mergeWorktreePath);
  if (dirtyBefore) return failResolver(ctx, event, `Acceptance unknown resolver skipped: dirty merge worktree before resolver (${dirtyBefore})`);

  let resolutions;
  let resolverError: unknown;
  const iterator = ctx.acceptanceUnknownResolver(ctx.mergeWorktreePath, {
    unknownCriteria: getExpectedUnknownCriteria(expected, event.verdicts),
    acceptanceVerdicts: event.verdicts,
    validationCommandEvidence: ctx.validationCommandEvidence,
    implementationDiffContext: '',
  });
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) { resolutions = next.value; break; }
      if (next.value.type === 'agent:start') ctx.modelTracker.record(next.value.model);
      yield next.value;
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    resolverError = err;
  }

  const dirtyAfter = await getAcceptanceResolverDirtyStatus(ctx.mergeWorktreePath);
  if (dirtyAfter) return failResolver(ctx, event, `Acceptance unknown resolver failed: dirty merge worktree after resolver (${dirtyAfter})`);
  if (resolverError) {
    const message = resolverError instanceof Error ? resolverError.message : String(resolverError);
    return failResolver(ctx, event, `Acceptance unknown resolver failed: ${message}`);
  }
  if (!resolutions) return failResolver(ctx, event, 'Acceptance unknown resolver failed: resolver did not return structured verdicts');

  const merged = mergeAcceptanceUnknownResolutions(event, expected, resolutions);
  return hasUnresolvedAcceptanceUnknowns(merged, expected) ? { ...merged, passed: false } : merged;
}

async function getAcceptanceResolverDirtyStatus(cwd: string): Promise<string> {
  try {
    const { stdout } = await exec('git', ['status', '--porcelain', '--untracked-files=all'], { cwd });
    return stdout.trim();
  } catch (err) {
    return `git status failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function failResolver(
  ctx: AcceptanceUnknownResolutionPhaseContext,
  event: AcceptanceValidationEvent,
  message: string,
): AcceptanceValidationEvent {
  ctx.state.status = 'failed';
  ctx.state.completedAt = new Date().toISOString();
  return {
    ...event,
    passed: false,
    verdicts: event.verdicts.map((verdict) => verdict.verdict === 'unknown'
      ? { ...verdict, evidence: `${verdict.evidence} ${message}` }
      : verdict),
  };
}
