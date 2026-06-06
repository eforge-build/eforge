import type { BuildFailureSummary } from '../events.js';
import { omissionMarker, truncateMiddleText, truncateText, truncationMarker } from './text-bounds.js';

// --- eforge:region recovery-analyst-context-public-api ---
export const RECOVERY_ANALYST_PROMPT_INPUT_BUDGET_CHARS = 120_000;

export interface RecoveryAnalystPromptContext {
  prdContent: string;
  summaryJson: string;
  truncated: boolean;
  notes: string[];
  inputBudgetChars: number;
}

export interface RecoveryAnalystPromptContextLimits {
  inputBudgetChars: number;
  prdBudgetChars: number;
  summaryBudgetChars: number;
  summaryStringLeafChars: number;
  commandOutputChars: number;
  acceptanceEvidenceChars: number;
  reviewIssueTextChars: number;
  diffStatChars: number;
}

export const DEFAULT_RECOVERY_ANALYST_PROMPT_CONTEXT_LIMITS: RecoveryAnalystPromptContextLimits = {
  inputBudgetChars: RECOVERY_ANALYST_PROMPT_INPUT_BUDGET_CHARS,
  prdBudgetChars: 50_000,
  summaryBudgetChars: 65_000,
  summaryStringLeafChars: 2_000,
  commandOutputChars: 1_000,
  acceptanceEvidenceChars: 1_000,
  reviewIssueTextChars: 1_000,
  diffStatChars: 4_000,
};

type PartialLimits = Partial<RecoveryAnalystPromptContextLimits>;
type JsonRecord = Record<string, unknown>;
type NoteSink = Set<string>;

interface ProjectionProfile extends RecoveryAnalystPromptContextLimits {
  omitDiffStatPreview?: boolean;
  omitValidationOutputPreview?: boolean;
  omitReviewFailureDetails?: boolean;
}

const PRD_HEADING_PATTERN = /^(#{1,6}\s+.*(?:acceptance|criteria|requirements|scope|out of scope).*)$/im;

export function prepareRecoveryAnalystPromptContext(options: {
  prdContent: string;
  summary: BuildFailureSummary;
  limits?: PartialLimits;
}): RecoveryAnalystPromptContext {
  const limits = { ...DEFAULT_RECOVERY_ANALYST_PROMPT_CONTEXT_LIMITS, ...options.limits };
  const prdNotes: NoteSink = new Set();
  const prdBudgetChars = Math.min(limits.prdBudgetChars, Math.max(0, limits.inputBudgetChars));
  const prdContent = boundPrdContent(options.prdContent, prdBudgetChars, prdNotes);
  const effectiveSummaryBudgetChars = Math.max(
    0,
    Math.min(limits.summaryBudgetChars, limits.inputBudgetChars - prdContent.length),
  );

  const summaryResult = buildBudgetedSummaryJson(
    options.summary,
    { ...limits, summaryBudgetChars: effectiveSummaryBudgetChars },
    prdNotes,
  );
  const notes = summaryResult.notes;
  const truncated = prdContent !== options.prdContent || notes.length > 0;

  return {
    prdContent,
    summaryJson: summaryResult.summaryJson,
    truncated,
    notes,
    inputBudgetChars: limits.inputBudgetChars,
  };
}
// --- eforge:endregion recovery-analyst-context-public-api ---

// --- eforge:region recovery-analyst-summary-budgeting ---
function buildBudgetedSummaryJson(
  summary: BuildFailureSummary,
  limits: RecoveryAnalystPromptContextLimits,
  prdNotes: NoteSink,
): { summaryJson: string; notes: string[] } {
  const profiles = summaryProfiles(limits);
  let bestJson = '';
  let bestNotes: string[] = [];

  for (const profile of profiles) {
    const notes = new Set(prdNotes);
    const projection = buildBoundedSummaryProjection(summary, profile, notes);
    const json = stringifyProjectionWithNotes(projection, notes);
    bestJson = json;
    bestNotes = [...notes];
    if (json.length <= limits.summaryBudgetChars) {
      return { summaryJson: json, notes: bestNotes };
    }
  }

  const emergencyNotes = new Set(bestNotes);
  emergencyNotes.add(
    `Recovery summary JSON exceeded ${limits.summaryBudgetChars} chars after preview reduction; optional large evidence was omitted to preserve lifecycle identifiers.`,
  );
  const emergency = buildEmergencySummaryProjection(summary, emergencyNotes);
  const emergencyJson = stringifyProjectionWithNotes(emergency, emergencyNotes);
  if (emergencyJson.length <= limits.summaryBudgetChars) {
    return { summaryJson: emergencyJson, notes: [...emergencyNotes] };
  }

  emergencyNotes.add(
    `Emergency recovery summary JSON still exceeded ${limits.summaryBudgetChars} chars; structural arrays may be incomplete and omitted context is missing evidence, not proof of absence.`,
  );
  const finalProjection = buildEmergencySummaryProjection(summary, emergencyNotes, limits.summaryBudgetChars);
  return {
    summaryJson: stringifyEmergencyProjectionWithinBudget(finalProjection, limits.summaryBudgetChars, emergencyNotes),
    notes: [...emergencyNotes],
  };
}

function summaryProfiles(limits: RecoveryAnalystPromptContextLimits): ProjectionProfile[] {
  return [
    limits,
    { ...limits, summaryStringLeafChars: 800, commandOutputChars: 400, acceptanceEvidenceChars: 400, reviewIssueTextChars: 400, diffStatChars: 1_000 },
    { ...limits, summaryStringLeafChars: 240, commandOutputChars: 120, acceptanceEvidenceChars: 120, reviewIssueTextChars: 120, diffStatChars: 300 },
    {
      ...limits,
      summaryStringLeafChars: 120,
      commandOutputChars: 0,
      acceptanceEvidenceChars: 80,
      reviewIssueTextChars: 80,
      diffStatChars: 0,
      omitDiffStatPreview: true,
      omitValidationOutputPreview: true,
      omitReviewFailureDetails: true,
    },
  ];
}

function stringifyProjectionWithNotes(projection: JsonRecord, notes: NoteSink): string {
  const finalProjection = { ...projection };
  if (notes.size > 0) {
    finalProjection.contextNotes = [...notes];
  }
  return JSON.stringify(finalProjection, null, 2);
}
// --- eforge:endregion recovery-analyst-summary-budgeting ---

// --- eforge:region recovery-analyst-prd-bounding ---
function boundPrdContent(prdContent: string, budgetChars: number, notes: NoteSink): string {
  if (budgetChars <= 0) {
    if (prdContent.length > 0) {
      notes.add(`PRD content omitted because no PRD prompt budget remained; omitted context is missing evidence, not proof of absence.`);
    }
    return '';
  }
  if (prdContent.length <= budgetChars) {
    return prdContent;
  }

  const marker = truncationMarker(prdContent.length, budgetChars, 'PRD content bounded for recovery analyst prompt');
  const sectionsPrefix = '\n\n## Preserved high-signal PRD sections\n';
  const tailPrefix = '\n\n## PRD tail preview\n';
  const fixedChars = marker.length + sectionsPrefix.length + tailPrefix.length + 6;
  const available = Math.max(0, budgetChars - fixedChars);
  const sectionBudget = Math.floor(available * 0.38);
  const headBudget = Math.floor(available * 0.44);
  const tailBudget = Math.max(0, available - headBudget - sectionBudget);
  const sections = extractMatchingPrdSections(prdContent, sectionBudget, notes);
  const sectionText = sections || '(no matching acceptance/criteria/requirements/scope sections found in retained PRD extraction)';
  const candidate = [
    prdContent.slice(0, headBudget),
    marker,
    `${sectionsPrefix}${sectionText}`,
    `${tailPrefix}${prdContent.slice(Math.max(0, prdContent.length - tailBudget))}`,
  ].join('\n\n');

  notes.add(`PRD content truncated from ${prdContent.length} chars to at most ${budgetChars} chars before rendering the recovery analyst prompt.`);
  if (!sections) {
    notes.add('No acceptance/criteria/requirements/scope heading section fit in the bounded PRD extraction; absence in the prompt is not proof the PRD lacks such content.');
  }

  return candidate.length <= budgetChars
    ? candidate
    : truncateMiddleText(candidate, budgetChars, 'bounded PRD projection exceeded PRD budget').text;
}

function extractMatchingPrdSections(prdContent: string, budgetChars: number, notes: NoteSink): string {
  if (budgetChars <= 0) return '';

  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings: Array<{ start: number; end: number; title: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(prdContent)) !== null) {
    headings.push({ start: match.index, end: match.index + match[0].length, title: match[2] });
  }

  const sections: string[] = [];
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    if (!matchesHighSignalPrdHeading(heading.title)) continue;
    const nextStart = headings[i + 1]?.start ?? prdContent.length;
    sections.push(prdContent.slice(heading.start, nextStart).trim());
  }

  if (sections.length === 0) return '';

  const joined = sections.join('\n\n');
  if (joined.length <= budgetChars) return joined;

  notes.add(`High-signal PRD heading sections truncated from ${joined.length} chars to ${budgetChars} chars.`);
  return truncateText(joined, budgetChars, 'high-signal PRD heading sections').text;
}

function matchesHighSignalPrdHeading(title: string): boolean {
  return PRD_HEADING_PATTERN.test(`# ${title}`);
}
// --- eforge:endregion recovery-analyst-prd-bounding ---

// --- eforge:region recovery-analyst-summary-projection ---
function buildBoundedSummaryProjection(
  summary: BuildFailureSummary,
  limits: ProjectionProfile,
  notes: NoteSink,
): JsonRecord {
  const projection: JsonRecord = {
    prdId: summary.prdId,
    setName: summary.setName,
    featureBranch: summary.featureBranch,
    baseBranch: summary.baseBranch,
    failedAt: summary.failedAt,
    plans: summary.plans.map(plan => projectPlan(plan, limits, notes)),
    failingPlan: projectFailingPlan(summary.failingPlan, limits, notes, 'failingPlan'),
    landedCommits: summary.landedCommits.map(commit => ({
      sha: commit.sha,
      subject: boundString(commit.subject, limits.summaryStringLeafChars, 'landedCommits[].subject', notes),
      author: boundString(commit.author, limits.summaryStringLeafChars, 'landedCommits[].author', notes),
      date: commit.date,
    })),
    diffStat: projectDiffStat(summary.diffStat, limits, notes),
    modelsUsed: summary.modelsUsed.map(model => boundString(model, limits.summaryStringLeafChars, 'modelsUsed[]', notes)),
  };

  copyDefined(projection, 'partial', summary.partial);
  copyDefined(projection, 'terminalFailure', projectTerminalFailure(summary.terminalFailure, limits, notes));
  copyDefined(projection, 'acceptanceValidation', projectAcceptanceValidation(summary.acceptanceValidation, limits, notes));
  copyDefined(projection, 'validationCommands', projectValidationCommands(summary.validationCommands, limits, notes));
  copyDefined(projection, 'landing', projectLanding(summary.landing, limits, notes));
  copyDefined(projection, 'failingPlans', summary.failingPlans?.map(plan => projectFailingPlan(plan, limits, notes, 'failingPlans[]')));
  copyDefined(projection, 'reviewFailure', projectReviewFailure(summary.reviewFailure, limits, notes));

  if (summary.prdContent !== undefined) {
    projection.omittedEvidence = ['summary.prdContent omitted because PRD content is supplied separately as a bounded prompt input'];
    notes.add('summary.prdContent was omitted from bounded summary JSON because bounded PRD content is provided separately; omitted evidence is not proof of absence.');
  }

  return projection;
}

function projectPlan(
  plan: BuildFailureSummary['plans'][number],
  limits: ProjectionProfile,
  notes: NoteSink,
): JsonRecord {
  const projected: JsonRecord = {
    planId: plan.planId,
    status: plan.status,
  };
  copyDefined(projected, 'mergedAt', plan.mergedAt);
  copyDefined(projected, 'error', boundOptionalString(plan.error, limits.summaryStringLeafChars, 'plans[].error', notes));
  copyDefined(projected, 'terminalSubtype', plan.terminalSubtype);
  copyDefined(projected, 'commitSha', plan.commitSha);
  copyDefined(projected, 'testPassed', plan.testPassed);
  copyDefined(projected, 'testFailed', plan.testFailed);
  copyDefined(projected, 'completedAt', plan.completedAt);
  copyDefined(projected, 'toolUseCount', plan.toolUseCount);
  return projected;
}

function projectFailingPlan(
  plan: BuildFailureSummary['failingPlan'],
  limits: ProjectionProfile,
  notes: NoteSink,
  path: string,
): JsonRecord {
  const projected: JsonRecord = { planId: plan.planId };
  copyDefined(projected, 'agentId', plan.agentId);
  copyDefined(projected, 'agentRole', plan.agentRole);
  copyDefined(projected, 'errorMessage', boundOptionalString(plan.errorMessage, limits.summaryStringLeafChars, `${path}.errorMessage`, notes));
  copyDefined(projected, 'terminalSubtype', plan.terminalSubtype);
  copyDefined(projected, 'toolUseCount', plan.toolUseCount);
  return projected;
}

function projectTerminalFailure(
  failure: BuildFailureSummary['terminalFailure'],
  limits: ProjectionProfile,
  notes: NoteSink,
): JsonRecord | undefined {
  if (!failure) return undefined;
  const projected: JsonRecord = {};
  for (const [key, value] of Object.entries(failure)) {
    projected[key] = typeof value === 'string'
      ? boundString(value, limits.summaryStringLeafChars, `terminalFailure.${key}`, notes)
      : value;
  }
  return projected;
}

function projectAcceptanceValidation(
  acceptance: BuildFailureSummary['acceptanceValidation'],
  limits: ProjectionProfile,
  notes: NoteSink,
): JsonRecord | undefined {
  if (!acceptance) return undefined;

  const projected: JsonRecord = {
    passed: acceptance.passed,
    total: acceptance.total,
    pass: acceptance.pass,
    fail: acceptance.fail,
    unknown: acceptance.unknown,
    verdicts: acceptance.verdicts.map(verdict => ({
      criterion: boundString(verdict.criterion, limits.summaryStringLeafChars, 'acceptanceValidation.verdicts[].criterion', notes),
      verdict: verdict.verdict,
      evidence: boundString(verdict.evidence, limits.acceptanceEvidenceChars, 'acceptanceValidation.verdicts[].evidence', notes),
    })),
  };
  copyDefined(projected, 'waivers', acceptance.waivers?.map(waiver => boundString(waiver, limits.summaryStringLeafChars, 'acceptanceValidation.waivers[]', notes)));
  copyDefined(projected, 'conflicts', acceptance.conflicts?.map(conflict => ({
    criterion: boundString(conflict.criterion, limits.summaryStringLeafChars, 'acceptanceValidation.conflicts[].criterion', notes),
    evidence: boundString(conflict.evidence, limits.acceptanceEvidenceChars, 'acceptanceValidation.conflicts[].evidence', notes),
    conflictsWith: boundString(conflict.conflictsWith, limits.summaryStringLeafChars, 'acceptanceValidation.conflicts[].conflictsWith', notes),
    scope: conflict.scope,
    recommendedAction: conflict.recommendedAction,
  })));
  return projected;
}

function projectValidationCommands(
  commands: BuildFailureSummary['validationCommands'],
  limits: ProjectionProfile,
  notes: NoteSink,
): JsonRecord[] | undefined {
  if (!commands) return undefined;
  return commands.map(command => {
    const projected: JsonRecord = {
      command: boundString(command.command, limits.summaryStringLeafChars, 'validationCommands[].command', notes),
      exitCode: command.exitCode,
    };
    if (command.output !== undefined) {
      if (limits.omitValidationOutputPreview) {
        projected.output = omissionMarker(command.output.length, 'validation command output preview omitted after summary budget reduction');
        notes.add('Validation command output previews were omitted after summary budget reduction; omitted output is missing evidence, not proof of absence.');
      } else {
        projected.output = boundString(command.output, limits.commandOutputChars, 'validationCommands[].output', notes);
      }
    }
    return projected;
  });
}

function projectLanding(
  landing: BuildFailureSummary['landing'],
  limits: ProjectionProfile,
  notes: NoteSink,
): JsonRecord | undefined {
  if (!landing) return undefined;
  const projected: JsonRecord = { status: landing.status };
  copyDefined(projected, 'action', boundOptionalString(landing.action, limits.summaryStringLeafChars, 'landing.action', notes));
  copyDefined(projected, 'reason', boundOptionalString(landing.reason, limits.summaryStringLeafChars, 'landing.reason', notes));
  return projected;
}

function projectDiffStat(diffStat: string, limits: ProjectionProfile, notes: NoteSink): string {
  if (limits.omitDiffStatPreview && diffStat.length > 0) {
    notes.add('diffStat preview was omitted after summary budget reduction; omitted diff evidence is not proof of absence.');
    return omissionMarker(diffStat.length, 'diffStat preview omitted after summary budget reduction');
  }
  return boundString(diffStat, limits.diffStatChars, 'diffStat', notes);
}

function projectReviewFailure(
  reviewFailure: BuildFailureSummary['reviewFailure'],
  limits: ProjectionProfile,
  notes: NoteSink,
): JsonRecord | undefined {
  if (!reviewFailure) return undefined;
  if (limits.omitReviewFailureDetails) {
    notes.add('Detailed review failure issue text was omitted after summary budget reduction; omitted review evidence is not proof of absence.');
    return {
      planId: reviewFailure.planId,
      issueCount: reviewFailure.issues.length,
      evaluation: reviewFailure.evaluation
        ? {
            accepted: reviewFailure.evaluation.accepted,
            rejected: reviewFailure.evaluation.rejected,
            review: reviewFailure.evaluation.review,
            verdictCount: reviewFailure.evaluation.verdicts.length,
          }
        : undefined,
    };
  }

  const projected: JsonRecord = {
    planId: reviewFailure.planId,
    issues: reviewFailure.issues.map(issue => ({
      severity: issue.severity,
      category: boundString(issue.category, limits.summaryStringLeafChars, 'reviewFailure.issues[].category', notes),
      file: boundString(issue.file, limits.summaryStringLeafChars, 'reviewFailure.issues[].file', notes),
      line: issue.line,
      description: boundString(issue.description, limits.reviewIssueTextChars, 'reviewFailure.issues[].description', notes),
      fix: boundOptionalString(issue.fix, limits.reviewIssueTextChars, 'reviewFailure.issues[].fix', notes),
      retryGuidance: boundOptionalString(issue.retryGuidance, limits.reviewIssueTextChars, 'reviewFailure.issues[].retryGuidance', notes),
      failureKind: issue.failureKind,
      repairClass: issue.repairClass,
      runtimeFailureKind: issue.runtimeFailureKind,
      validationProviderName: issue.validationProviderName,
    })),
  };

  copyDefined(projected, 'evaluation', reviewFailure.evaluation
    ? {
        accepted: reviewFailure.evaluation.accepted,
        rejected: reviewFailure.evaluation.rejected,
        review: reviewFailure.evaluation.review,
        verdicts: reviewFailure.evaluation.verdicts.map(verdict => ({
          file: boundString(verdict.file, limits.summaryStringLeafChars, 'reviewFailure.evaluation.verdicts[].file', notes),
          action: verdict.action,
          reason: boundString(verdict.reason, limits.reviewIssueTextChars, 'reviewFailure.evaluation.verdicts[].reason', notes),
          hunk: verdict.hunk,
          issueOutcome: verdict.issueOutcome,
          retryGuidance: boundOptionalString(verdict.retryGuidance, limits.reviewIssueTextChars, 'reviewFailure.evaluation.verdicts[].retryGuidance', notes),
        })),
      }
    : undefined);
  return projected;
}
// --- eforge:endregion recovery-analyst-summary-projection ---

// --- eforge:region recovery-analyst-emergency-projection-and-utils ---
function buildEmergencySummaryProjection(
  summary: BuildFailureSummary,
  notes: NoteSink,
  budgetChars?: number,
): JsonRecord {
  const projection: JsonRecord = {
    prdId: summary.prdId,
    setName: summary.setName,
    featureBranch: summary.featureBranch,
    baseBranch: summary.baseBranch,
    failedAt: summary.failedAt,
    partial: summary.partial,
    plans: summary.plans.map(plan => ({ planId: plan.planId, status: plan.status })),
    failingPlan: { planId: summary.failingPlan.planId, terminalSubtype: summary.failingPlan.terminalSubtype },
    failingPlans: summary.failingPlans?.map(plan => ({ planId: plan.planId, terminalSubtype: plan.terminalSubtype })),
    terminalFailure: summary.terminalFailure
      ? { scope: summary.terminalFailure.scope, stage: summary.terminalFailure.stage, planId: summary.terminalFailure.planId }
      : undefined,
    acceptanceValidation: summary.acceptanceValidation
      ? {
          passed: summary.acceptanceValidation.passed,
          total: summary.acceptanceValidation.total,
          pass: summary.acceptanceValidation.pass,
          fail: summary.acceptanceValidation.fail,
          unknown: summary.acceptanceValidation.unknown,
        }
      : undefined,
    landing: summary.landing ? { status: summary.landing.status } : undefined,
    modelsUsed: summary.modelsUsed,
    omittedEvidence: ['Large optional recovery evidence omitted to keep prompt input within deterministic budget'],
  };
  notes.add('Large optional recovery evidence was omitted from emergency summary projection; omitted evidence is not proof of absence.');
  projection.contextNotes = [...notes];

  if (budgetChars === undefined || JSON.stringify(projection, null, 2).length <= budgetChars) {
    return projection;
  }

  const boundedNotes = [...notes].slice(0, 8);
  return {
    prdId: summary.prdId,
    setName: summary.setName,
    featureBranch: summary.featureBranch,
    baseBranch: summary.baseBranch,
    failedAt: summary.failedAt,
    plans: summary.plans.map(plan => ({ planId: plan.planId, status: plan.status })),
    failingPlan: { planId: summary.failingPlan.planId },
    failingPlans: summary.failingPlans?.map(plan => ({ planId: plan.planId })),
    terminalFailure: summary.terminalFailure ? { scope: summary.terminalFailure.scope, stage: summary.terminalFailure.stage } : undefined,
    acceptanceValidation: summary.acceptanceValidation
      ? {
          total: summary.acceptanceValidation.total,
          pass: summary.acceptanceValidation.pass,
          fail: summary.acceptanceValidation.fail,
          unknown: summary.acceptanceValidation.unknown,
        }
      : undefined,
    landing: summary.landing ? { status: summary.landing.status } : undefined,
    modelsUsed: summary.modelsUsed,
    contextNotes: boundedNotes,
  };
}

function stringifyEmergencyProjectionWithinBudget(
  projection: JsonRecord,
  budgetChars: number,
  notes: NoteSink,
): string {
  if (budgetChars <= 0) return '';

  const candidate = JSON.parse(JSON.stringify(projection)) as JsonRecord;
  const stringify = (): string => JSON.stringify(candidate, null, 2);
  let json = stringify();
  if (json.length <= budgetChars) return json;

  const omittedEvidence = new Set<string>(Array.isArray(candidate.omittedEvidence) ? candidate.omittedEvidence as string[] : []);
  const addOmission = (message: string): void => {
    omittedEvidence.add(message);
    candidate.omittedEvidence = [...omittedEvidence];
    candidate.contextNotes = [...notes].slice(0, 4);
  };

  for (const key of ['modelsUsed', 'terminalFailure', 'acceptanceValidation', 'landing', 'failedAt', 'baseBranch', 'featureBranch', 'setName']) {
    if (candidate[key] !== undefined) {
      delete candidate[key];
      addOmission(`${key} omitted from emergency recovery summary to fit prompt input budget`);
      json = stringify();
      if (json.length <= budgetChars) return json;
    }
  }

  for (const target of ['plans', 'failingPlans']) {
    const value = candidate[target];
    if (!Array.isArray(value)) continue;
    while (value.length > 0 && stringify().length > budgetChars) {
      value.pop();
      addOmission(`${target} entries omitted from emergency recovery summary to fit prompt input budget`);
    }
    json = stringify();
    if (json.length <= budgetChars) return json;
  }

  const minimalJson = JSON.stringify({
    contextNotes: ['Emergency summary was minimized to fit the recovery analyst input budget; omitted context is missing evidence, not proof of absence.'],
  }, null, 2);
  if (minimalJson.length <= budgetChars) return minimalJson;

  return truncateText(json, budgetChars, 'emergency recovery summary JSON').text;
}

function boundOptionalString(value: string | undefined, maxChars: number, path: string, notes: NoteSink): string | undefined {
  return value === undefined ? undefined : boundString(value, maxChars, path, notes);
}

function boundString(value: string, maxChars: number, path: string, notes: NoteSink): string {
  const result = truncateText(value, maxChars, path);
  if (result.truncated) {
    notes.add(`${path} truncated from ${value.length} chars to ${maxChars} chars.`);
  }
  return result.text;
}

function copyDefined(target: JsonRecord, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
}
// --- eforge:endregion recovery-analyst-emergency-projection-and-utils ---
