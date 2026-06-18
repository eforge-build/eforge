import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const README = 'eforge/extensions/eforge-plan/README.md';
const WORKSTATION_README = 'eforge/extensions/eforge-plan/workstation-src/plans/README.md';

async function docs(): Promise<{ readme: string; workstation: string }> {
  const [readme, workstation] = await Promise.all([
    readFile(README, 'utf-8'),
    readFile(WORKSTATION_README, 'utf-8'),
  ]);
  return { readme, workstation };
}

describe('plan-06 docs validation contract', () => {
  it('keeps accepted-analysis baseline documentation private and distinct from recommendations', async () => {
    const { readme } = await docs();

    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/analysis-baseline/current.json');
    expect(readme).toMatch(/accepted-analysis baseline when one has been recorded after a successful accepted backlog-curation apply or preserved recommendation-refresh apply with a source fingerprint/);
    expect(readme).toMatch(/Manual `put-recommendations` writes update recommendation freshness only and do not create an accepted-analysis git baseline/);
    expect(readme).toMatch(/Baseline metadata is not encoded into backlog item or epic bodies, recommendation model JSON, or legacy `\.backlog\/recommendations\.json`/);
    expect(readme).not.toMatch(/\.backlog\/recommendations\.json` stores|legacy `\.backlog\/recommendations\.json` stores/);
  });

  it('documents fallback git-delta coverage as diagnostics rather than complete coverage', async () => {
    const { readme, workstation } = await docs();
    const combined = `${readme}\n${workstation}`;

    for (const diagnostic of [
      'baseline-missing',
      'baseline-invalid-sidecar',
      'baseline-unreachable',
      'baseline-shallow',
      'git-unavailable',
      'git-command-failed',
      'scan-cap-truncated',
      'pr-enrichment-unavailable',
    ]) {
      expect(combined).toContain(diagnostic);
    }
    expect(combined).toMatch(/fallback or unavailable coverage(,| labels| states)/);
    expect(combined).toMatch(/not complete git-delta coverage/);
    expect(combined).not.toMatch(/missing[^.]*baseline[^.]*are complete git-delta coverage/i);
  });

  it('keeps workstation documentation server-authoritative for overlay and freshness display', async () => {
    const { workstation } = await docs();

    expect(workstation).toMatch(/Backlog curation preview and apply data is server-authoritative/);
    expect(workstation).toMatch(/`recommendationProjection` — the prospective overlay used by both preview and apply validation/);
    expect(workstation).toMatch(/`recommendationProjection\.effectiveRecommendations` \/ `effectiveRecommendations` display counts/);
    expect(workstation).toMatch(/Show `recommendationFreshness` labels exactly as returned: `missing`, `fresh`, or `stale`/);
    expect(workstation).toMatch(/A recommendation model being present is not enough to show fresh/);
    expect(workstation).not.toMatch(/same-draft recommendation filtering|infer fresh from recommendations/i);
  });
});
