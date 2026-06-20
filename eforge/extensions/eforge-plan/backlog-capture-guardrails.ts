// --- eforge:region capture-readiness-guardrails ---
export interface BacklogCaptureReadinessInput {
  title: string;
  claim: string;
  acceptanceCriteria?: string;
  tags?: readonly string[];
}

interface ExploratorySignal {
  label: string;
  pattern: RegExp;
}

const EXPLORATORY_LANGUAGE: readonly ExploratorySignal[] = [
  { label: 'explore/exploration', pattern: /\bexplor(?:e|es|ed|ing|ation|atory)\b/i },
  { label: 'revisit', pattern: /\brevisit(?:s|ed|ing)?\b/i },
  { label: 'research', pattern: /\bresearch(?:es|ed|ing)?\b/i },
  { label: 'investigate', pattern: /\binvestigat(?:e|es|ed|ing|ion)\b/i },
  { label: 'evaluate', pattern: /\bevaluat(?:e|es|ed|ing|ion)\b/i },
  { label: 'assess', pattern: /\bassess(?:es|ed|ing|ment)?\b/i },
  { label: 'spike', pattern: /\bspike\b/i },
  { label: 'discover', pattern: /\bdiscover(?:s|ed|ing|y)?\b/i },
  { label: 'decide whether/if/how', pattern: /\bdecide\s+(?:whether|if|how)\b/i },
  { label: 'figure out', pattern: /\bfigure\s+out\b/i },
  { label: 'whether', pattern: /\bwhether\b/i },
  { label: 'future/deferred', pattern: /\b(?:future|deferred|later-stage|on the radar)\b/i },
];

const ACTIONABLE_VERB = /\b(?:add|allow|build|change|create|document|enable|enforce|expose|fix|harden|implement|improve|introduce|make|migrate|prevent|provide|remove|replace|require|ship|simplify|support|update|validate|wire)\b/i;

export function formatCaptureReadinessMessage(issues: readonly string[]): string {
  return [
    'Backlog item is not session-plan-ready.',
    ...issues.map((issue) => `- ${issue}`),
    'Do the exploration before capture, then capture the chosen implementation change with concrete acceptance criteria.',
  ].join('\n');
}

export function captureReadinessIssues(input: BacklogCaptureReadinessInput): string[] {
  const issues: string[] = [];
  const acceptanceCriteria = input.acceptanceCriteria?.trim() ?? '';
  if (acceptanceCriteria.length === 0) {
    issues.push('Acceptance criteria are required.');
  }
  if (acceptanceCriteria.length > 0 && isPlaceholderAcceptanceCriteria(acceptanceCriteria)) {
    issues.push('Acceptance criteria must be concrete and verifiable, not placeholder guidance.');
  }

  for (const [field, text] of [
    ['title', input.title],
    ['claim', input.claim],
    ['acceptanceCriteria', acceptanceCriteria],
  ] as const) {
    const signals = exploratorySignals(text);
    if (signals.length > 0) issues.push(`${field} contains exploratory language (${signals.join(', ')}).`);
  }

  const exploratoryTags = (input.tags ?? []).filter((tag) => exploratorySignals(tag).length > 0);
  if (exploratoryTags.length > 0) issues.push(`tags mark the item as exploratory (${exploratoryTags.join(', ')}).`);

  if (!ACTIONABLE_VERB.test(input.title) && !ACTIONABLE_VERB.test(input.claim)) {
    issues.push('Title or claim should state the implementation change, not only a topic or question.');
  }
  return issues;
}

function exploratorySignals(text: string): string[] {
  return EXPLORATORY_LANGUAGE.filter((signal) => signal.pattern.test(text)).map((signal) => signal.label);
}

function isPlaceholderAcceptanceCriteria(text: string): boolean {
  return /missing acceptance criteria|add concrete|before build handoff/i.test(text);
}
// --- eforge:endregion capture-readiness-guardrails ---
