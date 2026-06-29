import type {
  RecoverySidecarBoundedEvidence,
  RecoverySidecarReport,
  RecoveryVerdictSidecar,
  RecoverySidecarRecoveryOption,
  RecoverySidecarSchemaVersion,
} from '@eforge-build/client';
import type { RecoverySidecarContinueRepairEligibility, RecoverySidecarContinueRepairEvidence } from './resume-sidecar.js';
import type { BuildFailureSummary, RecoveryVerdict } from '../events.js';
import { boundList, truncateMiddleText, truncateText } from './text-bounds.js';
import { decompositionEvidenceSummary } from './decomposition-evidence-render.js';

const SCHEMA_VERSION = 3;
const SCHEMA_VERSION_COMPILE_SCOPE_CONTEXT = 4;
const BULLET_LIMIT = 12;
const BULLET_CHARS = 500;
const ERROR_CHARS = 1_000;
const COMMAND_OUTPUT_CHARS = 1_200;
const DIFF_STAT_CHARS = 4_000;
const JSON_STRING_CHARS = 1_000;
const REVIEW_JSON_CHARS = 8_000;

export interface BuildRecoverySidecarPayloadOptions {
  prdId: string;
  summary: BuildFailureSummary;
  verdict: RecoveryVerdict;
  generatedAt?: string;
  continueRepairEligibility?: RecoverySidecarContinueRepairEligibility;
  recoveryOptions?: RecoverySidecarRecoveryOption[];
}

export function buildRecoverySidecarPayload(options: BuildRecoverySidecarPayloadOptions): RecoveryVerdictSidecar & Partial<RecoverySidecarContinueRepairEvidence> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const boundedEvidence = buildBoundedEvidence(options.summary);
  const recoveryOptions = recoveryOptionsFor(options.continueRepairEligibility, options.recoveryOptions);
  const report = buildReport(options.summary, options.verdict, boundedEvidence, options.continueRepairEligibility, recoveryOptions);
  return {
    schemaVersion: schemaVersionForRecoveryOptions(recoveryOptions),
    generatedAt,
    prdId: options.prdId,
    setName: options.summary.setName,
    verdict: options.verdict,
    report,
    boundedEvidence,
    ...(options.continueRepairEligibility !== undefined ? { continueRepairEligibility: options.continueRepairEligibility } : {}),
    ...(recoveryOptions !== undefined ? { recoveryOptions } : {}),
  };
}

function buildReport(
  summary: BuildFailureSummary,
  verdict: RecoveryVerdict,
  evidence: RecoverySidecarBoundedEvidence,
  continueRepairEligibility?: RecoverySidecarContinueRepairEligibility,
  recoveryOptions?: RecoverySidecarRecoveryOption[],
): RecoverySidecarReport {
  const rootFailure = compactRootFailure(summary);
  return {
    operatorSummary: truncateText(verdict.rationale, BULLET_CHARS * 2, 'operator summary').text,
    recommendedAction: hasRecommendedContinueRepairOption(recoveryOptions) && continueRepairEligibility?.eligible === true ? continueRepairRecommendedAction(summary.prdId) : (recommendedCompileScopeContextOption(recoveryOptions)?.reason ?? recommendedAction(verdict)),
    ...(rootFailure ? { rootFailure } : {}),
    keyEvidence: keyEvidence(summary, evidence, recoveryOptions),
    completedWork: boundedStrings(verdict.completedWork, 'completed work'),
    remainingWork: boundedStrings(verdict.remainingWork, 'remaining work'),
    risks: boundedStrings(verdict.risks, 'risk'),
    ...(evidence.evidenceOmissions && evidence.evidenceOmissions.length > 0 ? { evidenceOmissions: evidence.evidenceOmissions } : {}),
  };
}

function buildBoundedEvidence(summary: BuildFailureSummary): RecoverySidecarBoundedEvidence {
  const omissions: string[] = [];
  const validationCommands = summary.validationCommands?.map((command) => {
    const boundedCommand = truncateText(command.command, BULLET_CHARS, 'validation command').text;
    const bounded = command.output !== undefined
      ? truncateText(command.output, COMMAND_OUTPUT_CHARS, `validation command output: ${boundedCommand}`)
      : undefined;
    if (bounded?.truncated) omissions.push(`Validation command output was truncated for: ${boundedCommand}`);
    return {
      command: boundedCommand,
      exitCode: command.exitCode,
      ...(bounded !== undefined ? { outputPreview: bounded.text, truncated: bounded.truncated } : {}),
    };
  });

  const acceptance = summary.acceptanceValidation;
  const acceptanceVerdicts = acceptance ? boundList(acceptance.verdicts, 20) : undefined;
  if (acceptanceVerdicts && acceptanceVerdicts.omittedCount > 0) {
    omissions.push(`${acceptanceVerdicts.omittedCount} acceptance validation verdict(s) omitted from sidecar evidence.`);
  }

  const reviewFailure = summary.reviewFailure !== undefined ? boundUnknown(summary.reviewFailure, REVIEW_JSON_CHARS) : undefined;
  if (reviewFailure?.truncated) omissions.push('Review failure details were truncated.');

  const diffStat = summary.diffStat ? truncateMiddleText(summary.diffStat, DIFF_STAT_CHARS, 'diff stat') : undefined;
  if (diffStat?.truncated) omissions.push('Diff stat was truncated.');

  return {
    identity: {
      prdId: summary.prdId,
      setName: summary.setName,
      featureBranch: summary.featureBranch,
      baseBranch: summary.baseBranch,
      failedAt: summary.failedAt,
      ...(summary.partial !== undefined ? { partial: summary.partial } : {}),
    },
    plans: summary.plans.map((plan) => ({
      planId: plan.planId,
      status: plan.status,
      ...(plan.error !== undefined ? { error: truncateText(plan.error, ERROR_CHARS, `plan error: ${plan.planId}`).text } : {}),
      ...(plan.terminalSubtype !== undefined ? { terminalSubtype: plan.terminalSubtype } : {}),
      ...(plan.commitSha !== undefined ? { commitSha: plan.commitSha } : {}),
    })),
    failingPlan: {
      planId: summary.failingPlan.planId,
      ...(summary.failingPlan.errorMessage !== undefined ? { errorMessage: truncateText(summary.failingPlan.errorMessage, ERROR_CHARS, 'failing plan error').text } : {}),
      ...(summary.failingPlan.terminalSubtype !== undefined ? { terminalSubtype: summary.failingPlan.terminalSubtype } : {}),
    },
    ...(summary.failingPlans !== undefined ? {
      failingPlans: summary.failingPlans.map((plan) => ({
        planId: plan.planId,
        ...(plan.errorMessage !== undefined ? { errorMessage: truncateText(plan.errorMessage, ERROR_CHARS, `failing plan error: ${plan.planId}`).text } : {}),
        ...(plan.terminalSubtype !== undefined ? { terminalSubtype: plan.terminalSubtype } : {}),
      })),
    } : {}),
    landedCommits: summary.landedCommits.map((commit) => ({
      sha: commit.sha,
      subject: truncateText(commit.subject, BULLET_CHARS, 'commit subject').text,
      author: truncateText(commit.author, 200, 'commit author').text,
      date: commit.date,
    })),
    modelsUsed: [...summary.modelsUsed],
    ...(summary.terminalFailure !== undefined ? { terminalFailure: primitiveRecord(summary.terminalFailure as Record<string, unknown>) } : {}),
    ...(acceptance !== undefined ? {
      acceptanceValidation: {
        passed: acceptance.passed,
        total: acceptance.total,
        pass: acceptance.pass,
        fail: acceptance.fail,
        unknown: acceptance.unknown,
        verdicts: (acceptanceVerdicts?.items ?? []).map((verdict) => ({
          criterion: truncateText(verdict.criterion, BULLET_CHARS, 'acceptance criterion').text,
          verdict: verdict.verdict,
          evidence: truncateText(verdict.evidence, BULLET_CHARS, 'acceptance evidence').text,
        })),
        ...(acceptanceVerdicts && acceptanceVerdicts.omittedCount > 0 ? { omittedEvidenceCount: acceptanceVerdicts.omittedCount } : {}),
      },
    } : {}),
    ...(validationCommands !== undefined ? { validationCommands } : {}),
    ...(summary.landing !== undefined ? { landing: summary.landing } : {}),
    ...(reviewFailure?.value !== undefined ? { reviewFailure: reviewFailure.value } : {}),
    ...(diffStat !== undefined ? { diffStat: diffStat.text } : {}),
    ...(omissions.length > 0 ? { evidenceOmissions: omissions } : {}),
  };
}

function boundedStrings(items: readonly string[], label: string): string[] {
  const bounded = boundList(items, BULLET_LIMIT);
  const result = bounded.items.map((item) => truncateText(item, BULLET_CHARS, label).text);
  if (bounded.omittedCount > 0) result.push(`[omitted ${bounded.omittedCount} ${label} item(s)]`);
  return result;
}

function compactRootFailure(summary: BuildFailureSummary): RecoverySidecarReport['rootFailure'] | undefined {
  const root = {
    ...(summary.failingPlan.planId && summary.failingPlan.planId !== 'unknown' ? { planId: summary.failingPlan.planId } : {}),
    ...(typeof summary.terminalFailure?.scope === 'string' ? { scope: summary.terminalFailure.scope } : {}),
    ...(typeof summary.terminalFailure?.stage === 'string' ? { stage: summary.terminalFailure.stage } : {}),
    ...(typeof summary.terminalFailure?.message === 'string' ? { message: truncateText(summary.terminalFailure.message, ERROR_CHARS, 'terminal failure').text } : {}),
  };
  return Object.keys(root).length > 0 ? root : undefined;
}

function keyEvidence(summary: BuildFailureSummary, evidence: RecoverySidecarBoundedEvidence, recoveryOptions?: RecoverySidecarRecoveryOption[]): string[] {
  const lines: string[] = [];
  if (evidence.failingPlan.planId !== 'unknown') lines.push(`Failing plan: ${evidence.failingPlan.planId}`);
  if (summary.terminalFailure?.scope) lines.push(`Terminal failure scope: ${summary.terminalFailure.scope}${summary.terminalFailure.stage ? ` (${summary.terminalFailure.stage})` : ''}`);
  if (summary.terminalFailure?.scope === 'compile' && summary.terminalFailure.terminalSubtype === 'error_context_window') lines.push('Compile scope/context failure evidence is present; use recoveryOptions for bounded retry/decomposition guidance.');
  for (const option of recoveryOptions ?? []) {
    if (option.kind === 'compile-scope-context' && option.decompositionEvidence) lines.push(decompositionEvidenceSummary(option.decompositionEvidence));
  }
  if (summary.acceptanceValidation) {
    lines.push(`Acceptance validation: ${summary.acceptanceValidation.pass}/${summary.acceptanceValidation.total} pass, ${summary.acceptanceValidation.fail} fail, ${summary.acceptanceValidation.unknown} unknown`);
    if (isAllUnknownAcceptanceFailure(summary.acceptanceValidation)) {
      lines.push('Acceptance validation is inconclusive: no concrete failed criteria were produced; inspect validator output/context or clarify acceptance criteria.');
    }
  }
  if (summary.validationCommands?.length) lines.push(`${summary.validationCommands.length} validation command(s) recorded with bounded output previews`);
  if (summary.landedCommits.length) lines.push(`${summary.landedCommits.length} landed commit(s) on ${summary.featureBranch}`);
  if (evidence.evidenceOmissions?.length) lines.push(...evidence.evidenceOmissions.slice(0, 3));
  return lines.length > 0 ? lines : ['No detailed failure evidence was available; inspect the failed PRD and build logs manually.'];
}

function isAllUnknownAcceptanceFailure(acceptance: NonNullable<BuildFailureSummary['acceptanceValidation']>): boolean {
  return !acceptance.passed && acceptance.fail === 0 && acceptance.unknown === acceptance.total;
}

function recoveryOptionsFor(
  continueRepairEligibility: RecoverySidecarContinueRepairEligibility | undefined,
  recoveryOptions: RecoverySidecarRecoveryOption[] | undefined,
): RecoverySidecarRecoveryOption[] | undefined {
  if (recoveryOptions !== undefined) return recoveryOptions.length > 0 ? recoveryOptions : undefined;
  if (continueRepairEligibility?.eligible !== true || continueRepairEligibility.partial === true) return undefined;
  return [{
    kind: 'continue-repair',
    action: 'continue-repair',
    recommended: true,
    reason: 'Compiled plan artifacts are eligible for continue-and-repair.',
  }];
}

function schemaVersionForRecoveryOptions(recoveryOptions: RecoverySidecarRecoveryOption[] | undefined): RecoverySidecarSchemaVersion {
  return recoveryOptions?.some((option) => option.kind === 'compile-scope-context') === true
    ? SCHEMA_VERSION_COMPILE_SCOPE_CONTEXT
    : SCHEMA_VERSION;
}

function hasRecommendedContinueRepairOption(recoveryOptions: RecoverySidecarRecoveryOption[] | undefined): boolean {
  return recoveryOptions?.some((option) => option.kind === 'continue-repair' && option.action === 'continue-repair' && option.recommended) === true;
}

function recommendedCompileScopeContextOption(recoveryOptions: RecoverySidecarRecoveryOption[] | undefined): RecoverySidecarRecoveryOption | undefined {
  if (hasRecommendedContinueRepairOption(recoveryOptions)) return undefined;
  return recoveryOptions?.find((option) => option.kind === 'compile-scope-context' && option.recommended);
}

function continueRepairRecommendedAction(prdId: string): string {
  return `Continue and repair build (Continue build): run \`eforge continue-repair ${prdId}\`. This queues the failed PRD through the compiled-artifact repair path and reuses preserved work; do not generate a successor PRD.`;
}

function recommendedAction(verdict: RecoveryVerdict): string {
  switch (verdict.verdict) {
    case 'continue-repair': return 'Continue and repair build from preserved compiled artifacts.';
    case 'retry': return 'Retry from scratch: re-queue the failed PRD for another build attempt.';
    case 'abandon': return 'Archive the failed PRD and stop attempting this work.';
    case 'manual': return 'Manual review / manual replanning required. Review bounded evidence and create a focused follow-up PRD only after human inspection.';
  }
}

function primitiveRecord(value: Record<string, unknown>): Record<string, string | boolean | number | undefined> {
  const out: Record<string, string | boolean | number | undefined> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = truncateText(item, ERROR_CHARS, `terminal failure ${key}`).text;
    else if (typeof item === 'number' || typeof item === 'boolean' || item === undefined) out[key] = item;
  }
  return out;
}

function boundUnknown(value: unknown, maxChars: number): { value?: unknown; truncated: boolean } {
  const bounded = boundJsonStrings(value);
  const json = JSON.stringify(bounded.value);
  if (json.length <= maxChars) return bounded;
  return { value: { preview: truncateText(json, maxChars, 'review failure JSON').text }, truncated: true };
}

function boundJsonStrings(value: unknown): { value: unknown; truncated: boolean } {
  let truncated = false;
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') {
      const bounded = truncateText(item, JSON_STRING_CHARS, 'JSON string');
      truncated ||= bounded.truncated;
      return bounded.text;
    }
    if (Array.isArray(item)) return item.map(visit);
    if (typeof item === 'object' && item !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(item)) out[key] = visit(child);
      return out;
    }
    return item;
  };
  return { value: visit(value), truncated };
}
