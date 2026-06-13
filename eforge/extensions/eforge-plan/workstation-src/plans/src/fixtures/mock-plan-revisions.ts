import type { JsonObject, PlanData, PlanRevisionApplyOutput, PlanRevisionSessionProjection, PlanRevisionTurnProjection, PlanningAgentTaskRecord, Readiness } from '@/types';
import { mockMutationResult } from './mock-data';

const HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TARGET_SESSION = '2026-06-07-import-preview';
const TASK_KIND = 'eforge-plan.planning-draft';

const basePlan: PlanData = {
  session: TARGET_SESSION,
  topic: 'Add import preview',
  status: 'planning',
  planning_type: 'feature',
  planning_depth: 'focused',
  sections: {
    scope: 'Add a bounded import preview flow that shows generated changes before writing.',
    'acceptance criteria': '- Preview renders without writing files.\n- Apply requires explicit user action.',
  },
};
const baseReadiness: Readiness = { ready: false, missingDimensions: [], coveredDimensions: ['scope', 'acceptance-criteria'], skippedDimensions: [] };

function completedTask(taskId: string, resultPatch: Partial<NonNullable<PlanningAgentTaskRecord['result']>>): PlanningAgentTaskRecord {
  return { taskId, kind: TASK_KIND, status: 'completed', createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:00:05.000Z', startedAt: '2026-06-07T00:00:01.000Z', completedAt: '2026-06-07T00:00:05.000Z', result: { summary: 'Revision complete.', assumptionsOpenQuestions: [], ...resultPatch } };
}

function turn(patch: Partial<PlanRevisionTurnProjection> & Pick<PlanRevisionTurnProjection, 'turnId' | 'taskId' | 'userMessage' | 'createdAt'>): PlanRevisionTurnProjection {
  return { basePlanFingerprint: HASH, baseSectionHashes: [{ dimension: 'scope', sha256: HASH }], available: true, ...patch };
}

const answerTurn = turn({ turnId: 'turn-answer-only', taskId: 'task-revision-answer', userMessage: 'Why is this scope bounded?', createdAt: '2026-06-07T00:01:00.000Z', task: completedTask('task-revision-answer', { planRevisionTurn: { schemaVersion: 1, targetSession: TARGET_SESSION, assistantMessage: 'The scope is bounded to keep import preview safe and shippable.', basePlanFingerprint: HASH, noPatchReason: 'User asked a question only.' } }) });
const patchTurn = turn({ turnId: 'turn-patch', taskId: 'task-revision-patch', userMessage: 'Tighten scope and acceptance criteria.', createdAt: '2026-06-07T00:02:00.000Z', task: completedTask('task-revision-patch', { planRevisionTurn: { schemaVersion: 1, targetSession: TARGET_SESSION, assistantMessage: 'I drafted a targeted patch for the plan sections.', basePlanFingerprint: HASH, applyGuidance: 'Apply sections after previewing current content.', citations: [{ label: 'current-plan', excerpt: 'bounded import preview' }], proposedPatch: { sections: [{ dimension: 'scope', content: 'Deliver a read-only import preview that lists generated file and backlog changes before any write.', rationale: 'Narrows the work to visible preview behavior.' }, { dimension: 'acceptance-criteria', content: '- Preview lists generated changes without writing files.\n- Apply requires an explicit confirmation.\n- Cancelling leaves the repository unchanged.', rationale: 'Makes the no-write contract testable.' }], metadata: { openQuestions: ['Should preview include generated PRD text?'] }, skippedDimensions: [{ dimension: 'assumptions-and-validation', reason: 'No safe change requested.' }] } } }) });
const needsInputTurn = turn({ turnId: 'turn-needs-input', taskId: 'task-revision-needs-input', userMessage: 'Rewrite the whole plan.', createdAt: '2026-06-07T00:04:00.000Z', task: completedTask('task-revision-needs-input', { decision: 'needs-input', rationale: 'The requested revision is too broad for a safe patch.', clarificationQuestions: [{ question: 'Which section should be changed first?', why: 'Keeps the revision bounded.' }, { question: 'Should acceptance criteria become stricter?' }] }) });
const failedTurn = turn({ turnId: 'turn-failed', taskId: 'task-revision-failed', userMessage: 'Try and fail.', createdAt: '2026-06-07T00:05:00.000Z', task: { taskId: 'task-revision-failed', kind: TASK_KIND, status: 'failed', createdAt: '2026-06-07T00:05:00.000Z', updatedAt: '2026-06-07T00:05:02.000Z', errorMessage: 'Mock revision failed.' } });
const appliedTurn = turn({ ...patchTurn, turnId: 'turn-applied', taskId: 'task-revision-applied', userMessage: 'Already applied.', createdAt: '2026-06-07T00:06:00.000Z', appliedSections: ['scope'], appliedAt: '2026-06-07T00:07:00.000Z', task: completedTask('task-revision-applied', { planRevisionTurn: patchTurn.task?.result?.planRevisionTurn }) });

const sessions = new Map<string, PlanRevisionSessionProjection>();

function seed(session: string): PlanRevisionSessionProjection {
  const existing = sessions.get(session);
  if (existing) return existing;
  const created: PlanRevisionSessionProjection = { threadId: `thread-${session}`, targetSession: session, createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:06:00.000Z', path: `.eforge/session-plans/${session}.md`, plan: basePlan, readiness: baseReadiness, turns: [appliedTurn, failedTurn, needsInputTurn, patchTurn, answerTurn] };
  sessions.set(session, created);
  return created;
}

export function startOrResumeMockPlanRevisionSession(input: JsonObject): PlanRevisionSessionProjection { return seed(String(input.session ?? TARGET_SESSION)); }
export function listMockPlanRevisionSessions(): { sessions: PlanRevisionSessionProjection[]; total: number; limit: number; offset: number } {
  const all = [...sessions.values(), seed(TARGET_SESSION)];
  return { sessions: all, total: all.length, limit: 50, offset: 0 };
}
export function getMockPlanRevisionSession(input: JsonObject): PlanRevisionSessionProjection { return seed(String(input.session ?? TARGET_SESSION)); }

export function startMockPlanRevisionTurn(input: JsonObject) {
  const session = seed(String(input.session ?? TARGET_SESSION));
  const now = new Date().toISOString();
  const newTurn = turn({ turnId: `turn-dynamic-${session.turns.length}`, taskId: `task-dynamic-${session.turns.length}`, userMessage: String(input.message ?? ''), createdAt: now, task: completedTask(`task-dynamic-${session.turns.length}`, { planRevisionTurn: { schemaVersion: 1, targetSession: session.targetSession, assistantMessage: `Mock answer for: ${String(input.message ?? '')}`, basePlanFingerprint: HASH, noPatchReason: 'Mock dynamic answer-only turn.' } }) });
  session.turns = [newTurn, ...session.turns];
  session.updatedAt = now;
  return { session, task: newTurn.task, turn: newTurn };
}

export function retryMockPlanRevisionTurn(input: JsonObject) {
  return startMockPlanRevisionTurn({ session: input.session, message: input.answers ? 'Redraft from clarification answers.' : `Retry ${String(input.turnId ?? input.taskId ?? '')}` });
}

export function cancelMockPlanRevisionTurn(input: JsonObject): PlanRevisionSessionProjection {
  const session = seed(String(input.session ?? TARGET_SESSION));
  session.turns = session.turns.map((entry) => entry.turnId === input.turnId ? { ...entry, task: entry.task ? { ...entry.task, status: 'cancelled', errorMessage: 'Cancelled in mock bridge.' } : entry.task } : entry);
  return session;
}

export function applyMockPlanRevisionTurn(input: JsonObject): PlanRevisionApplyOutput {
  const session = seed(String(input.session ?? TARGET_SESSION));
  const target = session.turns.find((entry) => entry.turnId === input.turnId || entry.taskId === input.taskId);
  if (!target || target.turnId === 'turn-answer-only' || target.turnId === 'turn-needs-input') return { kind: 'not-applicable', session: session.targetSession, turnId: String(input.turnId ?? ''), message: 'This turn has no section patch.' };
  const patchDimensions = (target.task?.result?.planRevisionTurn?.proposedPatch?.sections ?? []).map((section) => section.dimension);
  target.appliedSections = Array.from(new Set([...(target.appliedSections ?? []), ...patchDimensions])).sort();
  target.appliedAt = '2026-06-07T00:08:00.000Z';
  const mutation = mockMutationResult(session.targetSession) as { plan?: PlanData; readiness?: Readiness };
  return { kind: 'applied', session: session.targetSession, turnId: target.turnId, taskId: target.taskId, appliedSections: patchDimensions, plan: mutation.plan ?? basePlan, readiness: mutation.readiness ?? baseReadiness, message: 'Applied plan revision sections.' };
}
