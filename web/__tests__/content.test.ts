import { existsSync, readFileSync } from 'node:fs';
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
  'troubleshooting',
];
const newGuideSlugs = ['profiles', 'playbooks', 'integrations', 'troubleshooting'];
const docsContentDir = join(process.cwd(), 'web/content/docs');
const publicDocsDir = join(process.cwd(), 'web/public/docs');

function readGuide(slug: string): string {
  return readFileSync(join(docsContentDir, `${slug}.md`), 'utf-8');
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

  it('keeps docs navigation aligned to the public guide set', () => {
    expect(DOCS_NAV.map((item) => item.slug).sort()).toEqual([...expectedDocSlugs].sort());
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
      expect(raw, `Expected at least one level-two heading in ${slug}`).toMatch(/^##\s+/m);
      expect(existsSync(join(publicDocsDir, `${slug}.md`)), `Expected generated public docs mirror for ${slug}`).toBe(true);
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
});
