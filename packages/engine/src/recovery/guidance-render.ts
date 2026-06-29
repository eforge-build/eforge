import type { RecoveryVerdictSidecar } from '@eforge-build/client';
import { redactSecretLikeValues } from '../secret-redaction.js';
import { decompositionEvidenceSummary, renderDecompositionEvidenceMarkdownLines } from './decomposition-evidence-render.js';

const HEADING = '## Recovery Guidance';

export interface RenderRecoveryGuidanceSectionOptions {
  sidecar: RecoveryVerdictSidecar;
  planId: string;
  sidecarPath: string;
  featureBranch: string;
  baseBranch: string;
  setName: string;
  prdId: string;
}

export function renderRecoveryGuidanceSection(options: RenderRecoveryGuidanceSectionOptions): string {
  const { sidecar, planId, sidecarPath, featureBranch, baseBranch, setName, prdId } = options;
  const rootFailure = sidecar.report.rootFailure;
  const failingPlan = findFailingPlan(sidecar, planId);
  const failureDetails = [
    rootFailure?.message,
    failingPlan?.errorMessage,
    failingPlan?.terminalSubtype ? `terminal subtype: ${failingPlan.terminalSubtype}` : undefined,
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  const remainingWork = sidecar.report.remainingWork.length > 0
    ? sidecar.report.remainingWork.map(formatSidecarEvidence)
    : ['Review the preserved compiled artifacts and complete the remaining dependency-satisfied work.'];
  const decompositionGuidance = sidecar.recoveryOptions
    ?.flatMap((option) => {
      if (option.kind !== 'compile-scope-context' || !option.decompositionEvidence) return [];
      return [
        `- Decomposition exhausted in unit ${formatSidecarEvidenceText(option.decompositionEvidence.unitId)}`,
        `- Decomposition evidence: ${formatSidecarEvidenceText(decompositionEvidenceSummary(option.decompositionEvidence))}`,
        ...renderDecompositionEvidenceMarkdownLines(option.decompositionEvidence).map((line) => `  ${formatSidecarEvidenceText(line)}`),
        '- Decomposition recovery note: existing direct retry/apply-recovery actions do not mutate compile decomposition state; the engine does not auto-author or auto-enqueue successor PRDs.',
      ];
    }) ?? [];

  return ensureSingleTrailingNewline([
    HEADING,
    '',
    `- Failed PRD: ${formatSidecarEvidence(prdId)}`,
    `- Root failed plan: ${formatSidecarEvidence(planId)}`,
    `- Failure summary: ${formatSidecarEvidence(sidecar.report.operatorSummary)}`,
    ...failureDetails.map((detail) => `- Failure detail: ${formatSidecarEvidence(detail)}`),
    `- Recommended action: ${formatSidecarEvidence(sidecar.report.recommendedAction)}`,
    ...decompositionGuidance,
    '- Remaining work:',
    ...remainingWork.map((item) => `  - ${item}`),
    `- Retry/resume guidance: Continue ${formatSidecarEvidenceText(planId)} for failed PRD ${formatSidecarEvidenceText(prdId)} from the preserved compiled artifacts; do not restart dependency-satisfied work that is already landed or complete.`,
    `- Sidecar generated at: ${formatSidecarEvidenceText(sidecar.generatedAt)}`,
    `- Source sidecar: ${formatSidecarEvidenceText(sidecarPath)}`,
    `- Source identity: prdId=${formatSidecarEvidenceText(prdId)}; setName=${formatSidecarEvidenceText(setName)}; featureBranch=${formatSidecarEvidenceText(featureBranch)}; baseBranch=${formatSidecarEvidenceText(baseBranch)}`,
  ].join('\n'));
}

export function patchRecoveryGuidanceSection(rawMarkdown: string, section: string): { content: string; changed: boolean } {
  const normalizedSection = ensureSingleTrailingNewline(section.trimEnd());
  const newlineNormalized = ensureSingleTrailingNewline(rawMarkdown);
  const ranges = recoveryGuidanceSectionRanges(newlineNormalized);
  let next: string;

  if (ranges.length === 0) {
    const base = newlineNormalized.trimEnd();
    next = `${base}${base.length > 0 ? '\n\n' : ''}${normalizedSection}`;
  } else {
    const first = ranges[0]!;
    next = newlineNormalized.slice(0, first.start) + normalizedSection.trimEnd() + '\n' + newlineNormalized.slice(first.end);
    const duplicateRanges = recoveryGuidanceSectionRanges(next).slice(1).reverse();
    for (const range of duplicateRanges) {
      next = trimExcessBlankAtJoin(next.slice(0, range.start), next.slice(range.end));
    }
    next = ensureSingleTrailingNewline(next.trimEnd());
  }

  return { content: next, changed: next !== rawMarkdown };
}

export function countRecoveryGuidanceSections(rawMarkdown: string): number {
  return rawMarkdown.split(/\r?\n/).filter((line) => line.trim() === HEADING).length;
}

function recoveryGuidanceSectionRanges(markdown: string): Array<{ start: number; end: number }> {
  const lineRe = /.*(?:\n|$)/g;
  const headings: Array<{ start: number; end: number; level: number; text: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(markdown)) !== null) {
    const line = match[0];
    if (line.length === 0) break;
    const headingMatch = /^(#{1,6})\s+(.*?)\s*\r?\n?$/.exec(line);
    if (headingMatch) headings.push({ start: match.index, end: match.index + line.length, level: headingMatch[1]!.length, text: headingMatch[2]!.trim() });
  }

  const ranges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    if (heading.level !== 2 || heading.text !== 'Recovery Guidance') continue;
    const next = headings.slice(i + 1).find((candidate) => candidate.level <= heading.level);
    ranges.push({ start: heading.start, end: next?.start ?? markdown.length });
  }
  return ranges;
}

function formatSidecarEvidence(value: string): string {
  return JSON.stringify(formatSidecarEvidenceText(value));
}

function formatSidecarEvidenceText(value: string): string {
  const sanitized = redactSecretLikeValues(value)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, ' ')
    .replace(/\r?\n/gu, ' ⏎ ');
  return sanitized.length > 1000 ? `${sanitized.slice(0, 999)}…` : sanitized;
}

function findFailingPlan(sidecar: RecoveryVerdictSidecar, planId: string): RecoveryVerdictSidecar['boundedEvidence']['failingPlan'] | undefined {
  return (sidecar.boundedEvidence.failingPlans ?? []).find((plan) => plan.planId === planId)
    ?? (sidecar.boundedEvidence.failingPlan.planId === planId ? sidecar.boundedEvidence.failingPlan : undefined);
}

function trimExcessBlankAtJoin(before: string, after: string): string {
  return `${before.trimEnd()}\n\n${after.trimStart()}`;
}

function ensureSingleTrailingNewline(value: string): string {
  return `${value.replace(/\s+$/u, '')}\n`;
}
