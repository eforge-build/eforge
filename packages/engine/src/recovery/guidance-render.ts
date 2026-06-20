import type { RecoveryVerdictSidecar } from '@eforge-build/client';

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

  return ensureSingleTrailingNewline([
    HEADING,
    '',
    `- Failed PRD: ${prdId}`,
    `- Root failed plan: ${planId}`,
    `- Failure summary: ${formatSidecarEvidence(sidecar.report.operatorSummary)}`,
    ...failureDetails.map((detail) => `- Failure detail: ${formatSidecarEvidence(detail)}`),
    `- Recommended action: ${formatSidecarEvidence(sidecar.report.recommendedAction)}`,
    '- Remaining work:',
    ...remainingWork.map((item) => `  - ${item}`),
    `- Retry/resume guidance: Continue ${planId} for failed PRD ${prdId} from the preserved compiled artifacts; do not restart dependency-satisfied work that is already landed or complete.`,
    `- Sidecar generated at: ${sidecar.generatedAt}`,
    `- Source sidecar: ${sidecarPath}`,
    `- Source identity: prdId=${prdId}; setName=${setName}; featureBranch=${featureBranch}; baseBranch=${baseBranch}`,
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
  return JSON.stringify(redactSecretLikeValues(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, ' ').replace(/\r?\n/gu, ' ⏎ '));
}

function redactSecretLikeValues(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/=-]{16,}/giu, '$1[REDACTED]')
    .replace(/\b((?:[A-Za-z0-9_.-]*(?:password|passwd|pwd|token|secret|authorization|api[_-]?key|access[_-]?key|private[_-]?key)[A-Za-z0-9_.-]*)\s*(?:=|:)\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"',;]+)/giu, '$1[REDACTED]')
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu, '[REDACTED_AWS_ACCESS_KEY]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/gu, '[REDACTED_GITHUB_TOKEN]');
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
