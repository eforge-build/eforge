import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { enqueuePrd, getCompiledResumeFrontmatter, inferTitle, loadQueue, validatePrdFrontmatter } from '@eforge-build/engine/prd-queue';
import { useTempDir } from './test-tmpdir.js';

// --- inferTitle ---

describe('inferTitle', () => {
  it('extracts title from first H1 heading', () => {
    expect(inferTitle('# My Feature\n\nSome content')).toBe('My Feature');
  });

  it('extracts title from H1 heading not at start of content', () => {
    expect(inferTitle('Some preamble\n\n# The Real Title\n\nBody')).toBe('The Real Title');
  });

  it('falls back to deslugified fallback slug', () => {
    expect(inferTitle('No heading here', 'my-cool-feature')).toBe('My Cool Feature');
  });

  it('strips .md from fallback slug', () => {
    expect(inferTitle('No heading', 'my-feature.md')).toBe('My Feature');
  });

  it('returns default when no heading and no fallback', () => {
    expect(inferTitle('Just some text')).toBe('Untitled PRD');
  });

  it('prefers heading over fallback slug', () => {
    expect(inferTitle('# Heading Title', 'fallback-slug')).toBe('Heading Title');
  });
});

describe('compiled resume frontmatter', () => {
  it('accepts and extracts complete compiled-resume metadata', () => {
    const result = validatePrdFrontmatter({
      title: 'Resume PRD',
      resume_mode: 'compiled',
      resume_from: 'failed-prd',
      resume_set_name: 'failed-set',
      resume_feature_branch: 'eforge/failed-set',
      resume_base_branch: 'main',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(getCompiledResumeFrontmatter(result.data)).toEqual({
        mode: 'compiled',
        sourcePrdId: 'failed-prd',
        setName: 'failed-set',
        featureBranch: 'eforge/failed-set',
        baseBranch: 'main',
      });
    }
  });

  it('returns undefined for absent fields and lists missing keys for partial metadata', () => {
    const absent = validatePrdFrontmatter({ title: 'Ordinary PRD' });
    expect(absent.success).toBe(true);
    if (absent.success) expect(getCompiledResumeFrontmatter(absent.data)).toBeUndefined();

    const partial = validatePrdFrontmatter({ title: 'Partial Resume', resume_from: 'failed-prd' });
    expect(partial.success).toBe(true);
    if (partial.success) {
      expect(() => getCompiledResumeFrontmatter(partial.data)).toThrow(/resume_mode.*resume_set_name.*resume_feature_branch.*resume_base_branch/);
    }
  });
});

// --- enqueuePrd ---

describe('enqueuePrd', () => {
  const makeTempDir = useTempDir('eforge-enqueue-test-');

  it('writes a PRD file with correct frontmatter', async () => {
    const cwd = makeTempDir();
    const result = await enqueuePrd({
      body: '## Problem\n\nSomething is broken.',
      title: 'Fix the Widget',
      queueDir: 'queue',
      cwd,
    });

    expect(result.id).toBe('fix-the-widget');
    expect(result.filePath).toBe(join(cwd, 'queue', 'fix-the-widget.md'));
    expect(result.frontmatter.title).toBe('Fix the Widget');
    expect(result.frontmatter.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const content = readFileSync(result.filePath, 'utf-8');
    expect(content).toContain('title: Fix the Widget');
    expect(content).not.toContain('status:');
    expect(content).toContain('## Problem');
    expect(content).toContain('Something is broken.');
  });

  it('generates slug from title', async () => {
    const cwd = makeTempDir();
    const result = await enqueuePrd({
      body: 'body',
      title: 'My Feature',
      queueDir: 'queue',
      cwd,
    });

    expect(result.id).toBe('my-feature');
    expect(basename(result.filePath)).toBe('my-feature.md');
  });

  it('handles duplicate slugs with -2, -3 suffixes', async () => {
    const cwd = makeTempDir();
    const queueDir = join(cwd, 'queue');
    mkdirSync(queueDir, { recursive: true });
    writeFileSync(join(queueDir, 'my-feature.md'), '---\ntitle: My Feature\n---\n\nexisting');

    const result1 = await enqueuePrd({
      body: 'second',
      title: 'My Feature',
      queueDir: 'queue',
      cwd,
    });
    expect(result1.id).toBe('my-feature-2');

    const result2 = await enqueuePrd({
      body: 'third',
      title: 'My Feature',
      queueDir: 'queue',
      cwd,
    });
    expect(result2.id).toBe('my-feature-3');
  });

  it('auto-creates queue directory', async () => {
    const cwd = makeTempDir();
    const result = await enqueuePrd({
      body: 'body',
      title: 'New PRD',
      queueDir: 'nested/queue/dir',
      cwd,
    });

    expect(result.filePath).toBe(join(cwd, 'nested', 'queue', 'dir', 'new-prd.md'));
    const content = readFileSync(result.filePath, 'utf-8');
    expect(content).toContain('title: New PRD');
  });

  it('preserves priority in frontmatter', async () => {
    const cwd = makeTempDir();
    const result = await enqueuePrd({
      body: 'body',
      title: 'High Priority',
      queueDir: 'queue',
      cwd,
      priority: 1,
    });

    expect(result.frontmatter.priority).toBe(1);
    const content = readFileSync(result.filePath, 'utf-8');
    expect(content).toContain('priority: 1');
  });

  it('preserves depends_on in frontmatter', async () => {
    const cwd = makeTempDir();
    const result = await enqueuePrd({
      body: 'body',
      title: 'Dependent PRD',
      queueDir: 'queue',
      cwd,
      depends_on: ['auth', 'database'],
    });

    expect(result.frontmatter.depends_on).toEqual(['auth', 'database']);
    const content = readFileSync(result.filePath, 'utf-8');
    expect(content).toContain('depends_on: ["auth", "database"]');
  });

  it('handles special characters in title for slug', async () => {
    const cwd = makeTempDir();
    const result = await enqueuePrd({
      body: 'body',
      title: 'Add OAuth 2.0 & SSO!',
      queueDir: 'queue',
      cwd,
    });

    expect(result.id).toBe('add-oauth-2-0-sso');
  });

  it('quotes titles that would break YAML plain scalars and round-trips them', async () => {
    const cwd = makeTempDir();
    const titles = [
      'fix: intake extraction', // ": " starts a nested mapping in strict YAML
      '[intake] rewrite PRD sources', // leading "[" parses as a flow sequence
      '1.5', // full numeric token resolves as a float
      'true', // resolves as a boolean
    ];

    for (const title of titles) {
      const result = await enqueuePrd({ body: 'body', title, queueDir: 'queue', cwd });
      const content = readFileSync(result.filePath, 'utf-8');
      expect(content).toContain(`title: ${JSON.stringify(title)}`);
    }

    const queued = await loadQueue('queue', cwd);
    expect(queued.map((prd) => prd.frontmatter.title).sort()).toEqual([...titles].sort());
  });

  it('leaves safe plain titles unquoted', async () => {
    const cwd = makeTempDir();
    const result = await enqueuePrd({ body: 'body', title: '2026 Widget Fix v2.0', queueDir: 'queue', cwd });
    expect(readFileSync(result.filePath, 'utf-8')).toContain('title: 2026 Widget Fix v2.0\n');
  });

  it('sets created to today ISO date', async () => {
    const cwd = makeTempDir();
    const result = await enqueuePrd({
      body: 'body',
      title: 'Test',
      queueDir: 'queue',
      cwd,
    });

    const today = new Date().toISOString().split('T')[0];
    expect(result.frontmatter.created).toBe(today);
  });

  it('does NOT create a git commit — queue is filesystem-only', async () => {
    const cwd = makeTempDir();
    // Set up a minimal git repo
    execFileSync('git', ['init'], { cwd });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
    // Add .gitignore so .eforge/ is ignored
    writeFileSync(join(cwd, '.gitignore'), '.eforge/\n');
    execFileSync('git', ['add', '.gitignore'], { cwd });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd });

    const initialHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim();

    const result = await enqueuePrd({
      body: 'body',
      title: 'Queue Test',
      queueDir: '.eforge/queue',
      cwd,
    });

    // No new commit should have been created
    const currentHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim();
    expect(currentHash).toBe(initialHash);

    // Queue file exists at the configured path
    expect(existsSync(result.filePath)).toBe(true);
    expect(result.filePath).toBe(join(cwd, '.eforge', 'queue', 'queue-test.md'));

    // Git status shows nothing for the queue dir (gitignored)
    const gitStatus = execFileSync('git', ['status', '--porcelain', '.eforge/queue/'], { cwd }).toString().trim();
    expect(gitStatus).toBe('');
  });
});
