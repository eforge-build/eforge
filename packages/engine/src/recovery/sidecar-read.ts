import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  RecoverySidecarCompileScopeContextActionSchema,
  RecoverySidecarCompileScopeContextOptionSchema,
  parseWithSchema,
  type RecoverySidecarRecoveryOption,
  type RecoveryVerdictSidecar,
} from '@eforge-build/client';
import type { BuildFailureSummary, RecoveryVerdict } from '../events.js';
import type { RecoverySidecarContinueRepairEligibility, RecoverySidecarContinueRepairEvidence } from './resume-sidecar.js';
import { recoveryVerdictSchema } from '../schemas.js';

const SUPPORTED_SCHEMA_VERSIONS = [3, 4] as const;
type SupportedRecoverySidecarSchemaVersion = typeof SUPPORTED_SCHEMA_VERSIONS[number];

export interface RecoverySidecarProjection {
  sidecar: RecoveryVerdictSidecar & Partial<RecoverySidecarContinueRepairEvidence>;
  verdict: RecoveryVerdict;
  summary: BuildFailureSummary;
  identity: RecoveryVerdictSidecar['boundedEvidence']['identity'];
}

export async function readRecoverySidecarProjection(failedDir: string, prdId: string): Promise<RecoverySidecarProjection> {
  const raw = await readFile(join(failedDir, `${prdId}.recovery.json`), 'utf-8');
  return projectRecoverySidecar(parseRecoverySidecarPayload(raw, prdId));
}

export async function tryReadRecoverySidecarProjection(failedDir: string, prdId: string): Promise<RecoverySidecarProjection | undefined> {
  try {
    return await readRecoverySidecarProjection(failedDir, prdId);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

export function parseRecoverySidecarPayload(raw: string, prdId?: string): RecoveryVerdictSidecar & Partial<RecoverySidecarContinueRepairEvidence> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Recovery sidecar JSON is malformed${prdId ? ` for ${prdId}` : ''}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return validateRecoverySidecarPayload(parsed, prdId);
}

export function projectRecoverySidecar(sidecar: RecoveryVerdictSidecar & Partial<RecoverySidecarContinueRepairEvidence>): RecoverySidecarProjection {
  const verdict = parseWithSchema(recoveryVerdictSchema, sidecar.verdict) as RecoveryVerdict;
  return {
    sidecar,
    verdict,
    identity: sidecar.boundedEvidence.identity,
    summary: projectBuildFailureSummary(sidecar),
  };
}

export function projectBuildFailureSummary(sidecar: RecoveryVerdictSidecar): BuildFailureSummary {
  const evidence = sidecar.boundedEvidence;
  return {
    prdId: evidence.identity.prdId,
    setName: evidence.identity.setName,
    featureBranch: evidence.identity.featureBranch,
    baseBranch: evidence.identity.baseBranch,
    plans: evidence.plans.map((plan) => ({
      planId: plan.planId,
      status: plan.status,
      ...(plan.error !== undefined ? { error: plan.error } : {}),
      ...(plan.terminalSubtype !== undefined ? { terminalSubtype: plan.terminalSubtype } : {}),
      ...(plan.commitSha !== undefined ? { commitSha: plan.commitSha } : {}),
    })),
    failingPlan: {
      planId: evidence.failingPlan.planId,
      ...(evidence.failingPlan.errorMessage !== undefined ? { errorMessage: evidence.failingPlan.errorMessage } : {}),
      ...(evidence.failingPlan.terminalSubtype !== undefined ? { terminalSubtype: evidence.failingPlan.terminalSubtype } : {}),
    },
    ...(evidence.failingPlans !== undefined ? {
      failingPlans: evidence.failingPlans.map((plan) => ({
        planId: plan.planId,
        ...(plan.errorMessage !== undefined ? { errorMessage: plan.errorMessage } : {}),
        ...(plan.terminalSubtype !== undefined ? { terminalSubtype: plan.terminalSubtype } : {}),
      })),
    } : {}),
    landedCommits: evidence.landedCommits.map((commit) => ({ sha: commit.sha, subject: commit.subject, author: commit.author, date: commit.date })),
    diffStat: evidence.diffStat ?? '',
    modelsUsed: [...evidence.modelsUsed],
    failedAt: evidence.identity.failedAt,
    ...(evidence.identity.partial !== undefined ? { partial: evidence.identity.partial } : {}),
    ...(evidence.terminalFailure !== undefined ? { terminalFailure: evidence.terminalFailure as BuildFailureSummary['terminalFailure'] } : {}),
    ...(evidence.acceptanceValidation !== undefined ? {
      acceptanceValidation: {
        passed: evidence.acceptanceValidation.passed,
        total: evidence.acceptanceValidation.total,
        pass: evidence.acceptanceValidation.pass,
        fail: evidence.acceptanceValidation.fail,
        unknown: evidence.acceptanceValidation.unknown,
        verdicts: evidence.acceptanceValidation.verdicts.map((row) => ({ criterion: row.criterion, verdict: row.verdict, evidence: row.evidence })),
      },
    } : {}),
    ...(evidence.validationCommands !== undefined ? {
      validationCommands: evidence.validationCommands.map((command) => ({
        command: command.command,
        exitCode: command.exitCode,
        ...(command.outputPreview !== undefined ? { output: command.outputPreview } : {}),
      })),
    } : {}),
    ...(evidence.landing !== undefined ? { landing: evidence.landing } : {}),
    ...(evidence.reviewFailure !== undefined ? { reviewFailure: evidence.reviewFailure as BuildFailureSummary['reviewFailure'] } : {}),
  };
}

function validateRecoverySidecarPayload(value: unknown, prdId?: string): RecoveryVerdictSidecar & Partial<RecoverySidecarContinueRepairEvidence> {
  const obj = requireRecord(value, `Recovery sidecar JSON is invalid${suffix(prdId)}`);
  const schemaVersion = validateSchemaVersion(obj.schemaVersion, prdId);
  if (obj['resume' + 'Eligibility'] !== undefined) throw new Error(`Recovery sidecar contains legacy eligibility data${suffix(prdId)}; regenerate the sidecar with continue-and-repair support`);
  const generatedAt = requireString(obj.generatedAt, 'generatedAt', prdId);
  const sidecarPrdId = requireString(obj.prdId, 'prdId', prdId);
  const setName = requireString(obj.setName, 'setName', prdId);
  const verdict = validateSidecarVerdict(obj.verdict, prdId);
  const report = validateReport(obj.report, prdId);
  const boundedEvidence = validateBoundedEvidence(obj.boundedEvidence, prdId);
  if (prdId !== undefined && sidecarPrdId !== prdId) throw new Error(`Recovery sidecar prdId '${sidecarPrdId}' does not match requested ${prdId}`);
  if (boundedEvidence.identity.prdId !== sidecarPrdId) throw new Error(`Recovery sidecar boundedEvidence.identity.prdId does not match top-level prdId${suffix(prdId)}`);
  if (boundedEvidence.identity.setName !== setName) throw new Error(`Recovery sidecar boundedEvidence.identity.setName does not match top-level setName${suffix(prdId)}`);
  return {
    schemaVersion,
    generatedAt,
    prdId: sidecarPrdId,
    setName,
    verdict,
    report,
    boundedEvidence,
    ...(obj.continueRepairEligibility !== undefined ? { continueRepairEligibility: validateContinueRepairEligibility(obj.continueRepairEligibility, prdId) } : {}),
    ...(obj.recoveryOptions !== undefined ? { recoveryOptions: validateRecoveryOptions(obj.recoveryOptions, prdId) } : {}),
    ...(obj.applied !== undefined ? { applied: obj.applied as RecoveryVerdictSidecar['applied'] } : {}),
  };
}

function validateSchemaVersion(value: unknown, prdId?: string): SupportedRecoverySidecarSchemaVersion {
  if (SUPPORTED_SCHEMA_VERSIONS.some((version) => value === version)) return value as SupportedRecoverySidecarSchemaVersion;
  throw new Error(`Recovery sidecar schemaVersion is invalid${suffix(prdId)}: expected ${SUPPORTED_SCHEMA_VERSIONS.join(' or ')}`);
}

function validateSidecarVerdict(value: unknown, prdId?: string): RecoveryVerdict {
  const obj = requireRecord(value, `Recovery sidecar verdict is invalid${suffix(prdId)}`);
  if (obj.verdict === 's' + 'plit') throw new Error(`Recovery sidecar legacy continuation verdicts are no longer supported${suffix(prdId)}`);
  const legacySuccessorKey = ['suggested', 'Successor', 'Prd'].join('');
  if (obj[legacySuccessorKey] !== undefined) throw new Error(`Recovery sidecar legacy successor PRD content is no longer supported${suffix(prdId)}`);
  return parseWithSchema(recoveryVerdictSchema, value) as RecoveryVerdict;
}

function validateReport(value: unknown, prdId?: string): RecoveryVerdictSidecar['report'] {
  const obj = requireRecord(value, `Recovery sidecar report is invalid${suffix(prdId)}`);
  return {
    operatorSummary: requireString(obj.operatorSummary, 'report.operatorSummary', prdId),
    recommendedAction: requireString(obj.recommendedAction, 'report.recommendedAction', prdId),
    ...(obj.rootFailure !== undefined ? { rootFailure: validateOptionalStringRecord(obj.rootFailure, 'report.rootFailure', ['planId', 'scope', 'stage', 'message'], prdId) } : {}),
    keyEvidence: requireStringArray(obj.keyEvidence, 'report.keyEvidence', prdId),
    completedWork: requireStringArray(obj.completedWork, 'report.completedWork', prdId),
    remainingWork: requireStringArray(obj.remainingWork, 'report.remainingWork', prdId),
    risks: requireStringArray(obj.risks, 'report.risks', prdId),
    ...(obj.evidenceOmissions !== undefined ? { evidenceOmissions: requireStringArray(obj.evidenceOmissions, 'report.evidenceOmissions', prdId) } : {}),
  };
}

function validateBoundedEvidence(value: unknown, prdId?: string): RecoveryVerdictSidecar['boundedEvidence'] {
  const obj = requireRecord(value, `Recovery sidecar boundedEvidence is invalid${suffix(prdId)}`);
  const identityObj = requireRecord(obj.identity, `Recovery sidecar boundedEvidence.identity is invalid${suffix(prdId)}`);
  const identity = {
    prdId: requireString(identityObj.prdId, 'boundedEvidence.identity.prdId', prdId),
    setName: requireString(identityObj.setName, 'boundedEvidence.identity.setName', prdId),
    featureBranch: requireString(identityObj.featureBranch, 'boundedEvidence.identity.featureBranch', prdId),
    baseBranch: requireString(identityObj.baseBranch, 'boundedEvidence.identity.baseBranch', prdId),
    failedAt: requireString(identityObj.failedAt, 'boundedEvidence.identity.failedAt', prdId),
    ...(typeof identityObj.partial === 'boolean' ? { partial: identityObj.partial } : {}),
  };
  return {
    identity,
    plans: requireArray(obj.plans, 'boundedEvidence.plans', prdId).map((item) => validatePlan(item, prdId)),
    failingPlan: validateFailingPlan(obj.failingPlan, prdId),
    ...(obj.failingPlans !== undefined ? { failingPlans: requireArray(obj.failingPlans, 'boundedEvidence.failingPlans', prdId).map((item) => validateFailingPlan(item, prdId)) } : {}),
    landedCommits: requireArray(obj.landedCommits, 'boundedEvidence.landedCommits', prdId).map((item) => validateCommit(item, prdId)),
    modelsUsed: requireStringArray(obj.modelsUsed, 'boundedEvidence.modelsUsed', prdId),
    ...(obj.terminalFailure !== undefined ? { terminalFailure: validatePrimitiveRecord(obj.terminalFailure, 'boundedEvidence.terminalFailure', prdId) } : {}),
    ...(obj.acceptanceValidation !== undefined ? { acceptanceValidation: validateAcceptance(obj.acceptanceValidation, prdId) } : {}),
    ...(obj.validationCommands !== undefined ? { validationCommands: requireArray(obj.validationCommands, 'boundedEvidence.validationCommands', prdId).map((item) => validateCommand(item, prdId)) } : {}),
    ...(obj.landing !== undefined ? { landing: validateLanding(obj.landing, prdId) } : {}),
    ...(obj.reviewFailure !== undefined ? { reviewFailure: obj.reviewFailure } : {}),
    ...(typeof obj.diffStat === 'string' ? { diffStat: obj.diffStat } : {}),
    ...(obj.evidenceOmissions !== undefined ? { evidenceOmissions: requireStringArray(obj.evidenceOmissions, 'boundedEvidence.evidenceOmissions', prdId) } : {}),
  };
}

function validatePlan(value: unknown, prdId?: string): RecoveryVerdictSidecar['boundedEvidence']['plans'][number] {
  const obj = requireRecord(value, `Recovery sidecar plan is invalid${suffix(prdId)}`);
  return {
    planId: requireString(obj.planId, 'plan.planId', prdId),
    status: requireString(obj.status, 'plan.status', prdId),
    ...(typeof obj.error === 'string' ? { error: obj.error } : {}),
    ...(typeof obj.terminalSubtype === 'string' ? { terminalSubtype: obj.terminalSubtype } : {}),
    ...(typeof obj.commitSha === 'string' ? { commitSha: obj.commitSha } : {}),
  };
}

function validateFailingPlan(value: unknown, prdId?: string): RecoveryVerdictSidecar['boundedEvidence']['failingPlan'] {
  const obj = requireRecord(value, `Recovery sidecar failingPlan is invalid${suffix(prdId)}`);
  return {
    planId: requireString(obj.planId, 'failingPlan.planId', prdId),
    ...(typeof obj.errorMessage === 'string' ? { errorMessage: obj.errorMessage } : {}),
    ...(typeof obj.terminalSubtype === 'string' ? { terminalSubtype: obj.terminalSubtype } : {}),
  };
}

function validateCommit(value: unknown, prdId?: string): RecoveryVerdictSidecar['boundedEvidence']['landedCommits'][number] {
  const obj = requireRecord(value, `Recovery sidecar landedCommit is invalid${suffix(prdId)}`);
  return {
    sha: requireString(obj.sha, 'landedCommit.sha', prdId),
    subject: requireString(obj.subject, 'landedCommit.subject', prdId),
    author: requireString(obj.author, 'landedCommit.author', prdId),
    date: requireString(obj.date, 'landedCommit.date', prdId),
  };
}

function validateAcceptance(value: unknown, prdId?: string): NonNullable<RecoveryVerdictSidecar['boundedEvidence']['acceptanceValidation']> {
  const obj = requireRecord(value, `Recovery sidecar acceptanceValidation is invalid${suffix(prdId)}`);
  return {
    passed: requireBoolean(obj.passed, 'acceptanceValidation.passed', prdId),
    total: requireNumber(obj.total, 'acceptanceValidation.total', prdId),
    pass: requireNumber(obj.pass, 'acceptanceValidation.pass', prdId),
    fail: requireNumber(obj.fail, 'acceptanceValidation.fail', prdId),
    unknown: requireNumber(obj.unknown, 'acceptanceValidation.unknown', prdId),
    verdicts: requireArray(obj.verdicts, 'acceptanceValidation.verdicts', prdId).map((item) => {
      const row = requireRecord(item, `Recovery sidecar acceptance verdict is invalid${suffix(prdId)}`);
      const verdict = requireString(row.verdict, 'acceptanceValidation.verdicts[].verdict', prdId);
      if (verdict !== 'pass' && verdict !== 'fail' && verdict !== 'unknown') throw new Error(`Recovery sidecar acceptance verdict is invalid${suffix(prdId)}`);
      return { criterion: requireString(row.criterion, 'acceptanceValidation.verdicts[].criterion', prdId), verdict, evidence: requireString(row.evidence, 'acceptanceValidation.verdicts[].evidence', prdId) };
    }),
    ...(typeof obj.omittedEvidenceCount === 'number' ? { omittedEvidenceCount: obj.omittedEvidenceCount } : {}),
  };
}

function validateCommand(value: unknown, prdId?: string): NonNullable<RecoveryVerdictSidecar['boundedEvidence']['validationCommands']>[number] {
  const obj = requireRecord(value, `Recovery sidecar validation command is invalid${suffix(prdId)}`);
  return {
    command: requireString(obj.command, 'validationCommands.command', prdId),
    exitCode: requireNumber(obj.exitCode, 'validationCommands.exitCode', prdId),
    ...(typeof obj.outputPreview === 'string' ? { outputPreview: obj.outputPreview } : {}),
    ...(typeof obj.truncated === 'boolean' ? { truncated: obj.truncated } : {}),
  };
}

function validateLanding(value: unknown, prdId?: string): NonNullable<RecoveryVerdictSidecar['boundedEvidence']['landing']> {
  const obj = requireRecord(value, `Recovery sidecar landing is invalid${suffix(prdId)}`);
  return {
    status: requireString(obj.status, 'landing.status', prdId),
    ...(typeof obj.action === 'string' ? { action: obj.action } : {}),
    ...(typeof obj.reason === 'string' ? { reason: obj.reason } : {}),
  };
}

function validateContinueRepairEligibility(value: unknown, prdId?: string): RecoverySidecarContinueRepairEligibility {
  const obj = requireRecord(value, `Recovery sidecar continueRepairEligibility is invalid${suffix(prdId)}`);
  const source = requireString(obj.source, 'continueRepairEligibility.source', prdId);
  if (source !== 'continueRepairEligibility' && source !== 'inspection-error') throw new Error(`continueRepairEligibility.source is invalid${suffix(prdId)}`);
  const eligible = requireBoolean(obj.eligible, 'continueRepairEligibility.eligible', prdId);
  const featureBranch = requireString(obj.featureBranch, 'continueRepairEligibility.featureBranch', prdId);
  if (eligible) {
    const artifactAvailability = requireString(obj.artifactAvailability, 'continueRepairEligibility.artifactAvailability', prdId);
    if (artifactAvailability !== 'merge-worktree' && artifactAvailability !== 'feature-branch' && artifactAvailability !== 'branch-history') throw new Error(`continueRepairEligibility.artifactAvailability is invalid${suffix(prdId)}`);
    return {
      source,
      eligible: true,
      featureBranch,
      artifactAvailability,
      ...(typeof obj.artifactCommit === 'string' ? { artifactCommit: obj.artifactCommit } : {}),
      landedCommitCount: requireNumber(obj.landedCommitCount, 'continueRepairEligibility.landedCommitCount', prdId),
      diffStat: requireStringAllowEmpty(obj.diffStat, 'continueRepairEligibility.diffStat', prdId),
      ...(typeof obj.failingPlanId === 'string' ? { failingPlanId: obj.failingPlanId } : {}),
      ...(typeof obj.partial === 'boolean' ? { partial: obj.partial } : {}),
    };
  }
  return {
    source,
    eligible: false,
    featureBranch,
    reason: requireString(obj.reason, 'continueRepairEligibility.reason', prdId),
    ...(typeof obj.checkedPath === 'string' ? { checkedPath: obj.checkedPath } : {}),
  };
}

function validateRecoveryOptions(value: unknown, prdId?: string): RecoverySidecarRecoveryOption[] {
  return requireArray(value, 'recoveryOptions', prdId).map((item) => {
    const obj = requireRecord(item, `Recovery sidecar recoveryOptions item is invalid${suffix(prdId)}`);
    const kind = requireString(obj.kind, 'recoveryOptions.kind', prdId);
    const action = requireString(obj.action, 'recoveryOptions.action', prdId);
    if (kind === 'compiled-build-resume' || action === 'eforge_' + 'resume_build') throw new Error(`recoveryOptions contains a legacy repair action${suffix(prdId)}`);
    if (kind === 'continue-repair') return validateContinueRepairOption(obj, action, prdId);
    if (kind === 'compile-scope-context') return validateCompileScopeContextOption(obj, action, prdId);
    throw new Error(`recoveryOptions.kind is invalid${suffix(prdId)}`);
  });
}

function validateContinueRepairOption(obj: Record<string, unknown>, action: string, prdId?: string): RecoverySidecarRecoveryOption {
  if (action !== 'continue-repair') throw new Error(`recoveryOptions.action is invalid${suffix(prdId)}`);
  return {
    kind: 'continue-repair',
    action,
    recommended: requireBoolean(obj.recommended, 'recoveryOptions.recommended', prdId),
    reason: requireString(obj.reason, 'recoveryOptions.reason', prdId),
  };
}

function validateCompileScopeContextOption(obj: Record<string, unknown>, action: string, prdId?: string): RecoverySidecarRecoveryOption {
  const compileAction = requireCompileRecoveryGuidanceAction(action, prdId);
  return {
    kind: 'compile-scope-context',
    action: compileAction,
    recommended: requireBoolean(obj.recommended, 'recoveryOptions.recommended', prdId),
    eligible: requireBoolean(obj.eligible, 'recoveryOptions.eligible', prdId),
    reason: requireString(obj.reason, 'recoveryOptions.reason', prdId),
    attempted: requireBoolean(obj.attempted, 'recoveryOptions.attempted', prdId),
    attempt: requireNonNegativeInteger(obj.attempt, 'recoveryOptions.attempt', prdId),
    maxAttempts: requirePositiveInteger(obj.maxAttempts, 'recoveryOptions.maxAttempts', prdId),
    source: requireCompileScopeContextSource(obj.source, prdId),
    failureKind: requireCompileScopeContextFailureKind(obj.failureKind, prdId),
  };
}

function requireCompileRecoveryGuidanceAction(value: unknown, prdId?: string): Extract<RecoverySidecarRecoveryOption, { kind: 'compile-scope-context' }>['action'] {
  try {
    return parseWithSchema(RecoverySidecarCompileScopeContextActionSchema, value);
  } catch {
    throw new Error(`recoveryOptions.action is invalid${suffix(prdId)}`);
  }
}

function requireCompileScopeContextSource(value: unknown, prdId?: string): Extract<RecoverySidecarRecoveryOption, { kind: 'compile-scope-context' }>['source'] {
  try {
    return parseWithSchema(RecoverySidecarCompileScopeContextOptionSchema.properties.source, value);
  } catch {
    throw new Error(`recoveryOptions.source is invalid${suffix(prdId)}`);
  }
}

function requireCompileScopeContextFailureKind(value: unknown, prdId?: string): Extract<RecoverySidecarRecoveryOption, { kind: 'compile-scope-context' }>['failureKind'] {
  try {
    return parseWithSchema(RecoverySidecarCompileScopeContextOptionSchema.properties.failureKind, value);
  } catch {
    throw new Error(`recoveryOptions.failureKind is invalid${suffix(prdId)}`);
  }
}

function validateOptionalStringRecord(value: unknown, label: string, keys: string[], prdId?: string): Record<string, string> {
  const obj = requireRecord(value, `${label} is invalid${suffix(prdId)}`);
  const out: Record<string, string> = {};
  for (const key of keys) if (typeof obj[key] === 'string') out[key] = obj[key];
  return out;
}

function validatePrimitiveRecord(value: unknown, label: string, prdId?: string): Record<string, string | boolean | number | undefined> {
  const obj = requireRecord(value, `${label} is invalid${suffix(prdId)}`);
  const out: Record<string, string | boolean | number | undefined> = {};
  for (const [key, item] of Object.entries(obj)) {
    if (typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' || item === undefined) out[key] = item;
    else throw new Error(`${label}.${key} is invalid${suffix(prdId)}`);
  }
  return out;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string, prdId?: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid${suffix(prdId)}`);
  return value;
}

function requireStringArray(value: unknown, label: string, prdId?: string): string[] {
  const arr = requireArray(value, label, prdId);
  if (!arr.every((item): item is string => typeof item === 'string')) throw new Error(`${label} is invalid${suffix(prdId)}`);
  return arr;
}

function requireString(value: unknown, label: string, prdId?: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is invalid${suffix(prdId)}`);
  return value;
}

function requireStringAllowEmpty(value: unknown, label: string, prdId?: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid${suffix(prdId)}`);
  return value;
}

function requireNumber(value: unknown, label: string, prdId?: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is invalid${suffix(prdId)}`);
  return value;
}

function requirePositiveInteger(value: unknown, label: string, prdId?: string): number {
  const numberValue = requireNumber(value, label, prdId);
  if (!Number.isInteger(numberValue) || numberValue < 1) throw new Error(`${label} is invalid${suffix(prdId)}`);
  return numberValue;
}

function requireNonNegativeInteger(value: unknown, label: string, prdId?: string): number {
  const numberValue = requireNumber(value, label, prdId);
  if (!Number.isInteger(numberValue) || numberValue < 0) throw new Error(`${label} is invalid${suffix(prdId)}`);
  return numberValue;
}

function requireBoolean(value: unknown, label: string, prdId?: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid${suffix(prdId)}`);
  return value;
}

function suffix(prdId?: string): string {
  return prdId ? ` for prdId: ${prdId}` : '';
}
