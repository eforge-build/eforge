import type {
  SessionPlanSetListEntryWire,
  SessionPlanSetListResponse,
  SessionPlanSetShowResponse,
  SessionPlanSetValidateResponse,
} from '@eforge-build/client';

async function getPlanningAdapter() {
  const { createSessionPlanningWorkflowAdapter } = await import('@eforge-build/input');
  return createSessionPlanningWorkflowAdapter();
}

export function isUnsafePlanSetId(id: string): boolean {
  return id.length === 0 || id.includes('/') || id.includes('\\') || id.includes('..') || id.includes('\0');
}

export async function listSessionPlanSetsWire(cwd: string, includeSubmitted: boolean): Promise<SessionPlanSetListResponse> {
  const adapter = await getPlanningAdapter();
  const entries = await adapter.planSets.list({ cwd, includeSubmitted });
  const planSets: SessionPlanSetListEntryWire[] = entries.map((entry) => ({
    id: entry.id,
    planSetId: entry.planSetId,
    title: entry.title,
    status: entry.status,
    strategy: entry.strategy,
    dir: entry.dir,
    manifestPath: entry.manifestPath,
    childCount: entry.childCount,
  }));
  return { planSets };
}

export async function validateSessionPlanSetWire(cwd: string, planSetId: string): Promise<SessionPlanSetValidateResponse> {
  const adapter = await getPlanningAdapter();
  return await adapter.planSets.validate({ cwd, planSetId }) as unknown as SessionPlanSetValidateResponse;
}

export async function showSessionPlanSetWire(cwd: string, planSetId: string): Promise<SessionPlanSetShowResponse> {
  const adapter = await getPlanningAdapter();
  const load = await adapter.planSets.load({ cwd, planSetId });
  const validation = await adapter.planSets.validate({ cwd, planSetId });
  return {
    planSet: validation.summary as unknown as SessionPlanSetShowResponse['planSet'],
    validation: validation as unknown as SessionPlanSetShowResponse['validation'],
    dir: load.dir,
    manifestPath: load.manifestPath,
    ...(load.anchor?.exists === true && load.anchor.content !== undefined ? { anchorContent: load.anchor.content } : {}),
  };
}

export function sessionPlanSetErrorStatus(err: unknown): number {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'ENOENT' || /no such file|does not exist|not found/i.test(msg)) return 404;
  if (/unsafe|invalid .*path|escape|outside|traversal/i.test(msg) || /invalid session plan-set id/i.test(msg)) return 400;
  return 500;
}
