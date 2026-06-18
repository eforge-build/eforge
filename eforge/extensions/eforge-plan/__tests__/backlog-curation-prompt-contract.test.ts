import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX, AMBIGUOUS_SUPERSEDED_EVIDENCE_PREFIX, SHIPPED_GIT_PR_EVIDENCE_PREFIX, SHIPPED_LIFECYCLE_EVIDENCE_PREFIX, SUPERSEDED_GIT_PR_EVIDENCE_PREFIX, SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX } from '../backlog-curation-evidence-prefixes.js';

const PROMPT_PATH = join(process.cwd(), 'packages/engine/src/prompts/eforge-plan-planning-draft.md');

describe('backlog curation prompt evidence contract', () => {
  it('names git-delta candidates, exact closure prefixes, ambiguous prefixes, and no-inventing evidence guidance', async () => {
    const prompt = await readFile(PROMPT_PATH, 'utf-8');

    expect(prompt).toContain('source.gitDelta.affectedItemCandidates');
    expect(prompt).toMatch(/do not invent evidence/i);
    expect(prompt).toContain(SHIPPED_LIFECYCLE_EVIDENCE_PREFIX);
    expect(prompt).toContain(SHIPPED_GIT_PR_EVIDENCE_PREFIX);
    expect(prompt).toContain(SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX);
    expect(prompt).toContain(SUPERSEDED_GIT_PR_EVIDENCE_PREFIX);
    expect(prompt).toContain(AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX);
    expect(prompt).toContain(AMBIGUOUS_SUPERSEDED_EVIDENCE_PREFIX);
    expect(prompt).toMatch(/Never convert ambiguous shipped or ambiguous superseded evidence into a closed-status patch/i);
    expect(prompt).toMatch(/never substitute a shipped prefix for superseded evidence or a superseded prefix for shipped evidence/i);
  });
});
