import type { RecoveryVerdictSidecar } from '@eforge-build/client';
import type { AcceptanceCriterionVerdict } from '../events.js';
import { renderDecompositionEvidenceMarkdownLines } from './decomposition-evidence-render.js';
import type { RecoverySidecarContinueRepairEvidence } from './resume-sidecar.js';

function escapeTableCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function bulletLines(items: readonly string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ['- None recorded.'];
}

function acceptanceNextStep(verdict: AcceptanceCriterionVerdict['verdict']): string {
  switch (verdict) {
    case 'fail': return 'Update implementation/tests or waive the criterion with explicit human justification.';
    case 'unknown': return 'Inspect manually and add deterministic proof or clarify the criterion.';
    case 'pass': return 'No action required.';
  }
}

function compileRecoveryActionLabel(action: string): string {
  switch (action) {
    case 'retry-as-expedition': return 'retry as expedition';
    case 'bounded-decomposition': return 'bounded decomposition';
    case 'manual-reduce-scope': return 'manual scope reduction';
    default: return action;
  }
}

function renderCompileScopeContextSection(payload: RecoveryVerdictSidecar & Partial<RecoverySidecarContinueRepairEvidence>): string[] {
  const options = payload.recoveryOptions?.filter((option) => option.kind === 'compile-scope-context') ?? [];
  if (options.length === 0) return [];

  const lines = [
    '## Compile scope/context recovery guidance',
    '',
    'These options are read-only compile guidance. They do not map to an `apply-recovery` mutation; use existing recovery verdict actions, continue-and-repair when artifacts are valid, or manual scope reduction/decomposition.',
    '',
  ];
  for (const option of options) {
    lines.push(
      `### ${compileRecoveryActionLabel(option.action)}${option.recommended ? ' (recommended)' : ''}`,
      '',
      `**Action:** ${option.action}`,
      `**Eligible:** ${option.eligible ? 'yes' : 'no'}`,
      `**Attempted:** ${option.attempted ? 'yes' : 'no'}`,
      `**Attempt:** ${option.attempt}/${option.maxAttempts}`,
      `**Source:** ${option.source}`,
      `**Failure Kind:** ${option.failureKind}`,
      `**Reason:** ${escapeTableCell(option.reason)}`,
      '',
    );
    if (option.decompositionEvidence) {
      lines.push(
        '#### Decomposition evidence',
        '',
        'This is read-only context-managed decomposition evidence. Existing direct retry or apply-recovery actions do not mutate compile decomposition state; the engine does not auto-author or auto-enqueue successor PRDs.',
        '',
        ...renderDecompositionEvidenceMarkdownLines(option.decompositionEvidence),
        '',
      );
    }
  }
  return lines;
}

function renderContinueRepairSection(payload: RecoveryVerdictSidecar & Partial<RecoverySidecarContinueRepairEvidence>): string[] {
  const eligibility = payload.continueRepairEligibility;
  if (eligibility === undefined) return [];

  const lines = [
    '## Continue-and-repair eligibility',
    '',
    `**Eligibility:** ${eligibility.eligible ? 'eligible' : 'ineligible'}`,
    `**Source:** ${eligibility.source}`,
    `**Feature Branch:** \`${eligibility.featureBranch}\``,
  ];

  if (eligibility.eligible) {
    const recommended = payload.recoveryOptions?.find((option) => option.kind === 'continue-repair' && option.recommended);
    lines.push(
      `**Artifact Source:** ${eligibility.artifactAvailability}`,
      `**Landed Commits:** ${eligibility.landedCommitCount}`,
    );
    if (eligibility.artifactCommit) lines.push(`**Artifact Commit:** \`${eligibility.artifactCommit}\``);
    if (eligibility.failingPlanId) lines.push(`**Failing Plan:** ${eligibility.failingPlanId}`);
    if (eligibility.partial !== undefined) lines.push(`**Partial Evidence:** ${eligibility.partial ? 'yes' : 'no'}`);
    if (recommended !== undefined && eligibility.partial !== true) {
      lines.push('', recommended.reason, '', `Recommended operator action: run \`eforge continue-repair ${payload.prdId}\` or use the daemon continue-repair action. Do not generate a successor PRD.`);
    } else {
      lines.push('', 'Continue-and-repair is not recommended from this sidecar. Perform bounded manual review before choosing a recovery action.');
    }
  } else {
    lines.push(`**Reason:** ${escapeTableCell(eligibility.reason)}`);
    if (eligibility.checkedPath) lines.push(`**Checked Path:** \`${eligibility.checkedPath}\``);
    lines.push('', 'Continue-and-repair is not recommended from this sidecar. Use retry-from-scratch only when evidence shows it is safe, otherwise perform bounded manual review / manual replanning.');
  }

  lines.push('');
  return lines;
}

export function renderRecoverySidecarMarkdown(payload: RecoveryVerdictSidecar & Partial<RecoverySidecarContinueRepairEvidence>): string {
  const { boundedEvidence: evidence, report, verdict } = payload;
  const lines: string[] = [
    `# Recovery Analysis: ${payload.prdId}`,
    '',
    `**Generated:** ${payload.generatedAt}`,
    `**Set:** ${payload.setName}`,
    `**Feature Branch:** \`${evidence.identity.featureBranch}\``,
    `**Base Branch:** \`${evidence.identity.baseBranch}\``,
    `**Failed At:** ${evidence.identity.failedAt}`,
    ...(evidence.identity.partial === true ? ['**Partial Evidence:** yes'] : []),
    '',
    '## Operator Summary',
    '',
    `**Verdict:** ${verdict.verdict.toUpperCase()} (confidence: ${verdict.confidence})`,
    ...(verdict.recommendationSource !== undefined ? [`**Verdict Source:** ${verdict.recommendationSource}`] : []),
    ...(verdict.verdictInvalidationReason !== undefined ? [`**Analyst Verdict Rejected:** ${escapeTableCell(verdict.verdictInvalidationReason)}`] : []),
    ...(report.rootFailure?.scope !== undefined ? [`**Root Failure Scope:** ${report.rootFailure.scope}`] : []),
    ...(report.rootFailure?.stage !== undefined ? [`**Root Failure Stage:** ${report.rootFailure.stage}`] : []),
    ...(report.rootFailure?.planId !== undefined ? [`**Root Failure Plan:** ${report.rootFailure.planId}`] : []),
    ...(report.rootFailure?.message !== undefined ? [`**Root Failure Message:** ${escapeTableCell(report.rootFailure.message)}`] : []),
    '',
    report.operatorSummary,
    '',
    '### Recommended Action',
    '',
    report.recommendedAction,
    '',
    ...renderContinueRepairSection(payload),
    ...renderCompileScopeContextSection(payload),
    '## Key Evidence',
    '',
    ...bulletLines(report.keyEvidence),
    '',
    '## Completed Work',
    '',
    ...bulletLines(report.completedWork),
    '',
    '## Remaining Work',
    '',
    ...bulletLines(report.remainingWork),
    '',
    '## Risks',
    '',
    ...bulletLines(report.risks),
    '',
    '## Manual Review Guidance',
    '',
    '- If the verdict is manual, inspect the bounded evidence and build logs before acting.',
    '- If follow-up work is needed, write a focused PRD for only the verified remaining scope; do not use generated successor content.',
    '- Retry from scratch only when the evidence shows no preserved work would be redone.',
    '',
    '## Detailed Evidence',
    '',
  ];

  lines.push('### Plans', '', '| Plan | Status | Error | Terminal Subtype | Commit |', '|------|--------|-------|------------------|--------|');
  for (const plan of evidence.plans) {
    lines.push(`| ${escapeTableCell(plan.planId)} | ${escapeTableCell(plan.status)} | ${escapeTableCell(plan.error ?? '')} | ${escapeTableCell(plan.terminalSubtype ?? '')} | ${escapeTableCell(plan.commitSha ?? '')} |`);
  }
  lines.push('');

  lines.push('### Failing Plan', '', `**Plan ID:** ${evidence.failingPlan.planId}`);
  if (evidence.failingPlan.errorMessage) lines.push(`**Error:** ${escapeTableCell(evidence.failingPlan.errorMessage)}`);
  if (evidence.failingPlan.terminalSubtype) lines.push(`**Terminal Subtype:** ${escapeTableCell(evidence.failingPlan.terminalSubtype)}`);
  lines.push('');

  if (evidence.failingPlans && evidence.failingPlans.length > 0) {
    lines.push('### Failing Plans', '', '| Plan | Error | Terminal Subtype |', '|------|-------|-----------------|');
    for (const plan of evidence.failingPlans) {
      lines.push(`| ${escapeTableCell(plan.planId)} | ${escapeTableCell(plan.errorMessage ?? '')} | ${escapeTableCell(plan.terminalSubtype ?? '')} |`);
    }
    lines.push('');
  }

  if (evidence.reviewFailure !== undefined) {
    lines.push('### Review Failure Details', '', '```json', JSON.stringify(evidence.reviewFailure, null, 2), '```', '');
  }

  if (evidence.landedCommits.length > 0) {
    lines.push('### Landed Commits', '', '| SHA | Subject | Author | Date |', '|-----|---------|--------|------|');
    for (const commit of evidence.landedCommits) {
      lines.push(`| \`${escapeTableCell(commit.sha.slice(0, 8))}\` | ${escapeTableCell(commit.subject)} | ${escapeTableCell(commit.author)} | ${escapeTableCell(commit.date)} |`);
    }
    lines.push('');
  }

  if (evidence.modelsUsed.length > 0) {
    lines.push('### Models Used', '', ...evidence.modelsUsed.map((model) => `- ${model}`), '');
  }

  if (evidence.terminalFailure) {
    lines.push('### Terminal Failure', '', '```json', JSON.stringify(evidence.terminalFailure, null, 2), '```', '');
  }

  if (evidence.acceptanceValidation) {
    const av = evidence.acceptanceValidation;
    lines.push('### Acceptance Validation', '', `**Result:** ${av.passed ? 'PASSED' : 'FAILED'}`, `**Total:** ${av.total} | **Pass:** ${av.pass} | **Fail:** ${av.fail} | **Unknown:** ${av.unknown}`, '');
    if (av.verdicts.length > 0) {
      lines.push('| Criterion | Verdict | Evidence | Next Step |', '|-----------|---------|----------|-----------|');
      for (const row of av.verdicts) {
        lines.push(`| ${escapeTableCell(row.criterion)} | ${row.verdict} | ${escapeTableCell(row.evidence)} | ${escapeTableCell(acceptanceNextStep(row.verdict))} |`);
      }
      lines.push('');
    }
    if (av.omittedEvidenceCount !== undefined) lines.push(`- [omitted ${av.omittedEvidenceCount} acceptance verdict(s)]`, '');
  }

  if (evidence.validationCommands && evidence.validationCommands.length > 0) {
    lines.push('### Validation Commands', '', '| Command | Exit Code | Output Preview |', '|---------|-----------|----------------|');
    for (const command of evidence.validationCommands) {
      lines.push(`| ${escapeTableCell(command.command)} | ${command.exitCode} | ${escapeTableCell(command.outputPreview ?? '')}${command.truncated ? ' [truncated]' : ''} |`);
    }
    lines.push('');
  }

  if (evidence.landing) {
    lines.push('### Landing Status', '', `**Status:** ${evidence.landing.status}`);
    if (evidence.landing.action) lines.push(`**Action:** ${evidence.landing.action}`);
    if (evidence.landing.reason) lines.push(`**Reason:** ${escapeTableCell(evidence.landing.reason)}`);
    lines.push('');
  }

  if (evidence.diffStat) lines.push('### Diff Stat', '', '```', evidence.diffStat, '```', '');
  if (evidence.evidenceOmissions && evidence.evidenceOmissions.length > 0) lines.push('### Evidence Omissions', '', ...bulletLines(evidence.evidenceOmissions), '');

  return lines.join('\n');
}
