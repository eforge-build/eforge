/**
 * Writes recovery sidecar files alongside a failed PRD:
 *   <prdId>.recovery.md  — human-readable summary with verdict and tables
 *   <prdId>.recovery.json — machine-readable contract (schemaVersion: 1)
 *
 * Both files are written atomically via write-to-temp-then-rename (POSIX-safe).
 */

import { writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildFailureSummary, RecoveryVerdict } from '../events.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write `.recovery.md` and `.recovery.json` sidecar files next to the failed PRD.
 *
 * @param failedPrdDir - Directory that contains (or will contain) the sidecar files
 * @param prdId - PRD identifier, used as the filename stem
 * @param summary - Build failure summary assembled by `buildFailureSummary`
 * @param verdict - Parsed recovery verdict from the recovery-analyst agent
 * @returns Absolute paths to the two written files
 */
export async function writeRecoverySidecar({
  failedPrdDir,
  prdId,
  summary,
  verdict,
}: {
  failedPrdDir: string;
  prdId: string;
  summary: BuildFailureSummary;
  verdict: RecoveryVerdict;
}): Promise<{ mdPath: string; jsonPath: string }> {
  const mdPath = join(failedPrdDir, `${prdId}.recovery.md`);
  const jsonPath = join(failedPrdDir, `${prdId}.recovery.json`);

  // Ensure target directory exists
  await mkdir(failedPrdDir, { recursive: true });

  // --- JSON sidecar (machine contract) ---
  const jsonPayload = {
    schemaVersion: 2,
    summary,
    verdict,
    generatedAt: new Date().toISOString(),
  };
  const jsonContent = JSON.stringify(jsonPayload, null, 2) + '\n';
  const jsonTmp = jsonPath + '.tmp';
  await writeFile(jsonTmp, jsonContent, 'utf-8');
  await rename(jsonTmp, jsonPath);

  // --- Markdown sidecar (human-readable) ---
  const mdContent = buildMarkdown(prdId, summary, verdict);
  const mdTmp = mdPath + '.tmp';
  await writeFile(mdTmp, mdContent, 'utf-8');
  await rename(mdTmp, mdPath);

  return { mdPath, jsonPath };
}

// ---------------------------------------------------------------------------
// Markdown builder
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe use inside a Markdown table cell.
 * Replaces `|` with `\|` and collapses newline/carriage-return characters to a space.
 */
function escapeTableCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function buildMarkdown(
  prdId: string,
  summary: BuildFailureSummary,
  verdict: RecoveryVerdict,
): string {
  const lines: string[] = [
    `# Recovery Analysis: ${prdId}`,
    '',
    `**Generated:** ${new Date().toISOString()}`,
    `**Set:** ${summary.setName}`,
    `**Feature Branch:** \`${summary.featureBranch}\``,
    `**Base Branch:** \`${summary.baseBranch}\``,
    `**Failed At:** ${summary.failedAt}`,
    '',
    '## Verdict',
    '',
    `**${verdict.verdict.toUpperCase()}** (confidence: ${verdict.confidence})`,
    '',
    ...(verdict.partial === true ? [
      `**⚠ Partial summary** — context was incomplete: ${verdict.recoveryError ?? 'some context was unavailable'}`,
      '',
    ] : []),
    ...(verdict.recommendationSource !== undefined ? [
      `**Verdict Source:** ${verdict.recommendationSource}`,
      '',
    ] : []),
    ...(verdict.verdictInvalidationReason !== undefined ? [
      `**⚠ Analyst Verdict Rejected:** ${escapeTableCell(verdict.verdictInvalidationReason)}`,
      '',
    ] : []),
    ...(verdict.recommendationRationale !== undefined && verdict.recommendationSource === 'deterministic' ? [
      `**Deterministic Rationale:** ${escapeTableCell(verdict.recommendationRationale)}`,
      '',
    ] : []),
    '## Rationale',
    '',
    verdict.rationale,
    '',
    '## Plans',
    '',
    '| Plan | Status | Error |',
    '|------|--------|-------|',
    ...summary.plans.map(p => `| ${escapeTableCell(p.planId)} | ${escapeTableCell(p.status)} | ${escapeTableCell(p.error ?? '')} |`),
    '',
    '## Failing Plan',
    '',
    `**Plan ID:** ${summary.failingPlan.planId}`,
  ];

  if (summary.failingPlan.errorMessage) {
    lines.push(`**Error:** ${summary.failingPlan.errorMessage}`);
  }
  lines.push('');

  if (summary.failingPlans && summary.failingPlans.length > 0) {
    lines.push('## Failing Plans', '');
    lines.push('| Plan | Error | Terminal Subtype |');
    lines.push('|------|-------|-----------------|');
    for (const fp of summary.failingPlans) {
      const err = escapeTableCell(fp.errorMessage ?? '');
      const sub = escapeTableCell(fp.terminalSubtype ?? '');
      lines.push(`| ${escapeTableCell(fp.planId)} | ${err} | ${sub} |`);
    }
    lines.push('');
  }

  if (summary.reviewFailure) {
    lines.push('## Review Failure Details', '');
    lines.push(`**Plan ID:** ${escapeTableCell(summary.reviewFailure.planId)}`);
    lines.push('');
    if (summary.reviewFailure.issues.length > 0) {
      lines.push('### Final Review Issues', '');
      lines.push('| Severity | Category | File | Line | Description | Fix |');
      lines.push('|----------|----------|------|------|-------------|-----|');
      for (const issue of summary.reviewFailure.issues) {
        lines.push(`| ${escapeTableCell(issue.severity)} | ${escapeTableCell(issue.category)} | ${escapeTableCell(issue.file)} | ${issue.line ?? ''} | ${escapeTableCell(issue.description)} | ${escapeTableCell(issue.fix ?? '')} |`);
      }
      lines.push('');
    }
    if (summary.reviewFailure.evaluation) {
      const ev = summary.reviewFailure.evaluation;
      lines.push('### Final Evaluation Verdicts', '');
      lines.push(`**Accepted:** ${ev.accepted} | **Rejected:** ${ev.rejected} | **Needs Review:** ${ev.review}`);
      lines.push('');
      if (ev.verdicts.length > 0) {
        lines.push('| Action | Issue Outcome | File | Hunk | Reason | Retry Guidance |');
        lines.push('|--------|---------------|------|------|--------|----------------|');
        for (const verdictRow of ev.verdicts) {
          const retryGuidance = 'retryGuidance' in verdictRow && typeof verdictRow.retryGuidance === 'string'
            ? verdictRow.retryGuidance
            : '';
          lines.push(`| ${escapeTableCell(verdictRow.action)} | ${escapeTableCell(verdictRow.issueOutcome ?? '')} | ${escapeTableCell(verdictRow.file)} | ${verdictRow.hunk ?? ''} | ${escapeTableCell(verdictRow.reason)} | ${escapeTableCell(retryGuidance)} |`);
        }
        lines.push('');
      }
    }
  }

  if (summary.landedCommits.length > 0) {
    lines.push('## Landed Commits', '');
    lines.push('| SHA | Subject | Author | Date |');
    lines.push('|-----|---------|--------|------|');
    for (const commit of summary.landedCommits) {
      const shortSha = commit.sha.slice(0, 8);
      lines.push(`| \`${shortSha}\` | ${escapeTableCell(commit.subject)} | ${escapeTableCell(commit.author)} | ${escapeTableCell(commit.date)} |`);
    }
    lines.push('');
  }

  if (summary.modelsUsed.length > 0) {
    lines.push('## Models Used', '');
    for (const model of summary.modelsUsed) {
      lines.push(`- ${model}`);
    }
    lines.push('');
  }

  if (verdict.completedWork.length > 0) {
    lines.push('## Completed Work', '');
    for (const item of verdict.completedWork) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  if (verdict.remainingWork.length > 0) {
    lines.push('## Remaining Work', '');
    for (const item of verdict.remainingWork) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  if (verdict.risks.length > 0) {
    lines.push('## Risks', '');
    for (const risk of verdict.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push('');
  }

  if (verdict.suggestedSuccessorPrd) {
    lines.push('## Suggested Successor PRD', '');
    lines.push('```markdown');
    lines.push(verdict.suggestedSuccessorPrd);
    lines.push('```');
    lines.push('');
  }

  if (summary.partial === true) {
    lines.push(`**⚠ Partial analysis** — failure summary was reconstructed from incomplete event history. Some details may be missing.`);
    lines.push('');
  }

  if (summary.terminalFailure) {
    lines.push('## Terminal Failure', '');
    if (summary.terminalFailure.scope) lines.push(`**Scope:** ${summary.terminalFailure.scope}`);
    if (summary.terminalFailure.stage) lines.push(`**Stage:** ${summary.terminalFailure.stage}`);
    if (summary.terminalFailure.message) lines.push(`**Message:** ${escapeTableCell(summary.terminalFailure.message)}`);
    if (summary.terminalFailure.phaseStatus) lines.push(`**Phase Status:** ${summary.terminalFailure.phaseStatus}`);
    if (summary.terminalFailure.phaseSummary) lines.push(`**Phase Summary:** ${escapeTableCell(summary.terminalFailure.phaseSummary)}`);
    if (summary.terminalFailure.eventType) lines.push(`**Event Type:** ${summary.terminalFailure.eventType}`);
    lines.push('');
  }

  if (summary.acceptanceValidation) {
    const av = summary.acceptanceValidation;
    lines.push('## Acceptance Validation', '');
    lines.push(`**Result:** ${av.passed ? 'PASSED' : 'FAILED'}`);
    lines.push(`**Total:** ${av.total} | **Pass:** ${av.pass} | **Fail:** ${av.fail} | **Unknown (inconclusive):** ${av.unknown}`);
    lines.push('');
    if (av.verdicts.length > 0) {
      lines.push('| Criterion | Verdict | Evidence |');
      lines.push('|-----------|---------|----------|');
      for (const v of av.verdicts) {
        lines.push(`| ${escapeTableCell(v.criterion)} | ${v.verdict} | ${escapeTableCell(v.evidence)} |`);
      }
      lines.push('');
    }
    if (av.waivers && av.waivers.length > 0) {
      lines.push('### Acceptance Waivers', '');
      for (const waiver of av.waivers) lines.push(`- ${escapeTableCell(waiver)}`);
      lines.push('');
    }
    if (av.conflicts && av.conflicts.length > 0) {
      lines.push('### Acceptance Criteria Conflicts', '');
      lines.push('| Criterion | Scope | Recommended Action | Conflicts With | Evidence |');
      lines.push('|-----------|-------|--------------------|----------------|----------|');
      for (const conflict of av.conflicts) {
        lines.push(`| ${escapeTableCell(conflict.criterion)} | ${conflict.scope} | ${conflict.recommendedAction} | ${escapeTableCell(conflict.conflictsWith)} | ${escapeTableCell(conflict.evidence)} |`);
      }
      lines.push('');
    }
  }

  if (summary.validationCommands && summary.validationCommands.length > 0) {
    lines.push('## Validation Commands', '');
    lines.push('| Command | Exit Code | Output |');
    lines.push('|---------|-----------|--------|');
    for (const cmd of summary.validationCommands) {
      const outputPreview = cmd.output ? escapeTableCell(cmd.output.slice(0, 120)) : '';
      lines.push(`| ${escapeTableCell(cmd.command)} | ${cmd.exitCode} | ${outputPreview} |`);
    }
    lines.push('');
  }

  if (summary.landing) {
    lines.push('## Landing Status', '');
    lines.push(`**Status:** ${summary.landing.status}`);
    if (summary.landing.action) {
      lines.push(`**Action:** ${summary.landing.action}`);
    }
    if (summary.landing.reason) {
      lines.push(`**Reason:** ${escapeTableCell(summary.landing.reason)}`);
    }
    lines.push('');
  }

  if (summary.diffStat) {
    lines.push('## Diff Stat', '');
    lines.push('```');
    lines.push(summary.diffStat);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}
