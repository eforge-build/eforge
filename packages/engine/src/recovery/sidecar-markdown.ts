import type { RecoveryVerdictSidecar } from '@eforge-build/client';
import type { AcceptanceCriterionVerdict } from '../events.js';

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

export function renderRecoverySidecarMarkdown(payload: RecoveryVerdictSidecar): string {
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
  ];

  if (verdict.suggestedSuccessorPrd) {
    lines.push('## Suggested Successor PRD', '', '```markdown', verdict.suggestedSuccessorPrd, '```', '');
  }

  lines.push('## Detailed Evidence', '');
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
