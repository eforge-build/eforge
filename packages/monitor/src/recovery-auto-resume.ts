import { access, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { loadQueue } from '@eforge-build/engine/prd-queue';
import { applyRecoveryContinueRepair, RecoveryApplyConflictError, type ApplyHelperOptions } from '@eforge-build/engine/recovery/apply';
import { preflightRequeueFailedPrdForCompiledResume } from '@eforge-build/engine/queue/resume-cascade';
import { readRecoverySidecarProjection } from '@eforge-build/engine/recovery/sidecar-read';
import { readRawAppliedAction } from '@eforge-build/engine/recovery/applied-sidecar';
import { projectResumeEligibility } from '@eforge-build/engine/resume/compiled-build';
import { computeWorktreeBase } from '@eforge-build/engine/worktree-ops';
import { buildQueueDispatchPolicyGateContext, executePolicyGate } from '@eforge-build/engine/extensions/policy-gate-runtime';
import type { EforgeEvent } from '@eforge-build/client';
import type { MonitorContext } from './context.js';
import { writeDaemonEvent } from './daemon-events.js';

const execFileAsync = promisify(execFile);

type RecoveryAutoResumeEvaluateEvent = Extract<EforgeEvent, { type: 'recovery:auto-resume:evaluate' }>;
type RecoveryAutoResumeQueuedEvent = Extract<EforgeEvent, { type: 'recovery:auto-resume:queued' }>;
type RecoveryAutoResumeStoppedEvent = Extract<EforgeEvent, { type: 'recovery:auto-resume:stopped' }>;
type RecoveryAutoResumeAuditEvent = RecoveryAutoResumeEvaluateEvent | RecoveryAutoResumeQueuedEvent | RecoveryAutoResumeStoppedEvent;
type RecoveryAutoResumeAuditEventInput = Omit<RecoveryAutoResumeEvaluateEvent, 'timestamp'> | Omit<RecoveryAutoResumeQueuedEvent, 'timestamp'> | Omit<RecoveryAutoResumeStoppedEvent, 'timestamp'>;

export type RecoveryAutoResumeStopReason = RecoveryAutoResumeStoppedEvent['reason'];

export type RecoveryAutoResumeOutcome =
  | { status: 'queued'; attempt: number; detail: string }
  | { status: 'stopped'; reason: RecoveryAutoResumeStopReason; message?: string; attempt: number }
  | { status: 'skipped-default-off' };

interface AutoResumeState {
  attempts?: number;
  lastFailureSignature?: string;
  lastProgressMarker?: string;
  lastAttemptAt?: string;
  stoppedReason?: RecoveryAutoResumeStopReason;
  stoppedAt?: string;
}

interface SidecarWithAutoResume {
  autoResume?: AutoResumeState;
  [key: string]: unknown;
}

// --- eforge:region evaluator ---
export async function evaluateGuardedRecoveryAutoResume(
  context: MonitorContext,
  prdId: string,
): Promise<RecoveryAutoResumeOutcome> {
  const policy = context.options.config?.recovery?.autoResume ?? DEFAULT_CONFIG.recovery.autoResume;
  if (!policy.enabled) return { status: 'skipped-default-off' };

  const maxAttempts = policy.maxAttempts;
  const queueDir = context.queuePaths?.queueDir ?? (context.cwd ? resolve(context.cwd, context.options.config?.prdQueue?.dir ?? context.options.queueDir ?? '.eforge/queue') : undefined);
  const setNameFallback = prdId;
  const sidecarJsonPath = queueDir ? join(queueDir, 'failed', `${prdId}.recovery.json`) : undefined;

  let setName = setNameFallback;
  let rawSidecar: SidecarWithAutoResume;
  let state: AutoResumeState;
  let projection: Awaited<ReturnType<typeof readRecoverySidecarProjection>>;
  try {
    if (!context.cwd || !queueDir || !sidecarJsonPath) {
      return stop(context, { prdId, setName, reason: 'error', attempt: 0, maxAttempts, message: 'Working directory or queue directory is not configured.' });
    }
    try {
      rawSidecar = await readRawSidecar(sidecarJsonPath);
      state = readAutoResumeState(rawSidecar);
      projection = await readRecoverySidecarProjection(join(queueDir, 'failed'), prdId);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw err;
      throw new SidecarReadError(err);
    }
    setName = projection.sidecar.setName;
    const attempt = state.attempts ?? 0;
    emit(context, { type: 'recovery:auto-resume:evaluate', prdId, setName, enabled: true, attempt, maxAttempts });

    if (attempt >= maxAttempts) return stop(context, { prdId, setName, reason: 'attempt-budget-exhausted', attempt, maxAttempts });
    if (projection.verdict.verdict !== 'continue-repair') {
      const manualVerdicts = new Set(['manual', 'retry', 'abandon']);
      return stop(context, { prdId, setName, reason: manualVerdicts.has(projection.verdict.verdict) ? 'manual-confirmation-required' : 'not-continue-repair', attempt, maxAttempts });
    }
    if (projection.verdict.confidence !== 'high') return stop(context, { prdId, setName, reason: 'not-high-confidence', attempt, maxAttempts });
    if (projection.verdict.partial === true || projection.summary.partial === true || projection.sidecar.boundedEvidence.identity.partial === true) return stop(context, { prdId, setName, reason: 'partial-sidecar', attempt, maxAttempts });
    const eligibility = projection.sidecar.continueRepairEligibility;
    if (!eligibility) return stop(context, { prdId, setName, reason: 'not-eligible', attempt, maxAttempts, message: 'Recovery sidecar does not contain continue-and-repair artifact eligibility.' });
    if (eligibility.eligible !== true) return stop(context, { prdId, setName, reason: 'ineligible-artifacts', attempt, maxAttempts, message: eligibility.reason });
    if (eligibility.partial === true) return stop(context, { prdId, setName, reason: 'partial-sidecar', attempt, maxAttempts });

    const appliedAction = await readRawAppliedAction(sidecarJsonPath);
    if (appliedAction !== undefined && appliedAction !== 'continue-repair') return stop(context, { prdId, setName, reason: 'conflicting-applied-marker', attempt, maxAttempts });

    const autoBuildBlocker = autoBuildPausePreflight(context);
    if (autoBuildBlocker) return stop(context, { prdId, setName, reason: 'active-gate-or-hold', attempt, maxAttempts, message: autoBuildBlocker });

    const worktreeBlocker = await worktreePreflight(context.cwd, queueDir);
    if (worktreeBlocker) return stop(context, { prdId, setName, reason: worktreeBlocker.reason, attempt, maxAttempts, message: worktreeBlocker.message });
    const queueBlocker = await queuePreflight(context.cwd, queueDir, prdId, appliedAction);
    if (queueBlocker) return stop(context, { prdId, setName, reason: queueBlocker.reason, attempt, maxAttempts, message: queueBlocker.message });

    const policyBlocker = await policyGatePreflight(context, prdId, projection.sidecar, maxAttempts);
    if (policyBlocker) return stop(context, { prdId, setName, reason: 'active-gate-or-hold', attempt, maxAttempts, message: policyBlocker });

    const progressMarker = buildProgressMarker(projection.sidecar.boundedEvidence);
    const failureSignature = buildFailureSignature(projection.sidecar.boundedEvidence);
    if (attempt > 0) {
      if (!hasValidPriorMarkers(state)) return stop(context, { prdId, setName, reason: 'malformed-sidecar', attempt, maxAttempts, message: 'Prior auto-resume markers are missing or malformed.' });
      if (state.lastProgressMarker === progressMarker && state.lastFailureSignature === failureSignature) {
        return stop(context, { prdId, setName, reason: 'repeated-failure-signature', attempt, maxAttempts });
      }
    }

    const compiledEligibilityBlocker = await compiledResumeEligibilityPreflight(context, prdId, setName, projection);
    if (compiledEligibilityBlocker) return stop(context, { prdId, setName, reason: 'ineligible-artifacts', attempt, maxAttempts, message: compiledEligibilityBlocker });

    const transitionBlocker = await queueTransitionPreflight(context, prdId, queueDir, setName, projection);
    if (transitionBlocker) return stop(context, { prdId, setName, reason: 'queue-preflight-blocked', attempt, maxAttempts, message: transitionBlocker });

    const inactiveMessage = 'Auto-build watcher is no longer active.';
    if (context.isActiveController?.() === false) return stop(context, { prdId, setName, reason: 'active-gate-or-hold', attempt, maxAttempts, message: inactiveMessage });

    const nextAttempt = attempt + 1;
    await writeAutoResumeState(sidecarJsonPath, rawSidecar, {
      attempts: nextAttempt,
      lastFailureSignature: failureSignature,
      lastProgressMarker: progressMarker,
      lastAttemptAt: new Date().toISOString(),
    });
    if (context.isActiveController?.() === false) return stop(context, { prdId, setName, reason: 'active-gate-or-hold', attempt, maxAttempts, message: inactiveMessage });
    const result = await applyRecoveryContinueRepair(helperOptions(context, prdId, queueDir));
    context.notifyQueueMutation('apply-recovery');
    emit(context, { type: 'recovery:auto-resume:queued', prdId, setName, action: 'continue-repair', attempt: nextAttempt, maxAttempts });
    return { status: 'queued', attempt: nextAttempt, detail: result.detail };
  } catch (err) {
    const attempt = sidecarJsonPath ? readAutoResumeState(await tryReadRawSidecar(sidecarJsonPath)).attempts ?? 0 : 0;
    const reason = classifyError(err);
    return stop(context, { prdId, setName, reason, attempt, maxAttempts, message: err instanceof Error ? err.message : String(err) });
  }
}

// --- eforge:endregion evaluator ---

// --- eforge:region sidecar-state-helpers ---
function helperOptions(context: MonitorContext, prdId: string, queueDir: string): ApplyHelperOptions {
  if (!context.cwd) throw new Error('Working directory not configured');
  return {
    cwd: context.cwd,
    prdId,
    queueDir,
    outputDir: context.options.config?.plan?.outputDir ?? context.options.planOutputDir ?? 'eforge/plans',
    dbPath: resolve(context.cwd, '.eforge', 'monitor.db'),
    ...(context.options.config?.build?.trunkBranch !== undefined ? { trunkBranch: context.options.config.build.trunkBranch } : {}),
  };
}

async function stop(context: MonitorContext, options: { prdId: string; setName: string; reason: RecoveryAutoResumeStopReason; attempt: number; maxAttempts: number; message?: string }): Promise<RecoveryAutoResumeOutcome> {
  emit(context, {
    type: 'recovery:auto-resume:stopped',
    prdId: options.prdId,
    setName: options.setName,
    reason: options.reason,
    attempt: options.attempt,
    maxAttempts: options.maxAttempts,
    ...(options.message !== undefined ? { message: options.message } : {}),
  });
  return { status: 'stopped', reason: options.reason, attempt: options.attempt, ...(options.message !== undefined ? { message: options.message } : {}) };
}

function emit(context: MonitorContext, event: RecoveryAutoResumeAuditEventInput): void {
  writeDaemonEvent(context.db, event, context.daemonSessionId);
}

async function readRawSidecar(path: string): Promise<SidecarWithAutoResume> {
  const parsed = JSON.parse(await readFile(path, 'utf-8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Recovery sidecar JSON is invalid');
  return parsed as SidecarWithAutoResume;
}

async function tryReadRawSidecar(path: string): Promise<SidecarWithAutoResume> {
  try { return await readRawSidecar(path); } catch { return {}; }
}

function readAutoResumeState(sidecar: SidecarWithAutoResume): AutoResumeState {
  const state = sidecar.autoResume;
  if (typeof state !== 'object' || state === null) return {};
  const raw = state as AutoResumeState;
  const attempts = typeof raw.attempts === 'number' && Number.isInteger(raw.attempts) && raw.attempts >= 0 ? raw.attempts : 0;
  return {
    ...raw,
    attempts,
    ...(typeof raw.lastFailureSignature === 'string' ? { lastFailureSignature: raw.lastFailureSignature } : {}),
    ...(typeof raw.lastProgressMarker === 'string' ? { lastProgressMarker: raw.lastProgressMarker } : {}),
    ...(typeof raw.lastAttemptAt === 'string' ? { lastAttemptAt: raw.lastAttemptAt } : {}),
  };
}

function hasValidPriorMarkers(state: AutoResumeState): boolean {
  return typeof state.lastProgressMarker === 'string' && state.lastProgressMarker.length > 0
    && typeof state.lastFailureSignature === 'string' && state.lastFailureSignature.length > 0;
}

async function writeAutoResumeState(path: string, sidecar: SidecarWithAutoResume, state: AutoResumeState): Promise<void> {
  sidecar.autoResume = state;
  const tmp = `${path}.auto-resume.${process.pid}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tmp, 'wx');
    await handle.writeFile(`${JSON.stringify(sidecar, null, 2)}\n`, 'utf-8');
    await handle.close();
    handle = undefined;
    await rename(tmp, path);
  } catch (err) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

// --- eforge:endregion sidecar-state-helpers ---

// --- eforge:region preflight-helpers ---
function autoBuildPausePreflight(context: MonitorContext): string | undefined {
  const snapshot = context.options.daemonState?.autoBuildController.getSnapshot?.();
  if (!snapshot) return undefined;
  if (snapshot.mode === 'paused' || snapshot.scheduler?.paused === true) return 'Auto-build scheduler is paused.';
  return undefined;
}

async function policyGatePreflight(context: MonitorContext, prdId: string, sidecar: { setName: string; verdict?: unknown; boundedEvidence?: { identity?: { featureBranch?: string; baseBranch?: string } }; continueRepairEligibility?: unknown }, maxAttempts: number): Promise<string | undefined> {
  const policyGates = context.options.nativeExtensionRegistry?.policyGates;
  if (!policyGates?.some((registration) => registration.gateKind === 'queue-dispatch')) return undefined;
  if (!context.cwd) return 'Working directory is not configured for policy gates.';
  const failedPrds = await loadQueue(join(context.queuePaths?.queueDir ?? resolve(context.cwd, context.options.config?.prdQueue?.dir ?? context.options.queueDir ?? '.eforge/queue'), 'failed'), context.cwd);
  const failedPrd = failedPrds.find((prd) => prd.id === prdId);
  const result = await executePolicyGate({
    registry: { policyGates },
    gateKind: 'queue-dispatch',
    context: buildQueueDispatchPolicyGateContext({
      prdId,
      prdTitle: failedPrd?.frontmatter.title,
      priority: failedPrd?.frontmatter.priority,
      profile: failedPrd?.frontmatter.profile,
      dependsOn: failedPrd?.frontmatter.depends_on ?? [],
      continueRepair: {
        mode: 'compiled',
        sourcePrdId: prdId,
        setName: sidecar.setName,
        featureBranch: sidecar.boundedEvidence?.identity?.featureBranch ?? '',
        baseBranch: sidecar.boundedEvidence?.identity?.baseBranch ?? '',
      },
    }, { cwd: context.cwd, configDir: context.options.nativeExtensionConfigDir ?? context.options.configDir ?? resolve(context.cwd, '.eforge') }),
    timeoutMs: context.options.config?.extensions?.policyGateTimeoutMs ?? 5_000,
    failurePolicy: context.options.config?.extensions?.policyGateFailurePolicy ?? 'fail-closed',
  });
  for (const event of result.events) writeDaemonEvent(context.db, event, context.daemonSessionId);
  return result.blocked ? result.decision.reason ?? 'Queue dispatch blocked by policy gate.' : undefined;
}

async function compiledResumeEligibilityPreflight(
  context: MonitorContext,
  prdId: string,
  setName: string,
  projection: Awaited<ReturnType<typeof readRecoverySidecarProjection>>,
): Promise<string | undefined> {
  if (!context.cwd) return 'Working directory is not configured.';
  const identity = projection.sidecar.boundedEvidence.identity;
  const eligibility = await projectResumeEligibility({
    cwd: context.cwd,
    setName,
    prdId,
    mergeWorktreePath: join(computeWorktreeBase(context.cwd, setName), '__merge__'),
    outputDir: context.options.config?.plan?.outputDir ?? context.options.planOutputDir ?? 'eforge/plans',
    ...(context.options.config?.build?.trunkBranch !== undefined ? { trunkBranch: context.options.config.build.trunkBranch } : {}),
    dbPath: resolve(context.cwd, '.eforge', 'monitor.db'),
    featureBranch: identity.featureBranch,
    baseBranch: identity.baseBranch,
    failureSummary: projection.summary,
  });
  return eligibility.eligible ? undefined : eligibility.reason;
}

async function queuePreflight(cwd: string, queueDir: string, prdId: string, appliedAction: string | undefined): Promise<{ reason: 'queue-preflight-blocked' | 'active-gate-or-hold'; message: string } | undefined> {
  const failed = await loadQueue(join(queueDir, 'failed'), cwd);
  const failedPrd = failed.find((prd) => prd.id === prdId);
  if (failedPrd?.frontmatter.held === true) return { reason: 'active-gate-or-hold', message: `Failed PRD ${prdId} is held.` };
  if (await exists(join(queueDir, `${prdId}.md`)) && appliedAction !== 'continue-repair') {
    return { reason: 'queue-preflight-blocked', message: `Queue root already contains ${prdId}.md.` };
  }
  if (!await exists(join(queueDir, 'failed', `${prdId}.md`)) && appliedAction !== 'continue-repair') {
    return { reason: 'queue-preflight-blocked', message: `No failed queue PRD found for ${prdId}.` };
  }
  return undefined;
}

async function queueTransitionPreflight(
  context: MonitorContext,
  prdId: string,
  queueDir: string,
  setName: string,
  projection: Awaited<ReturnType<typeof readRecoverySidecarProjection>>,
): Promise<string | undefined> {
  if (!context.cwd) return 'Working directory is not configured.';
  const identity = projection.sidecar.boundedEvidence.identity;
  const result = await preflightRequeueFailedPrdForCompiledResume({
    cwd: context.cwd,
    prdId,
    queueDir,
    setName,
    featureBranch: identity.featureBranch,
    baseBranch: identity.baseBranch,
  });
  return result.status === 'blocked' ? result.reason : undefined;
}

async function worktreePreflight(cwd: string, queueDir: string): Promise<{ reason: 'dirty-worktree' | 'conflicting-worktree'; message: string } | undefined> {
  const unmerged = await execFileAsync('git', ['ls-files', '-u'], { cwd });
  if (unmerged.stdout.trim().length > 0) return { reason: 'conflicting-worktree', message: 'Worktree has unmerged/conflicting paths.' };
  const status = await execFileAsync('git', ['status', '--porcelain', '-z'], { cwd, encoding: 'buffer' });
  const dirty = parsePorcelainZPaths(status.stdout).filter((path) => !isAllowedFailedSidecarPath(path, cwd, queueDir));
  if (dirty.length > 0) return { reason: 'dirty-worktree', message: 'Worktree has uncommitted changes outside the failed recovery sidecar.' };
  return undefined;
}

function parsePorcelainZPaths(output: Buffer): string[] {
  const entries = output.toString('utf-8').split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? '';
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (entry[0] === 'R' || entry[1] === 'R' || entry[0] === 'C' || entry[1] === 'C') {
      const original = entries[++i];
      if (original) paths.push(original);
    }
  }
  return paths;
}

function isAllowedFailedSidecarPath(path: string, cwd: string, queueDir: string): boolean {
  const relativeQueueDir = resolve(cwd, queueDir).slice(resolve(cwd).length + 1).replaceAll('\\\\', '/');
  return new RegExp(`^${escapeRegExp(relativeQueueDir)}/failed/[^/]+\\.(?:md|recovery\\.json|recovery\\.md)$`).test(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// --- eforge:endregion preflight-helpers ---

// --- eforge:region signature-helpers ---
function buildProgressMarker(evidence: SidecarWithAutoResume['boundedEvidence']): string {
  const record = evidence as { landedCommits?: Array<{ sha?: string }>; diffStat?: string } | undefined;
  const commits = record?.landedCommits?.map((commit) => commit.sha ?? '').filter(Boolean).join(',') ?? '';
  return JSON.stringify({ commits, diffStat: record?.diffStat ?? '' });
}

function buildFailureSignature(evidence: SidecarWithAutoResume['boundedEvidence']): string {
  const record = evidence as { failingPlan?: StableFailure; failingPlans?: StableFailure[]; terminalFailure?: StableTerminalFailure } | undefined;
  const failures = (record?.failingPlans ?? (record?.failingPlan ? [record.failingPlan] : [])).map(stableFailure);
  const terminal = record?.terminalFailure;
  return JSON.stringify({
    failures,
    terminalFailure: terminal ? {
      stage: terminal.stage,
      scope: terminal.scope,
      subtype: terminal.subtype ?? terminal.terminalSubtype,
      sourceEventType: terminal.sourceEventType ?? terminal.sourceEvent?.type,
      message: terminal.message ?? terminal.errorMessage,
    } : null,
  });
}

interface StableFailure {
  planId?: string;
  stage?: string;
  scope?: string;
  errorMessage?: string;
  message?: string;
  terminalSubtype?: string;
  subtype?: string;
}

interface StableTerminalFailure extends StableFailure {
  sourceEventType?: string;
  sourceEvent?: { type?: string };
}

function stableFailure(failure: StableFailure): StableFailure {
  return {
    planId: failure.planId,
    stage: failure.stage,
    scope: failure.scope,
    terminalSubtype: failure.terminalSubtype ?? failure.subtype,
    errorMessage: failure.errorMessage ?? failure.message,
  };
}

// --- eforge:endregion signature-helpers ---

class SidecarReadError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

function classifyError(err: unknown): RecoveryAutoResumeStopReason {
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing-sidecar';
  if (err instanceof SidecarReadError || err instanceof SyntaxError) return 'malformed-sidecar';
  if (err instanceof RecoveryApplyConflictError) {
    if (/applied marker|already applied/i.test(err.message)) return 'conflicting-applied-marker';
    if (/policy gate|approval|hold|held/i.test(err.message)) return 'active-gate-or-hold';
    if (/eligible|artifact/i.test(err.message)) return 'ineligible-artifacts';
    return 'queue-preflight-blocked';
  }
  if (err instanceof Error && /sidecar/i.test(err.message)) return 'malformed-sidecar';
  return 'error';
}
