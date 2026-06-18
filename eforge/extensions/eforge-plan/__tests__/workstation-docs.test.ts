import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const WORKSTATION_README = 'eforge/extensions/eforge-plan/workstation-src/plans/README.md';

async function readDocs(): Promise<string> {
  return readFile(WORKSTATION_README, 'utf-8');
}

describe('eforge-plan workstation developer docs contract', () => {
  it('documents server-authoritative curation preview fields and projection display', async () => {
    const text = await readDocs();

    for (const required of [
      'gitDelta',
      'recommendationProjection',
      'effectiveRecommendations',
      'recommendationFreshness',
      'generatedRecommendationValidation',
      'removed targets',
      'repositioned targets',
      'wrong-lane',
    ]) {
      expect(text).toContain(required);
    }
    expect(text).toMatch(/server-authoritative/i);
    expect(text).toMatch(/prospective overlay used by both preview and apply validation/i);
  });

  it('forbids local git, gh, overlay, and freshness recomputation', async () => {
    const text = await readDocs();

    expect(text).toMatch(/does not .*run local `git` commands/i);
    expect(text).toMatch(/does not .*call `gh`/i);
    expect(text).toMatch(/does not .*recompute the recommendation overlay/i);
    expect(text).toMatch(/does not .*infer recommendation freshness from the presence of a recommendation model/i);
    expect(text).toMatch(/Do not locally replay backlog mutations or locally filter generated recommendations/i);
    expect(text).not.toMatch(/run git log|exec\(['"]git|gh pr view|filter generated recommendations locally/i);
  });

  it('documents curation-only visibility, freshness labels, ambiguous labels, fixtures, and commands', async () => {
    const text = await readDocs();

    expect(text).toMatch(/curation-only apply .*discards generated recommendations.*unfresh/is);
    for (const label of ['missing', 'fresh', 'stale']) expect(text).toContain(label);
    expect(text).toContain('Ambiguous shipped candidate: needs input');
    expect(text).toContain('Ambiguous superseded candidate: needs input');
    expect(text).toMatch(/Mock bridge and fixtures/i);
    expect(text).toContain('src/bridge.ts');
    expect(text).toContain('src/fixtures/mock-data.ts');
    expect(text).toContain('pnpm test -- eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts');
    expect(text).toContain('pnpm --filter @eforge-build/eforge-plan-workstation test');
  });

  it('keeps bridge and fixture docs aligned with server-shaped curation previews', async () => {
    const text = await readDocs();

    expect(text).toMatch(/Fixtures that exercise curation preview must include server-shaped `gitDelta`, `recommendationProjection`, `effectiveRecommendations`, `recommendationFreshness`, `generatedRecommendationValidation`, removed targets, repositioned targets, `wrong-lane` validation, and ambiguous shipped\/superseded needs-input labels/);
    expect(text).toMatch(/Mock behavior should model the server contract/);
    expect(text).toMatch(/rather than adding local git scanning, `gh` enrichment, overlay recomputation, or freshness inference/);
  });
});
