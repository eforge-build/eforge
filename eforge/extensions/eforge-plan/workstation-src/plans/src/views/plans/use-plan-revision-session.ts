import * as React from 'react';
import { getBridge } from '@/bridge';
import { useToast } from '@/components/toast';
import type { PlanData, PlanRevisionApplyOutput, PlanRevisionRedraftAnswer, PlanRevisionSessionProjection, PlanRevisionTurnProjection, Readiness } from '@/types';
import { hasRunningRevisionTurn } from './plan-revision-view-model';

const POLL_MS = 1600;

interface MutationResult { plan?: PlanData; readiness?: Readiness }
interface UsePlanRevisionSessionOptions { session: string; onApply: (result: MutationResult) => void; onRefresh: () => Promise<void> }
interface StartTurnOutput { session: PlanRevisionSessionProjection }

export function usePlanRevisionSession({ session, onApply, onRefresh }: UsePlanRevisionSessionOptions) {
  const toast = useToast();
  const [revisionSession, setRevisionSession] = React.useState<PlanRevisionSessionProjection | null>(null);
  const [initialized, setInitialized] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [lastApplyByTurn, setLastApplyByTurn] = React.useState<Record<string, PlanRevisionApplyOutput>>({});
  const currentSessionRef = React.useRef(session);
  currentSessionRef.current = session;

  const storeSession = React.useCallback((next: PlanRevisionSessionProjection) => {
    if (next.targetSession !== currentSessionRef.current) return next;
    setRevisionSession(next);
    setInitialized(true);
    return next;
  }, []);

  React.useEffect(() => {
    setRevisionSession(null);
    setInitialized(false);
    setLoading(false);
    setBusy(false);
    setLastApplyByTurn({});
  }, [session]);

  const ensureSession = React.useCallback(async () => {
    if (revisionSession?.targetSession === session) return revisionSession;
    setLoading(true);
    try {
      return storeSession(await getBridge().invokeAction<PlanRevisionSessionProjection>('start-plan-revision-session', { session }));
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
      return null;
    } finally {
      setLoading(false);
    }
  }, [revisionSession, session, storeSession, toast]);

  const reload = React.useCallback(async (options: { includePlan?: boolean } = {}) => {
    if (!initialized && !revisionSession) return null;
    setLoading(true);
    try {
      return storeSession(await getBridge().invokeAction<PlanRevisionSessionProjection>('get-plan-revision-session', { session, includePlan: options.includePlan === true }));
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
      return null;
    } finally {
      setLoading(false);
    }
  }, [initialized, revisionSession, session, storeSession, toast]);

  const submit = React.useCallback(async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return null;
    const existing = await ensureSession();
    if (!existing) return null;
    setBusy(true);
    try {
      const result = await getBridge().invokeAction<StartTurnOutput>('start-plan-revision-turn', { session, message: trimmed });
      return storeSession(result.session);
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }, [ensureSession, session, storeSession, toast]);

  const cancel = React.useCallback(async (turn: PlanRevisionTurnProjection) => {
    setBusy(true);
    try { storeSession(await getBridge().invokeAction<PlanRevisionSessionProjection>('cancel-plan-revision-turn', { session, turnId: turn.turnId })); }
    catch (caught) { toast.push(caught instanceof Error ? caught.message : String(caught), 'error'); }
    finally { setBusy(false); }
  }, [session, storeSession, toast]);

  const retry = React.useCallback(async (turn: PlanRevisionTurnProjection) => {
    setBusy(true);
    try { storeSession((await getBridge().invokeAction<StartTurnOutput>('retry-plan-revision-turn', { session, turnId: turn.turnId })).session); }
    catch (caught) { toast.push(caught instanceof Error ? caught.message : String(caught), 'error'); }
    finally { setBusy(false); }
  }, [session, storeSession, toast]);

  const redraft = React.useCallback(async (turn: PlanRevisionTurnProjection, answers: PlanRevisionRedraftAnswer[], steering?: string) => {
    const clean = answers.filter((answer) => answer.answer.trim().length > 0).map((answer) => ({ ...answer, answer: answer.answer.trim() }));
    const cleanSteering = steering?.trim();
    if (clean.length === 0 && !cleanSteering) return;
    setBusy(true);
    try { storeSession((await getBridge().invokeAction<StartTurnOutput>('retry-plan-revision-turn', { session, turnId: turn.turnId, ...(clean.length > 0 && { answers: clean }), ...(cleanSteering && { steering: cleanSteering }) })).session); }
    catch (caught) { toast.push(caught instanceof Error ? caught.message : String(caught), 'error'); }
    finally { setBusy(false); }
  }, [session, storeSession, toast]);

  const apply = React.useCallback(async (turn: PlanRevisionTurnProjection, sections: string[]) => {
    if (sections.length === 0) return null;
    setBusy(true);
    try {
      const result = await getBridge().invokeAction<PlanRevisionApplyOutput>('apply-plan-revision-turn', { session, turnId: turn.turnId, sections, previewAcknowledged: true, confirmApply: true });
      setLastApplyByTurn((prev) => ({ ...prev, [turn.turnId]: result }));
      if (result.kind === 'applied') {
        onApply({ plan: result.plan, readiness: result.readiness });
        await onRefresh();
        await reload({ includePlan: true });
        toast.push('Applied selected plan revisions.', 'success');
      } else {
        toast.push(result.message, 'error');
      }
      return result;
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }, [onApply, onRefresh, reload, session, toast]);

  const hasRunningTurn = hasRunningRevisionTurn(revisionSession?.turns ?? []);

  React.useEffect(() => {
    if (!initialized || !hasRunningTurn) return undefined;
    const id = window.setInterval(() => { void reload(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [hasRunningTurn, initialized, reload]);

  return { revisionSession, loading, busy, initialized, lastApplyByTurn, hasRunningTurn, ensureSession, reload, submit, cancel, retry, redraft, apply };
}

export type PlanRevisionSessionApi = ReturnType<typeof usePlanRevisionSession>;
