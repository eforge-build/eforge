import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanupPlanFiles } from '@eforge-build/engine/cleanup';
import {
  stripTemporaryEforgeRegionMarkerLines,
  stripTemporaryEforgeRegionMarkers,
} from '@eforge-build/engine/region-marker-cleanup';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { useTempDir } from './test-tmpdir.js';

function markerToken(kind: 'region' | 'endregion'): string {
  return 'eforge:' + kind;
}

function temporarySlug(suffix = 'temporary'): string {
  return 'plan-' + `01-${suffix}`;
}

function lineMarker(kind: 'region' | 'endregion', slug = temporarySlug()): string {
  return `// --- ${markerToken(kind)} ${slug} ---`;
}

function jsxMarker(kind: 'region' | 'endregion', slug = temporarySlug()): string {
  return `{/* --- ${markerToken(kind)} ${slug} --- */}`;
}

function setupGitRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });
}

function commitAll(dir: string, message: string): void {
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', message], { cwd: dir, stdio: 'ignore' });
}

function writePlanFile(dir: string, planSet: string, outputDir = 'eforge/plans'): string {
  const planDir = join(dir, outputDir, planSet);
  mkdirSync(planDir, { recursive: true });
  const planPath = join(planDir, 'plan-01.md');
  writeFileSync(planPath, '# Plan 01\n', 'utf8');
  return planPath;
}

async function collectCleanupEvents(dir: string, planSet: string, outputDir = 'eforge/plans'): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of cleanupPlanFiles(dir, planSet, outputDir)) {
    events.push(event);
  }
  return events;
}

describe('stripTemporaryEforgeRegionMarkerLines', () => {
  it('removes whole-line temporary line-comment markers and preserves enclosed code bytes', () => {
    const codeLine = 'export const value = 42;';
    const content = [
      'const before = true;',
      lineMarker('region'),
      codeLine,
      lineMarker('endregion'),
      'const after = true;',
    ].join('\n') + '\n';

    const stripped = stripTemporaryEforgeRegionMarkerLines(content);

    expect(stripped).toBe(['const before = true;', codeLine, 'const after = true;'].join('\n') + '\n');
  });

  it('removes whole-line temporary JSX markers and keeps JSX content', () => {
    const content = [
      'export function Component() {',
      '  return (',
      '    <section>',
      `      ${jsxMarker('region')}`,
      '      <span>kept</span>',
      `      ${jsxMarker('endregion')}`,
      '    </section>',
      '  );',
      '}',
    ].join('\n') + '\n';

    const stripped = stripTemporaryEforgeRegionMarkerLines(content);

    expect(stripped).not.toContain(temporarySlug());
    expect(stripped).toContain('      <span>kept</span>\n');
  });

  it('preserves semantic marker slugs and inline marker text', () => {
    const semanticSlug = 'semantic-section';
    const content = [
      lineMarker('region', semanticSlug),
      'export const semantic = true;',
      lineMarker('endregion', semanticSlug),
      `const inline = true; ${lineMarker('region')}`,
      `const stringValue = "${lineMarker('endregion')}";`,
    ].join('\n') + '\n';

    const stripped = stripTemporaryEforgeRegionMarkerLines(content);

    expect(stripped).toBe(content);
  });

  it('preserves marker-looking lines inside template strings', () => {
    const content = [
      'const text = `',
      lineMarker('region'),
      'literal content',
      lineMarker('endregion'),
      '`;',
      lineMarker('region'),
      'export const kept = true;',
      lineMarker('endregion'),
    ].join('\n') + '\n';

    const stripped = stripTemporaryEforgeRegionMarkerLines(content);

    expect(stripped).toBe(
      ['const text = `', lineMarker('region'), 'literal content', lineMarker('endregion'), '`;', 'export const kept = true;'].join(
        '\n',
      ) + '\n',
    );
  });
});

describe('stripTemporaryEforgeRegionMarkers', () => {
  const makeTempDir = useTempDir('eforge-marker-cleanup-');

  it('rewrites and stages tracked source files with temporary markers only', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'src', 'tracked.ts'),
      [lineMarker('region'), 'export const kept = true;', lineMarker('endregion')].join('\n') + '\n',
      'utf8',
    );
    commitAll(dir, 'add tracked source');
    writeFileSync(
      join(dir, 'scratch.ts'),
      [lineMarker('region'), 'export const untracked = true;', lineMarker('endregion')].join('\n') + '\n',
      'utf8',
    );

    const summary = await stripTemporaryEforgeRegionMarkers(dir);

    expect(summary).toMatchObject({ filesScanned: 1, filesChanged: 1, markersRemoved: 2 });
    expect(summary.changedFiles).toEqual(['src/tracked.ts']);
    expect(readFileSync(join(dir, 'src', 'tracked.ts'), 'utf8')).toBe('export const kept = true;\n');
    expect(readFileSync(join(dir, 'scratch.ts'), 'utf8')).toContain(temporarySlug());

    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir }).toString().trim();
    expect(staged).toBe('src/tracked.ts');
  });

  it('removes temporary JSX markers while preserving semantic markers', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    const semanticSlug = 'durable-ui-section';
    writeFileSync(
      join(dir, 'src', 'Component.tsx'),
      [
        'export function Component() {',
        '  return (',
        '    <main>',
        `      ${jsxMarker('region')}`,
        '      <strong>kept</strong>',
        `      ${jsxMarker('endregion')}`,
        `      ${jsxMarker('region', semanticSlug)}`,
        '      <em>semantic</em>',
        `      ${jsxMarker('endregion', semanticSlug)}`,
        '    </main>',
        '  );',
        '}',
      ].join('\n') + '\n',
      'utf8',
    );
    commitAll(dir, 'add component');

    const summary = await stripTemporaryEforgeRegionMarkers(dir);
    const rewritten = readFileSync(join(dir, 'src', 'Component.tsx'), 'utf8');

    expect(summary.markersRemoved).toBe(2);
    expect(rewritten).not.toContain(temporarySlug());
    expect(rewritten).toContain(jsxMarker('region', semanticSlug));
    expect(rewritten).toContain('      <strong>kept</strong>\n');
  });

  it('skips tracked source symlinks without rewriting their targets', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    const targetPath = join(dir, '..', 'external-symlink-target.ts');
    const targetContent = [lineMarker('region'), 'export const external = true;', lineMarker('endregion')].join('\n') + '\n';
    writeFileSync(targetPath, targetContent, 'utf8');
    symlinkSync(targetPath, join(dir, 'src', 'linked.ts'));
    commitAll(dir, 'add tracked source symlink');

    const summary = await stripTemporaryEforgeRegionMarkers(dir);

    expect(summary).toMatchObject({ filesScanned: 1, filesChanged: 0, markersRemoved: 0 });
    expect(summary.changedFiles).toEqual([]);
    expect(readFileSync(targetPath, 'utf8')).toBe(targetContent);
    const status = execFileSync('git', ['status', '--short'], { cwd: dir }).toString().trim();
    expect(status).toBe('');
  });

  it('scans tracked source extensions and skips generated or non-source paths', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'dist'), { recursive: true });
    const sourceContent = [lineMarker('region'), 'export const kept = true;', lineMarker('endregion')].join('\n') + '\n';
    const generatedContent = [lineMarker('region'), 'export const generated = true;', lineMarker('endregion')].join('\n') + '\n';
    const markdownContent = [lineMarker('region'), '# Generated docs', lineMarker('endregion')].join('\n') + '\n';
    writeFileSync(join(dir, 'src', 'tracked.js'), sourceContent, 'utf8');
    writeFileSync(join(dir, 'dist', 'generated.ts'), generatedContent, 'utf8');
    writeFileSync(join(dir, 'README.md'), markdownContent, 'utf8');
    commitAll(dir, 'add tracked source and skipped files');

    const summary = await stripTemporaryEforgeRegionMarkers(dir);

    expect(summary).toMatchObject({ filesScanned: 1, filesChanged: 1, markersRemoved: 2 });
    expect(summary.changedFiles).toEqual(['src/tracked.js']);
    expect(readFileSync(join(dir, 'src', 'tracked.js'), 'utf8')).toBe('export const kept = true;\n');
    expect(readFileSync(join(dir, 'dist', 'generated.ts'), 'utf8')).toBe(generatedContent);
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe(markdownContent);
  });
});

describe('cleanupPlanFiles temporary marker integration', () => {
  const makeTempDir = useTempDir('eforge-cleanup-marker-integration-');

  it('commits plan deletion and source marker removal while preserving semantic markers and enclosed code', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    writePlanFile(dir, 'my-plan-set');
    mkdirSync(join(dir, 'src'), { recursive: true });
    const semanticSlug = 'durable-domain-section';
    writeFileSync(
      join(dir, 'src', 'shared.ts'),
      [
        lineMarker('region'),
        'export const keptBetweenMarkers = true;',
        lineMarker('endregion'),
        lineMarker('region', semanticSlug),
        'export const semantic = true;',
        lineMarker('endregion', semanticSlug),
      ].join('\n') + '\n',
      'utf8',
    );
    commitAll(dir, 'add plan and shared source');

    const events = await collectCleanupEvents(dir, 'my-plan-set');
    const rewritten = readFileSync(join(dir, 'src', 'shared.ts'), 'utf8');

    expect(events.map((event) => event.type)).toContain('cleanup:start');
    expect(events.at(-1)?.type).toBe('cleanup:complete');
    expect(existsSync(join(dir, 'eforge', 'plans', 'my-plan-set', 'plan-01.md'))).toBe(false);
    expect(rewritten).not.toContain(temporarySlug());
    expect(rewritten).toContain('export const keptBetweenMarkers = true;\n');
    expect(rewritten).toContain(lineMarker('region', semanticSlug));

    const nameStatus = execFileSync('git', ['show', '--name-status', '--format=', 'HEAD'], { cwd: dir }).toString();
    expect(nameStatus).toContain('D\teforge/plans/my-plan-set/plan-01.md');
    expect(nameStatus).toContain('M\tsrc/shared.ts');
  });

  it('emits paired cleanup events while skipping a dangling tracked source symlink', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    writePlanFile(dir, 'my-plan-set');
    mkdirSync(join(dir, 'src'), { recursive: true });
    symlinkSync('missing-target.ts', join(dir, 'src', 'dangling.ts'));
    commitAll(dir, 'add plan and dangling source symlink');

    const events = await collectCleanupEvents(dir, 'my-plan-set');

    expect(events[0]?.type).toBe('cleanup:start');
    expect(events.at(-1)?.type).toBe('cleanup:complete');
    const progress = events.find((event) => event.type === 'planning:progress');
    expect(progress).toBeUndefined();
  });
});
