import type {
  RecoverySidecarBoundedEvidence,
  RecoverySidecarReport,
  RecoveryVerdictSidecar,
} from '@eforge-build/client';
import type { RecoverySidecarRecoveryOption, RecoverySidecarResumeEligibility, RecoverySidecarResumeEvidence } from './resume-sidecar.js';
import type { BuildFailureSummary, RecoveryVerdict } from '../events.js';
import { boundList, truncateMiddleText, truncateText } from './text-bounds.js';

const SCHEMA_VERSION = 3;
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
  // --- eforge:region plan-02-sidecar-resume-option ---
  resumeEligibility?: RecoverySidecarResumeEligibility;
  recoveryOptions?: RecoverySidecarRecoveryOption[];
  // --- eforge:endregion plan-02-sidecar-resume-option ---
}

export function buildRecoverySidecarPayload(options: BuildRecoverySidecarPayloadOptions): RecoveryVerdictSidecar & Partial<RecoverySidecarResumeEvidence> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const boundedEvidence = buildBoundedEvidence(options.summary);
  const recoveryOptions = recoveryOptionsFor(options.resumeEligibility, options.recoveryOptions);
  const report = buildReport(options.summary, options.verdict, boundedEvidence, options.resumeEligibility);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    prdId: options.prdId,
    setName: options.summary.setName,
    verdict: options.verdict,
    report,
    boundedEvidence,
    ...(options.resumeEligibility !== undefined ? { resumeEligibility: options.resumeEligibility } : {}),
    ...(recoveryOptions !== undefined ? { recoveryOptions } : {}),
  };
}

function buildReport(
  summary: BuildFailureSummary,
  verdict: RecoveryVerdict,
  evidence: RecoverySidecarBoundedEvidence,
  resumeEligibility?: RecoverySidecarResumeEligibility,
): RecoverySidecarReport {
  const rootFailure = compactRootFailure(summary);
  return {
    operatorSummary: truncateText(verdict.rationale, BULLET_CHARS * 2, 'operator summary').text,
    recommendedAction: resumeEligibility?.eligible === true ? compiledResumeRecommendedAction(verdict) : recommendedAction(verdict),
    ...(rootFailure ? { rootFailure } : {}),
    keyEvidence: keyEvidence(summary, evidence),
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

function keyEvidence(summary: BuildFailureSummary, evidence: RecoverySidecarBoundedEvidence): string[] {
  const lines: string[] = [];
  if (evidence.failingPlan.planId !== 'unknown') lines.push(`Failing plan: ${evidence.failingPlan.planId}`);
  if (summary.terminalFailure?.scope) lines.push(`Terminal failure scope: ${summary.terminalFailure.scope}${summary.terminalFailure.stage ? ` (${summary.terminalFailure.stage})` : ''}`);
  if (summary.acceptanceValidation) lines.push(`Acceptance validation: ${summary.acceptanceValidation.pass}/${summary.acceptanceValidation.total} pass, ${summary.acceptanceValidation.fail} fail, ${summary.acceptanceValidation.unknown} unknown`);
  if (summary.validationCommands?.length) lines.push(`${summary.validationCommands.length} validation command(s) recorded with bounded output previews`);
  if (summary.landedCommits.length) lines.push(`${summary.landedCommits.length} landed commit(s) on ${summary.featureBranch}`);
  if (evidence.evidenceOmissions?.length) lines.push(...evidence.evidenceOmissions.slice(0, 3));
  return lines.length > 0 ? lines : ['No detailed failure evidence was available; inspect the failed PRD and build logs manually.'];
}

// --- eforge:region plan-02-sidecar-resume-option ---
function recoveryOptionsFor(
  resumeEligibility: RecoverySidecarResumeEligibility | undefined,
  recoveryOptions: RecoverySidecarRecoveryOption[] | undefined,
): RecoverySidecarRecoveryOption[] | undefined {
  if (recoveryOptions !== undefined) return recoveryOptions.length > 0 ? recoveryOptions : undefined;
  if (resumeEligibility?.eligible !== true) return undefined;
  return [{
    kind: 'compiled-build-resume',
    action: 'eforge_resume_build',
    recommended: true,
    reason: 'Compiled plan artifacts are eligible for scheduler-owned resume.',
  }];
}

function compiledResumeRecommendedAction(verdict: RecoveryVerdict): string {
  return `Recommended operator action: queue a compiled-build resume with eforge_resume_build (or /eforge:recover resume). The apply-recovery verdict remains ${verdict.verdict}; do not use eforge_apply_recovery for this resume action.`;
}
// --- eforge:endregion plan-02-sidecar-resume-option ---

function recommendedAction(verdict: RecoveryVerdict): string {
  switch (verdict.verdict) {
    case 'retry': return 'Re-queue the failed PRD for another build attempt.';
    case 'split': return 'Enqueue the suggested successor PRD and continue from preserved partial work when available.';
    case 'abandon': return 'Archive the failed PRD and stop attempting this work.';
    case 'manual': return 'Review the recovery report manually before taking further action.';
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
