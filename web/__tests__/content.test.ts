import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadDocPage, loadReferencePage } from '../lib/content.js';
import { DOCS_NAV } from '../lib/nav.js';

const expectedDocSlugs = [
  'getting-started',
  'concepts',
  'configuration',
  'extensions',
  'extensions-api',
  'glossary',
  'profiles',
  'playbooks',
  'integrations',
  'stacking',
  'troubleshooting',
];
const newGuideSlugs = ['profiles', 'playbooks', 'integrations', 'stacking', 'troubleshooting'];
const docsContentDir = join(process.cwd(), 'web/content/docs');
const publicDocsDir = join(process.cwd(), 'web/public/docs');
const referenceContentDir = join(process.cwd(), 'web/content/reference');
const publicReferenceDir = join(process.cwd(), 'web/public/reference');

function readGuide(slug: string): string {
  return readFileSync(join(docsContentDir, `${slug}.md`), 'utf-8');
}

function readReference(slug: string): string {
  return readFileSync(join(referenceContentDir, `${slug}.md`), 'utf-8');
}

function listMarkdownSlugs(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.replace(/\.md$/, ''))
    .sort();
}

function stripFencedCodeBlocks(markdown: string): string {
  const lines = markdown.split('\n');
  let inFence = false;
  return lines
    .filter((line) => {
      if (/^```/.test(line.trim())) {
        inFence = !inFence;
        return false;
      }
      return !inFence;
    })
    .join('\n');
}

function markdownHeadingLevels(markdown: string): number[] {
  return stripFencedCodeBlocks(markdown)
    .split('\n')
    .map((line) => line.match(/^(#{1,6})\s+/)?.[1].length)
    .filter((level): level is number => level !== undefined);
}

describe('loadDocPage', () => {
  it('returns non-empty HTML for known doc slugs', async () => {
    for (const slug of expectedDocSlugs) {
      const page = await loadDocPage(slug);
      expect(page.html, `Expected HTML for slug "${slug}"`).toBeTruthy();
      expect(page.html.length, `Expected non-empty HTML for slug "${slug}"`).toBeGreaterThan(0);
    }
  });

  it('throws a typed error for unknown doc slugs', async () => {
    await expect(loadDocPage('nonexistent-page-xyz')).rejects.toThrow('Page not found: nonexistent-page-xyz');
  });

  it('applies syntax highlighting to TypeScript fenced blocks', async () => {
    const page = await loadDocPage('extensions');
    // rehype-pretty-code emits data-language attribute on the pre/code element
    expect(page.html).toMatch(/data-language="ts"/);
    // At least one token span should have inline Shiki theme styles (dual-theme uses CSS custom properties)
    expect(page.html).toMatch(/style="[^"]*--shiki-light:/);
  });

  it('still renders plain Markdown headings and paragraphs', async () => {
    const page = await loadDocPage('getting-started');
    expect(page.html).toMatch(/<h1[\s>]/);
    expect(page.html).toMatch(/<p[\s>]/);
  });

  it('adds stable heading IDs to rendered docs pages', async () => {
    const page = await loadDocPage('extensions');
    expect(page.html).toContain('id="event-patterns"');
    expect(page.html).toContain('id="trust-and-security"');
  });

  it('keeps docs navigation aligned to the complete public guide set', () => {
    const sourceSlugs = listMarkdownSlugs(docsContentDir);
    const publicSlugs = listMarkdownSlugs(publicDocsDir);
    const navSlugs = DOCS_NAV.map((item) => item.slug).sort();

    expect(sourceSlugs).toEqual([...expectedDocSlugs].sort());
    expect(publicSlugs).toEqual(sourceSlugs);
    expect(navSlugs).toEqual(sourceSlugs);
    for (const item of DOCS_NAV) {
      expect(item.title, `Expected title for ${item.slug}`).toBeTruthy();
      expect(item.group, `Expected group for ${item.slug}`).toBeTruthy();
    }
  });

  it('keeps new guide pages discoverable and structured', async () => {
    for (const slug of newGuideSlugs) {
      const page = await loadDocPage(slug);
      const raw = readGuide(slug);
      expect(page.frontmatter.title, `Expected title frontmatter for ${slug}`).toEqual(expect.any(String));
      expect(page.frontmatter.description, `Expected description frontmatter for ${slug}`).toEqual(expect.any(String));
      expect(stripFencedCodeBlocks(raw), `Expected at least one level-two heading in ${slug}`).toMatch(/^##\s+/m);
      expect(existsSync(join(publicDocsDir, `${slug}.md`)), `Expected generated public docs mirror for ${slug}`).toBe(true);
    }
  });

  it('keeps every public guide mirrored and structurally valid', async () => {
    for (const slug of expectedDocSlugs) {
      const source = readGuide(slug);
      const mirrorPath = join(publicDocsDir, `${slug}.md`);
      const page = await loadDocPage(slug);
      const markdownOutsideCode = stripFencedCodeBlocks(source);

      expect(page.frontmatter.title, `Expected title frontmatter for ${slug}`).toEqual(expect.any(String));
      expect(page.frontmatter.description, `Expected description frontmatter for ${slug}`).toEqual(expect.any(String));
      const headingLevels = markdownHeadingLevels(source);
      expect(markdownOutsideCode.match(/^#\s+/gm) ?? [], `Expected exactly one h1 heading in ${slug}`).toHaveLength(1);
      expect(markdownOutsideCode.match(/^##\s+/gm) ?? [], `Expected at least one h2 heading in ${slug}`).not.toHaveLength(0);
      expect(headingLevels[0], `Expected ${slug} to start its document outline with h1`).toBe(1);
      expect(headingLevels.slice(1), `Expected ${slug} to use h2 sections after its h1`).toContain(2);
      expect(existsSync(mirrorPath), `Expected generated public docs mirror for ${slug}`).toBe(true);
      expect(readFileSync(mirrorPath, 'utf-8'), `Expected ${mirrorPath} to mirror web/content/docs/${slug}.md`).toBe(source);
    }
  });

  it('keeps the named public docs journeys covered by concrete user-facing content', () => {
    const journeySnippets: Record<string, string[]> = {
      'getting-started': ['Pi package', 'Claude Code plugin', 'npx @eforge-build/eforge build', '--profile <name>'],
      concepts: ['build source', 'agent runtime profile', 'queue', 'artifact branch', '/reference/cli.md'],
      configuration: [
        '~/.config/eforge/config.yaml',
        'eforge/config.yaml',
        '.eforge/config.yaml',
        'Workflow Presets',
        'Guided Toolbelt Presets',
      ],
      profiles: ['.eforge/profiles/', 'eforge/profiles/', '~/.config/eforge/profiles/', 'eforge build --profile'],
      playbooks: ['mode: autonomous', 'mode: planning', 'eforge playbook run', 'eforge playbook promote'],
      extensions: ['eforge extension install', 'trust', 'onEvent', 'registerInputSource', 'registerAction', 'fetchExtensionContributionManifest', 'not sandboxed'],
      'extensions-api': ['defineExtension', 'EventPattern', 'defineExtensionTool', 'registerConsoleContribution', 'Runtime support status'],
      integrations: [
        'Claude Code plugin',
        'Pi extension',
        'standalone CLI',
        'eforge_extension_contribution',
        '/eforge:extensions',
        '/eforge:workflow',
        '/eforge:stack:sync',
        'daemon HTTP API',
        'Langfuse',
      ],
      stacking: ['/eforge:workflow', '/eforge:stack', '/eforge:stack:sync', 'eforge stack sync', '--dry-run'],
      troubleshooting: [
        'eforge daemon status',
        'pnpm docs:check',
        'auto-build',
        'Stack sync',
        'recovery',
        'extension:policy:decision',
      ],
    };

    for (const [slug, snippets] of Object.entries(journeySnippets)) {
      const raw = readGuide(slug).toLowerCase();
      for (const snippet of snippets) {
        expect(raw, `Expected ${slug} guide to cover ${snippet}`).toContain(snippet.toLowerCase());
      }
    }
  });

  it('documents workflow presets and stack sync host surfaces', () => {
    const configuration = readGuide('configuration');
    const integrations = readGuide('integrations');
    const stacking = readGuide('stacking');
    const troubleshooting = readGuide('troubleshooting');

    const presetConfigMappings: Record<string, string[]> = {
      'solo-merge': ['landing.action: merge', 'build.allowLocalMergeToTrunk: true', 'stacking.enabled: false'],
      'solo-pr': ['landing.action: pr', 'landing.pr.autoMerge: always', 'stacking.enabled: false'],
      'team-pr': ['landing.action: pr', 'landing.pr.autoMerge: ask', 'stacking.enabled: false'],
      'stacked-pr': ['landing.action: pr', 'stacking.enabled: true'],
      'stacked-pr-autosync': ['landing.action: pr', 'stacking.enabled: true', 'stacking.sync.afterBuild: true'],
    };

    for (const [preset, configKeys] of Object.entries(presetConfigMappings)) {
      expect(configuration, `Expected configuration guide to mention workflow preset ${preset}`).toContain(preset);
      for (const configKey of configKeys) {
        expect(configuration, `Expected workflow preset ${preset} to map to ${configKey}`).toContain(configKey);
      }
    }

    for (const command of [
      '/eforge:workflow',
      '/eforge:stack',
      '/eforge:workflow:init',
      '/eforge:workflow:reconfigure',
      '/eforge:stack:sync',
      'eforge stack sync',
      'eforge stack sync --dry-run',
      'stacked-pr-autosync',
      'stacking.sync.afterBuild: true',
    ]) {
      expect(integrations, `Expected integrations guide to mention ${command}`).toContain(command);
    }

    for (const snippet of [
      '/eforge:workflow',
      '/eforge:stack',
      '/eforge:stack:sync',
      'eforge stack sync',
      '--dry-run',
      'stacked-pr-autosync',
      'stacking.sync.afterBuild: true',
    ]) {
      expect(stacking, `Expected stacking guide to mention ${snippet}`).toContain(snippet);
    }

    for (const snippet of [
      'Skipped sync because stacking is disabled',
      'git-spice missing or uninitialized',
      'Local trunk not fast-forwardable',
      'Active-build skips',
      'stacking.sync.afterBuild: true',
      'after-build sync',
      'Conflict recovery',
    ]) {
      expect(troubleshooting, `Expected troubleshooting guide to cover ${snippet}`).toContain(snippet);
    }

    const stalePostMergeWording = 'appends `eforge stack sync` to `build.postMergeCommands`';
    for (const [guideName, guide] of Object.entries({ configuration, integrations, stacking, troubleshooting })) {
      expect(guide, `Expected ${guideName} guide to avoid stale stack sync wording`).not.toContain(stalePostMergeWording);
    }
  });

  it('covers task-oriented troubleshooting remedies', () => {
    const raw = readGuide('troubleshooting');
    const expectedSnippets = [
      'eforge daemon status',
      'eforge daemon stop',
      'eforge daemon kill',
      'pnpm docs:generate',
      'pnpm docs:check',
      'eforge queue list',
      '/eforge:recover',
      'eforge_apply_recovery',
      'eforge extension trust <name>',
      'queue:profile:invalid-selection',
      'eforge extension show <router-extension-name>',
      'Queue lock files',
      'maxValidationRetries',
      'require-approval',
      'extension:policy:decision',
      'eforge stack sync --dry-run',
      'fastForward',
      'git-spice --version',
      'git-spice repo init',
      'stacking.gitSpice.command',
      'git status',
      'git add <resolved-files>',
      'git rebase --continue',
      'git-spice equivalent',
      'Conflict recovery',
    ];
    for (const snippet of expectedSnippets) {
      expect(raw, `Expected troubleshooting remedy to mention ${snippet}`).toContain(snippet);
    }
  });

  it('documents profile and playbook scope precedence and user commands', () => {
    const profiles = readGuide('profiles');
    const playbooks = readGuide('playbooks');

    for (const snippet of [
      '.eforge/profiles/',
      'eforge/profiles/',
      '~/.config/eforge/profiles/',
      '/eforge:profile-new',
      '/eforge:profile <name>',
      'eforge build --profile',
      'no standalone `promote` or `demote` profile commands today',
    ]) {
      expect(profiles, `Expected profiles guide to mention ${snippet}`).toContain(snippet);
    }

    for (const snippet of [
      '~/.config/eforge/playbooks/',
      'eforge/playbooks/',
      '.eforge/playbooks/',
      '/eforge:playbook create',
      '/eforge:playbook run',
      '/eforge:playbook list',
      'eforge playbook new',
      'eforge playbook run',
      'eforge playbook promote',
      'eforge playbook demote',
    ]) {
      expect(playbooks, `Expected playbooks guide to mention ${snippet}`).toContain(snippet);
    }
  });
});

describe('loadReferencePage', () => {
  it('returns non-empty HTML for known reference slugs', async () => {
    const slugs = ['cli', 'api', 'events', 'config', 'tools'];
    for (const slug of slugs) {
      const page = await loadReferencePage(slug);
      expect(page.html, `Expected HTML for slug "${slug}"`).toBeTruthy();
      expect(page.html.length, `Expected non-empty HTML for slug "${slug}"`).toBeGreaterThan(0);
    }
  });

  it('throws a typed error for unknown reference slugs', async () => {
    await expect(loadReferencePage('nonexistent-reference-xyz')).rejects.toThrow(
      'Page not found: nonexistent-reference-xyz',
    );
  });

  it('strips provenance HTML comments from rendered html and surfaces them separately', async () => {
    // cli.md has <!-- Generated file. Do not edit. --> provenance headers
    const page = await loadReferencePage('cli');
    // The provenance comments should not appear in html output
    expect(page.html).not.toContain('<!-- Generated file');
    expect(page.html).not.toContain('<!-- eforge version');
    // But they should be in the provenance field
    expect(page.provenance).toBeTruthy();
    expect(page.provenance).toContain('<!--');
  });

  it('adds stable heading IDs to rendered reference pages', async () => {
    const page = await loadReferencePage('config');
    expect(page.html).toContain('id="toolbelts"');
    expect(page.html).toContain('id="hooks"');
  });

  it('exposes workflow and stack skills in generated tools references', () => {
    const expectedRows = ['| `workflow` | `eforge-workflow` |', '| `stack` | `eforge-stack` |'];
    const contentTools = readReference('tools');
    const publicTools = readFileSync(join(publicReferenceDir, 'tools.md'), 'utf-8');

    for (const row of expectedRows) {
      expect(contentTools, `Expected content tools reference to include ${row}`).toContain(row);
      expect(publicTools, `Expected public tools reference to include ${row}`).toContain(row);
    }
  });
});
