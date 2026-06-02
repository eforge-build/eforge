import type { SessionPlanSetListEntryWire, SessionPlanSetListResponse, SessionPlanSetShowResponse, SessionPlanSetSummaryWire, SessionPlanSetValidateResponse, SessionPlanSetValidationResultWire } from '@eforge-build/client';

export function isUnsafePlanSetId(id: string): boolean { return id.length === 0 || id.includes('/') || id.includes('\\') || id.includes('..') || id.includes('\0'); }
export async function listSessionPlanSetsWire(cwd: string, includeSubmitted: boolean): Promise<SessionPlanSetListResponse> {
  const { listSessionPlanSets } = await import('@eforge-build/input');
  const entries = await listSessionPlanSets({ cwd });
  const planSets: SessionPlanSetListEntryWire[] = entries.filter((e: any) => e.status !== 'abandoned').filter((e: any) => includeSubmitted || e.status !== 'submitted').map((e: any) => ({ id: e.id, planSetId: e.planSetId, title: e.title, status: e.status, strategy: e.strategy, dir: e.dir, manifestPath: e.manifestPath, childCount: e.childCount }));
  return { planSets };
}
export async function validateSessionPlanSetWire(cwd: string, planSetId: string): Promise<SessionPlanSetValidateResponse> { const { validateSessionPlanSet } = await import('@eforge-build/input'); return await validateSessionPlanSet({ cwd, planSetId }) as unknown as SessionPlanSetValidateResponse; }
export async function showSessionPlanSetWire(cwd: string, planSetId: string): Promise<SessionPlanSetShowResponse> { const { loadSessionPlanSet, validateLoadedSessionPlanSet } = await import('@eforge-build/input'); const load = await loadSessionPlanSet({ cwd, planSetId }); const validation = validateLoadedSessionPlanSet(load); return { planSet: validation.summary as unknown as SessionPlanSetSummaryWire, validation: validation as unknown as SessionPlanSetValidationResultWire, dir: load.dir, manifestPath: load.manifestPath, ...(load.anchor?.exists === true && load.anchor.content !== undefined ? { anchorContent: load.anchor.content } : {}) }; }
export function sessionPlanSetErrorStatus(err: unknown): number { const code = (err as NodeJS.ErrnoException | undefined)?.code; const msg = err instanceof Error ? err.message : String(err); if (code === 'ENOENT' || /no such file|does not exist|not found/i.test(msg)) return 404; if (/unsafe|invalid .*path|escape|outside|traversal/i.test(msg) || /invalid session plan-set id/i.test(msg)) return 400; return 500; }
