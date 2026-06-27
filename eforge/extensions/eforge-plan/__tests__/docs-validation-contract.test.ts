import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const README = 'eforge/extensions/eforge-plan/README.md';
const WORKSTATION_README = 'eforge/extensions/eforge-plan/workstation-src/plans/README.md';
// --- eforge:region plan-02-agent-docs-and-guidance ---
const WEB_CONTENT_DOCS = 'web/content/docs/eforge-plan.md';
const WEB_PUBLIC_DOCS = 'web/public/docs/eforge-plan.md';
// --- eforge:endregion plan-02-agent-docs-and-guidance ---

async function docs(): Promise<{ readme: string; workstation: string }> {
  const [readme, workstation] = await Promise.all([
    readFile(README, 'utf-8'),
    readFile(WORKSTATION_README, 'utf-8'),
  ]);
  return { readme, workstation };
}

// --- eforge:region plan-02-agent-docs-and-guidance ---
async function webDocs(): Promise<{ content: string; publicDocs: string }> {
  const [content, publicDocs] = await Promise.all([
    readFile(WEB_CONTENT_DOCS, 'utf-8'),
    readFile(WEB_PUBLIC_DOCS, 'utf-8'),
  ]);
  return { content, publicDocs };
}
// --- eforge:endregion plan-02-agent-docs-and-guidance ---

describe('plan-03 workstation docs validation contract', () => {
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

  // --- eforge:region plan-02-agent-docs-and-guidance ---
  it('summarizes body-safe update-item and Markdown mirror boundaries in public docs', async () => {
    const { content, publicDocs } = await webDocs();

    for (const document of [content, publicDocs]) {
      expect(document).toMatch(/body-safe[\s\S]*update-item|update-item[\s\S]*body-safe/i);
      expect(document).toMatch(/get-item[\s\S]*(bodySha256|lock token)[\s\S]*expectedBodySha256|expectedBodySha256[\s\S]*get-item/i);
      expect(document).toMatch(/metadata-only[\s\S]*(preserve|without changing)[\s\S]*body[\s\S]*(without|no)[\s\S]*lock/i);
      expect(document).toMatch(/sections[\s\S]*sectionOperations|sectionOperations[\s\S]*sections/);
      expect(document).toMatch(/Markdown mirrors?[\s\S]*(compatibility|import|not.*normal mutation|not.*normal edit)/i);
      expect(document).toMatch(/\.backlog\/items|\.eforge\/storage\/extensions\/eforge-plan\/backlog\/items/);
    }
  });
  // --- eforge:endregion plan-02-agent-docs-and-guidance ---


  it('keeps workstation documentation server-authoritative for overlay and freshness display', async () => {
    const { readme, workstation } = await docs();

    expect(readme).not.toContain('scanMode');
    expect(readme).not.toContain('full-implementation-audit');
    expect(readme).toContain('`analyze-all-backlog` example input: `{}`');
    expect(readme).toMatch(/audits open backlog items against current source/);
    expect(readme).toMatch(/current source is the closure authority/);
    expect(readme).toMatch(/history is a navigation hint|git\/PR\/lifecycle\/session history as navigation hints/);
    expect(workstation).toMatch(/Backlog curation preview and apply data is server-authoritative/);
    expect(workstation).toMatch(/`recommendationProjection` — the prospective overlay used by both preview and apply validation/);
    expect(workstation).toMatch(/`recommendationProjection\.effectiveRecommendations` \/ `effectiveRecommendations` display counts and expandable details/);
    expect(workstation).toMatch(/Show `recommendationFreshness` labels exactly as returned: `missing`, `fresh`, or `stale`/);
    expect(workstation).toMatch(/A recommendation model being present is not enough to show fresh/);
    expect(workstation).toMatch(/primary \*\*Analyze backlog\*\* button plus optional help/);
    expect(workstation).toMatch(/The browser must not run local git, PR, or source searches/);
    expect(workstation).not.toMatch(/same-draft recommendation filtering|infer fresh from recommendations/i);
  });
});
