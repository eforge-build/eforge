import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS_NAV } from '../web/lib/nav.js';
import { LLMS_MANIFEST } from '../packages/docs-gen/src/manifest.js';
import { getOutputPaths } from '../packages/docs-gen/src/output-paths.js';

const read = (path: string): string => readFileSync(path, 'utf-8');

const CORE_DOCS = [
  'README.md',
  'web/content/docs/getting-started.md',
  'web/content/docs/concepts.md',
  'web/content/docs/configuration.md',
  'web/content/docs/integrations.md',
] as const;

const GENERIC_EXTENSION_DOCS = [
  'docs/extensions.md',
  'docs/extensions-api.md',
  'web/content/docs/extensions.md',
  'web/content/docs/extensions-api.md',
] as const;

const GENERATOR_SOURCE_DOCS = [
  'packages/docs-gen/src/generators/api.ts',
  'packages/docs-gen/src/generators/tools.ts',
  'packages/docs-gen/src/generators/llms.ts',
] as const;

const FORBIDDEN_PRODUCT_TERMS = [
  'Revise with AI',
  'planRevisionTurn',
  'backlogCurationDraft',
  'annotation revision',
  'backlog curation',
  'recommendation workflow',
] as const;

function stripAllowlistedOptionalLinks(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => {
      const mentionsPlan = /eforge-plan|@eforge-build\/eforge-plan|\/docs\/eforge-plan/.test(line);
      if (!mentionsPlan) return true;
      return !/optional first-party extension|optional extension documentation|first-party extension docs/i.test(line);
    })
    .join('\n');
}

function indexOfFirstOptionalWorkflowSection(markdown: string): number {
  const match = markdown.match(/^## .*?(?:optional|eforge-plan|playbooks?|session plans?).*$/im);
  return match?.index ?? Number.POSITIVE_INFINITY;
}

describe('docs kernel boundary', () => {
  it('keeps core docs framed around the build-engine kernel and normalized build source', () => {
    const combined = CORE_DOCS.map(read).join('\n');
    expect(combined).toContain('build-engine kernel');
    expect(combined).toContain('normalized build source');
    expect(read('web/content/docs/concepts.md')).toMatch(/normalized build-source boundary/i);
    expect(read('web/content/docs/concepts.md')).not.toMatch(/^##\s+Build Sources and Session Plans\s*$/m);
  });

  it('presents direct prompt, PRD, and file builds before optional workflow sections', () => {
    const gettingStarted = read('web/content/docs/getting-started.md');
    const optionalIndex = indexOfFirstOptionalWorkflowSection(gettingStarted);
    for (const snippet of ['/eforge:build', 'eforge build', 'PRD', 'file']) {
      const index = gettingStarted.indexOf(snippet);
      expect(index, `${snippet} should appear before optional workflow sections`).toBeGreaterThanOrEqual(0);
      expect(index, `${snippet} should appear before optional workflow sections`).toBeLessThan(optionalIndex);
    }
  });

  it('keeps eforge-plan product terms out of core docs except allowlisted optional-extension links', () => {
    for (const path of CORE_DOCS) {
      const contents = stripAllowlistedOptionalLinks(read(path));
      for (const term of FORBIDDEN_PRODUCT_TERMS) {
        expect(contents, `${path} should not contain ${term}`).not.toContain(term);
      }
    }
  });

  it('keeps generic extension-platform docs free of eforge-plan product semantics', () => {
    for (const path of GENERIC_EXTENSION_DOCS) {
      const contents = read(path);
      for (const term of FORBIDDEN_PRODUCT_TERMS) {
        expect(contents, `${path} should not contain ${term}`).not.toContain(term);
      }
    }
  });

  it('moves optional first-party eforge-plan product details into extension-owned docs', () => {
    const publicPage = read('web/content/docs/eforge-plan.md');
    const readme = read('eforge/extensions/eforge-plan/README.md');
    for (const contents of [publicPage, readme]) {
      expect(contents).toContain('Revise with AI');
      expect(contents).toContain('planRevisionTurn');
      expect(contents).toContain('backlogCurationDraft');
      expect(contents).toContain('.eforge/storage/extensions/eforge-plan/');
    }
    expect(readme).toMatch(/backlog curation/i);
    expect(readme).toMatch(/recommendations?/i);
    expect(readme).toMatch(/daemon-owned task/i);
  });

  it('splits docs navigation into kernel, optional workflow, extension-platform, and first-party extension groups', () => {
    const groups = new Map<string, string[]>(DOCS_NAV.map((item) => [item.group, []]));
    for (const item of DOCS_NAV) groups.get(item.group)?.push(item.slug);

    expect(groups.get('Core kernel')).toEqual(expect.arrayContaining(['getting-started', 'concepts']));
    expect(groups.get('Optional workflows')).toEqual(expect.arrayContaining(['playbooks']));
    expect(groups.get('Extension platform')).toEqual(expect.arrayContaining(['extensions', 'extensions-api']));
    expect(groups.get('First-party extensions')).toEqual(expect.arrayContaining(['eforge-plan']));
  });

  it('categorizes the LLM manifest across required guide boundaries', () => {
    const categories = [...new Set(LLMS_MANIFEST.guides.map((guide) => guide.category))];
    expect(categories).toEqual(expect.arrayContaining(['core-kernel', 'optional-workflow', 'extension-platform', 'first-party-extension']));

    const byCategory = new Map<string, string[]>();
    for (const guide of LLMS_MANIFEST.guides) {
      expect(guide.category, `${guide.title} should declare a guide category`).toBeTruthy();
      byCategory.set(guide.category ?? 'missing', [...(byCategory.get(guide.category ?? 'missing') ?? []), guide.url]);
    }
    expect(byCategory.get('core-kernel')).toEqual(expect.arrayContaining(['/docs/getting-started.md', '/docs/configuration.md']));
    expect(byCategory.get('optional-workflow')).toEqual(expect.arrayContaining(['/docs/playbooks.md']));
    expect(byCategory.get('extension-platform')).toEqual(expect.arrayContaining(['/docs/extensions.md', '/docs/extensions-api.md']));
    expect(byCategory.get('first-party-extension')).toEqual(expect.arrayContaining(['/docs/eforge-plan.md']));
    expect(LLMS_MANIFEST.summary).toContain('build-engine kernel');
    expect(LLMS_MANIFEST.overview).toContain('normalized build source');
  });

  it('keeps generator source category-aware and mirrors the optional eforge-plan guide without writing generated artifacts', () => {
    const outputPaths = getOutputPaths(process.cwd());
    expect(outputPaths.publicDocsEforgePlan).toMatch(/web\/public\/docs\/eforge-plan\.md$/);

    const llmsGenerator = read('packages/docs-gen/src/generators/llms.ts');
    expect(llmsGenerator).toContain('GUIDE_CATEGORY_HEADINGS');
    expect(llmsGenerator).toContain('publicDocsEforgePlan');
    expect(llmsGenerator).toContain("web', 'content', 'docs', 'eforge-plan.md");

    for (const path of GENERATOR_SOURCE_DOCS) {
      const contents = read(path);
      if (path.endsWith('api.ts')) {
        expect(contents).toContain('sessionPlan` and `sessionPlanSet`');
        expect(contents).toContain('eforge-playbooks');
        expect(contents).toMatch(/generic extension contribution\/action routes|producer surfaces/i);
        expect(contents).toContain('not kernel-owned planning capabilities');
        expect(contents).not.toContain('playbook`, `sessionPlan`');
      }
      if (path.endsWith('tools.ts')) {
        expect(contents).toMatch(/Playbook and session-plan host tools/i);
        expect(contents).toContain('eforge-playbooks');
        expect(contents).toMatch(/optional workflow compatibility|host surfaces/i);
        expect(contents).toContain('not kernel-owned planning capabilities');
        expect(contents).not.toContain('create-from-playbook');
      }
    }
  });
});
