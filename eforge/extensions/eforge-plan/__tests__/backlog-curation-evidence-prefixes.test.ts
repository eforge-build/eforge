import { describe, expect, it } from 'vitest';
import { AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX, AMBIGUOUS_SUPERSEDED_EVIDENCE_PREFIX, SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX, SHIPPED_GIT_PR_EVIDENCE_PREFIX, SHIPPED_LIFECYCLE_EVIDENCE_PREFIX, SUPERSEDED_CURRENT_SOURCE_EVIDENCE_PREFIX, SUPERSEDED_GIT_PR_EVIDENCE_PREFIX, SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX, validateClosedStatusEvidencePrefix } from '../backlog-curation-evidence-prefixes.js';

describe('backlog curation evidence prefixes', () => {
  it('accepts status-specific shipped and superseded prefixes', () => {
    expect(validateClosedStatusEvidencePrefix('shipped', [`${SHIPPED_LIFECYCLE_EVIDENCE_PREFIX}trace`])).toBe(true);
    expect(validateClosedStatusEvidencePrefix('shipped', [`${SHIPPED_GIT_PR_EVIDENCE_PREFIX}git`])).toBe(true);
    expect(validateClosedStatusEvidencePrefix('superseded', [`${SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX}trace`])).toBe(true);
    expect(validateClosedStatusEvidencePrefix('superseded', [`${SUPERSEDED_GIT_PR_EVIDENCE_PREFIX}git`])).toBe(true);
  });

  it('rejects opposite, current-source, ambiguous, missing, and blank evidence for closed statuses by default', () => {
    expect(validateClosedStatusEvidencePrefix('shipped', [`${SUPERSEDED_GIT_PR_EVIDENCE_PREFIX}git`])).toBe(false);
    expect(validateClosedStatusEvidencePrefix('superseded', [`${SHIPPED_GIT_PR_EVIDENCE_PREFIX}git`])).toBe(false);
    expect(validateClosedStatusEvidencePrefix('shipped', [`${SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX}src/widget.ts`])).toBe(false);
    expect(validateClosedStatusEvidencePrefix('superseded', [`${SUPERSEDED_CURRENT_SOURCE_EVIDENCE_PREFIX}src/widget.ts`])).toBe(false);
    expect(validateClosedStatusEvidencePrefix('shipped', [`${AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX}ask`])).toBe(false);
    expect(validateClosedStatusEvidencePrefix('superseded', undefined)).toBe(false);
    expect(validateClosedStatusEvidencePrefix('shipped', ['  '])).toBe(false);
  });

  it('allows current-source prefixes only when source-first validation opts in', () => {
    expect(validateClosedStatusEvidencePrefix('shipped', [`${SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX}src/widget.ts`], { allowCurrentSource: true })).toBe(true);
    expect(validateClosedStatusEvidencePrefix('superseded', [`${SUPERSEDED_CURRENT_SOURCE_EVIDENCE_PREFIX}src/widget.ts`], { allowCurrentSource: true })).toBe(true);
  });

  it('rejects mixed valid plus ambiguous or opposite closure evidence', () => {
    expect(validateClosedStatusEvidencePrefix('shipped', [`${SHIPPED_GIT_PR_EVIDENCE_PREFIX}git`, `${AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX}ask`])).toBe(false);
    expect(validateClosedStatusEvidencePrefix('shipped', [`${SHIPPED_GIT_PR_EVIDENCE_PREFIX}git`, `${SUPERSEDED_GIT_PR_EVIDENCE_PREFIX}git`])).toBe(false);
    expect(validateClosedStatusEvidencePrefix('superseded', [`${SUPERSEDED_GIT_PR_EVIDENCE_PREFIX}git`, `${AMBIGUOUS_SUPERSEDED_EVIDENCE_PREFIX}ask`])).toBe(false);
    expect(validateClosedStatusEvidencePrefix('superseded', [`${SUPERSEDED_GIT_PR_EVIDENCE_PREFIX}git`, `${SHIPPED_GIT_PR_EVIDENCE_PREFIX}git`])).toBe(false);
  });

  it('does not require prefixes for stale status validation', () => {
    expect(validateClosedStatusEvidencePrefix('stale', ['Durable but non-closure evidence.'])).toBe(true);
  });
});
