export const SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX = 'Shipped evidence: current source — ';
export const SHIPPED_LIFECYCLE_EVIDENCE_PREFIX = 'Shipped evidence: lifecycle trace — ';
export const SHIPPED_GIT_PR_EVIDENCE_PREFIX = 'Shipped evidence: inferred from git/PR history — ';
export const SUPERSEDED_CURRENT_SOURCE_EVIDENCE_PREFIX = 'Superseded evidence: current source — ';
export const SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX = 'Superseded evidence: lifecycle trace — ';
export const SUPERSEDED_GIT_PR_EVIDENCE_PREFIX = 'Superseded evidence: inferred from git/PR history — ';
export const AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX = 'Ambiguous shipped candidate: needs input — ';
export const AMBIGUOUS_SUPERSEDED_EVIDENCE_PREFIX = 'Ambiguous superseded candidate: needs input — ';

const DELTA_CLOSED_STATUS_PREFIXES = {
  shipped: [SHIPPED_LIFECYCLE_EVIDENCE_PREFIX, SHIPPED_GIT_PR_EVIDENCE_PREFIX],
  superseded: [SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX, SUPERSEDED_GIT_PR_EVIDENCE_PREFIX],
} as const;

const SOURCE_FIRST_CLOSED_STATUS_PREFIXES = {
  shipped: [SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX, SHIPPED_LIFECYCLE_EVIDENCE_PREFIX, SHIPPED_GIT_PR_EVIDENCE_PREFIX],
  superseded: [SUPERSEDED_CURRENT_SOURCE_EVIDENCE_PREFIX, SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX, SUPERSEDED_GIT_PR_EVIDENCE_PREFIX],
} as const;

const KNOWN_CLOSED_STATUS_PREFIXES = [
  SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX,
  SHIPPED_LIFECYCLE_EVIDENCE_PREFIX,
  SHIPPED_GIT_PR_EVIDENCE_PREFIX,
  SUPERSEDED_CURRENT_SOURCE_EVIDENCE_PREFIX,
  SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX,
  SUPERSEDED_GIT_PR_EVIDENCE_PREFIX,
  AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX,
  AMBIGUOUS_SUPERSEDED_EVIDENCE_PREFIX,
] as const;

export type EvidencePrefixClosedStatus = keyof typeof DELTA_CLOSED_STATUS_PREFIXES;

export function validateClosedStatusEvidencePrefix(status: string, evidence: readonly string[] | undefined, options: { allowCurrentSource?: boolean } = {}): boolean {
  if (status !== 'shipped' && status !== 'superseded') return true;
  const entries = (evidence ?? []).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return false;
  const allowedPrefixes = options.allowCurrentSource === true ? SOURCE_FIRST_CLOSED_STATUS_PREFIXES[status] : DELTA_CLOSED_STATUS_PREFIXES[status];
  const hasAllowedPrefix = entries.some((entry) => allowedPrefixes.some((prefix) => entry.startsWith(prefix)));
  const hasDisallowedClosedPrefix = entries.some((entry) => KNOWN_CLOSED_STATUS_PREFIXES.some((prefix) => entry.startsWith(prefix)) && !allowedPrefixes.some((prefix) => entry.startsWith(prefix)));
  return hasAllowedPrefix && !hasDisallowedClosedPrefix;
}
