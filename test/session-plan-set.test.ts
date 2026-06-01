/**
 * Tests for the read-only session plan-set protocol in @eforge-build/input.
 *
 * Grouped by behavior:
 *  - Manifest parse/serialize
 *  - Path resolution guards
 *  - List/load (manifest-canonical membership)
 *  - Validation diagnostics
 *  - JSON-safe summaries
 *  - Flat session-plan compatibility (unchanged behavior)
 */
import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  parseSessionPlanSetManifest,
  serializeSessionPlanSetManifest,
  resolveSessionPlanSetChildPath,
  resolveSessionPlanSetDir,
  listSessionPlanSets,
  loadSessionPlanSet,
  validateSessionPlanSet,
  summarizeSessionPlanSet,
  resolveSessionPlanPath,
  listActiveSessionPlans,
  normalizeBuildSource,
  type SessionPlanSetManifest,
} from '@eforge-build/input';
import { useTempDir } from './test-tmpdir.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function manifestYaml(overrides: Partial<{
  id: string;
  status: string;
  strategy: string;
  anchor: string;
  childrenYaml: string;
}> = {}): string {
  const id = overrides.id ?? 'add-search';
  const status = overrides.status ?? 'planning';
  const strategy = overrides.strategy ?? 'dag';
  const anchor = overrides.anchor ?? 'umbrella.md';
  const childrenYaml = overrides.childrenYaml ?? `children:
  - id: plan-01-indexing
    title: Indexing
    file: plans/plan-01-indexing.md
    kind: plan
    buildable: true
    status: planning
    dependsOn: []
`;
  return `id: ${id}
title: Add Search
status: ${status}
strategy: ${strategy}
anchor: ${anchor}
${childrenYaml}`;
}

interface SetupChild {
  id: string;
  file: string;
  kind?: string;
  buildable?: boolean;
  status?: string;
  dependsOn?: string[];
  /** When provided, the child markdown file is written with this content. */
  content?: string;
}

/** Write a plan-set directory with a manifest and (optionally) anchor + child files. */
async function setupPlanSet(opts: {
  cwd: string;
  planSetId: string;
  id?: string;
  anchor?: string | null;
  writeAnchor?: boolean;
  children: SetupChild[];
}): Promise<string> {
  const dir = resolve(opts.cwd, '.eforge', 'session-plans', opts.planSetId);
  await mkdir(dir, { recursive: true });

  const anchorName = opts.anchor === null ? undefined : (opts.anchor ?? 'umbrella.md');

  const childrenLines = opts.children
    .map((c) => {
      const dependsOn = c.dependsOn ?? [];
      const dependsYaml = dependsOn.length > 0
        ? `    dependsOn:\n${dependsOn.map((d) => `      - ${d}`).join('\n')}`
        : '    dependsOn: []';
      return [
        `  - id: ${c.id}`,
        `    title: ${c.id}`,
        `    file: ${c.file}`,
        `    kind: ${c.kind ?? 'plan'}`,
        `    buildable: ${c.buildable ?? true}`,
        `    status: ${c.status ?? 'planning'}`,
        dependsYaml,
      ].join('\n');
    })
    .join('\n');

  const manifestParts = [
    `id: ${opts.id ?? opts.planSetId}`,
    'title: Test Plan Set',
    'status: planning',
    'strategy: dag',
  ];
  if (anchorName !== undefined) manifestParts.push(`anchor: ${anchorName}`);
  manifestParts.push('children:');
  manifestParts.push(childrenLines);

  await writeFile(resolve(dir, 'plan-set.yaml'), manifestParts.join('\n') + '\n', 'utf-8');

  if (anchorName !== undefined && opts.writeAnchor !== false) {
    await writeFile(resolve(dir, anchorName), '# Umbrella\n\nOverview.\n', 'utf-8');
  }

  for (const child of opts.children) {
    if (child.content === undefined) continue;
    const childPath = resolve(dir, child.file);
    await mkdir(resolve(childPath, '..'), { recursive: true });
    await writeFile(childPath, child.content, 'utf-8');
  }

  return dir;
}

// ---------------------------------------------------------------------------
// Manifest parse / serialize
// ---------------------------------------------------------------------------

describe('session plan-set manifest parse/serialize', () => {
  it('parses a valid manifest with defaults for omitted arrays', () => {
    const manifest = parseSessionPlanSetManifest(manifestYaml());
    expect(manifest.id).toBe('add-search');
    expect(manifest.strategy).toBe('dag');
    expect(manifest.externalRefs).toEqual([]);
    expect(manifest.children).toHaveLength(1);
    expect(manifest.children[0].dependsOn).toEqual([]);
    expect(manifest.children[0].externalRefs).toEqual([]);
  });

  it('round-trips through parse', () => {
    const manifest = parseSessionPlanSetManifest(manifestYaml());
    const serialized = serializeSessionPlanSetManifest(manifest);
    const reparsed = parseSessionPlanSetManifest(serialized);
    expect(reparsed).toEqual(manifest);
  });

  it('throws on invalid plan-set status', () => {
    expect(() => parseSessionPlanSetManifest(manifestYaml({ status: 'bogus' }))).toThrow(
      /Invalid session plan-set manifest:/,
    );
  });

  it('throws on invalid child kind', () => {
    const childrenYaml = `children:
  - id: plan-01
    title: One
    file: plans/plan-01.md
    kind: bogus
    buildable: true
    status: planning
`;
    expect(() => parseSessionPlanSetManifest(manifestYaml({ childrenYaml }))).toThrow(
      /Invalid session plan-set manifest:/,
    );
  });

  it('throws on invalid child status', () => {
    const childrenYaml = `children:
  - id: plan-01
    title: One
    file: plans/plan-01.md
    kind: plan
    buildable: true
    status: bogus
`;
    expect(() => parseSessionPlanSetManifest(manifestYaml({ childrenYaml }))).toThrow(
      /Invalid session plan-set manifest:/,
    );
  });

  it('throws on malformed YAML', () => {
    expect(() => parseSessionPlanSetManifest('id: [unclosed\n')).toThrow(
      /Invalid session plan-set manifest YAML:/,
    );
  });

  it('serializes external refs and profile in canonical order', () => {
    const manifest: SessionPlanSetManifest = parseSessionPlanSetManifest(`id: s
title: S
status: planning
strategy: dag
children:
  - id: plan-01
    title: One
    file: plans/plan-01.md
    kind: plan
    buildable: true
    status: planning
    profile: excursion
    dependsOn: []
    externalRefs:
      - kind: issue
        ref: ABC-123
externalRefs:
  - kind: doc
    ref: spec
`);
    const serialized = serializeSessionPlanSetManifest(manifest);
    expect(parseSessionPlanSetManifest(serialized)).toEqual(manifest);
    expect(serialized).toContain('profile: excursion');
  });
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('session plan-set path resolution', () => {
  const cwd = '/project';

  it('rejects a plan-set id containing /', () => {
    expect(() => resolveSessionPlanSetDir({ cwd, planSetId: 'a/b' })).toThrow();
  });

  it('rejects a plan-set id containing \\', () => {
    expect(() => resolveSessionPlanSetDir({ cwd, planSetId: 'a\\b' })).toThrow();
  });

  it('rejects an absolute child path', () => {
    expect(() =>
      resolveSessionPlanSetChildPath({ cwd, planSetId: 'set', childFile: '/etc/passwd.md' }),
    ).toThrow();
  });

  it('rejects a child path with ..', () => {
    expect(() =>
      resolveSessionPlanSetChildPath({ cwd, planSetId: 'set', childFile: '../escape.md' }),
    ).toThrow();
  });

  it('rejects a child path with .', () => {
    expect(() =>
      resolveSessionPlanSetChildPath({ cwd, planSetId: 'set', childFile: './plan.md' }),
    ).toThrow();
  });

  it('rejects a child path with an empty segment', () => {
    expect(() =>
      resolveSessionPlanSetChildPath({ cwd, planSetId: 'set', childFile: 'plans//plan.md' }),
    ).toThrow();
  });

  it('rejects a child path with \\', () => {
    expect(() =>
      resolveSessionPlanSetChildPath({ cwd, planSetId: 'set', childFile: 'plans\\plan.md' }),
    ).toThrow();
  });

  it('rejects a non-markdown child path', () => {
    expect(() =>
      resolveSessionPlanSetChildPath({ cwd, planSetId: 'set', childFile: 'plans/plan.txt' }),
    ).toThrow();
  });

  it('resolves a valid plans/plan-01.md under the plan-set directory', () => {
    const dir = resolveSessionPlanSetDir({ cwd, planSetId: 'set' });
    const childPath = resolveSessionPlanSetChildPath({ cwd, planSetId: 'set', childFile: 'plans/plan-01.md' });
    expect(childPath.startsWith(dir)).toBe(true);
    expect(childPath.endsWith('plans/plan-01.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// List / load
// ---------------------------------------------------------------------------

describe('session plan-set list/load', () => {
  const makeTempDir = useTempDir('eforge-plan-set-');

  it('lists directories with a valid manifest, sorted by manifest id', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({ cwd, planSetId: 'zeta', id: 'zeta-set', children: [{ id: 'plan-01', file: 'plans/plan-01.md', content: '# One\n' }] });
    await setupPlanSet({ cwd, planSetId: 'alpha', id: 'alpha-set', children: [{ id: 'plan-01', file: 'plans/plan-01.md', content: '# One\n' }] });

    const list = await listSessionPlanSets({ cwd });
    expect(list.map((e) => e.id)).toEqual(['alpha-set', 'zeta-set']);
  });

  it('skips flat .md files in .eforge/session-plans/', async () => {
    const cwd = makeTempDir();
    const root = resolve(cwd, '.eforge', 'session-plans');
    await mkdir(root, { recursive: true });
    await writeFile(resolve(root, 'flat-plan.md'), '# flat\n', 'utf-8');
    await setupPlanSet({ cwd, planSetId: 'alpha', id: 'alpha-set', children: [{ id: 'plan-01', file: 'plans/plan-01.md', content: '# One\n' }] });

    const list = await listSessionPlanSets({ cwd });
    expect(list.map((e) => e.id)).toEqual(['alpha-set']);
  });

  it('skips directories without plan-set.yaml', async () => {
    const cwd = makeTempDir();
    const root = resolve(cwd, '.eforge', 'session-plans');
    await mkdir(resolve(root, 'not-a-set'), { recursive: true });
    await writeFile(resolve(root, 'not-a-set', 'readme.md'), '# nope\n', 'utf-8');
    await setupPlanSet({ cwd, planSetId: 'alpha', id: 'alpha-set', children: [{ id: 'plan-01', file: 'plans/plan-01.md', content: '# One\n' }] });

    const list = await listSessionPlanSets({ cwd });
    expect(list.map((e) => e.id)).toEqual(['alpha-set']);
  });

  it('returns [] when the session-plans root does not exist', async () => {
    const cwd = makeTempDir();
    expect(await listSessionPlanSets({ cwd })).toEqual([]);
  });

  it('skips a valid manifest in a non-loadable (non-slug) directory name', async () => {
    const cwd = makeTempDir();
    // A directory whose name is not a lower-case slug holds an otherwise valid
    // manifest. loadSessionPlanSet would reject the directory name, so it must
    // not be listed (else Console lists a set that 400s when selected).
    await setupPlanSet({ cwd, planSetId: 'Not_A_Slug', id: 'valid-set', children: [{ id: 'plan-01', file: 'plans/plan-01.md', content: '# One\n' }] });
    await setupPlanSet({ cwd, planSetId: 'alpha', id: 'alpha-set', children: [{ id: 'plan-01', file: 'plans/plan-01.md', content: '# One\n' }] });

    const list = await listSessionPlanSets({ cwd });
    expect(list.map((e) => e.planSetId)).toEqual(['alpha']);
  });

  it('loads manifest fields, umbrella content, and child metadata in manifest order', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'add-search',
      id: 'add-search',
      children: [
        { id: 'plan-02', file: 'plans/plan-02.md', content: '# Two\n' },
        { id: 'plan-01', file: 'plans/plan-01.md', content: '---\nfoo: bar\n---\n# One\n' },
      ],
    });

    const result = await loadSessionPlanSet({ cwd, planSetId: 'add-search' });
    expect(result.manifest.id).toBe('add-search');
    expect(result.anchor?.exists).toBe(true);
    expect(result.anchor?.content).toContain('Overview');
    expect(result.children.map((c) => c.child.id)).toEqual(['plan-02', 'plan-01']);
    expect(result.children[0].exists).toBe(true);
    expect(result.children[1].frontmatter).toEqual({ foo: 'bar' });
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('session plan-set validation', () => {
  const makeTempDir = useTempDir('eforge-plan-set-validate-');

  it('reports duplicate-child-id', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'set',
      children: [
        { id: 'plan-01', file: 'plans/a.md', content: '# A\n' },
        { id: 'plan-01', file: 'plans/b.md', content: '# B\n' },
      ],
    });
    const { diagnostics } = await validateSessionPlanSet({ cwd, planSetId: 'set' });
    expect(diagnostics.some((d) => d.code === 'duplicate-child-id')).toBe(true);
  });

  it('reports duplicate-child-file', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'set',
      children: [
        { id: 'plan-01', file: 'plans/a.md', content: '# A\n' },
        { id: 'plan-02', file: 'plans/a.md', content: '# A\n' },
      ],
    });
    const { diagnostics } = await validateSessionPlanSet({ cwd, planSetId: 'set' });
    expect(diagnostics.some((d) => d.code === 'duplicate-child-file')).toBe(true);
  });

  it('reports unknown-child-dependency', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'set',
      children: [
        { id: 'plan-01', file: 'plans/a.md', dependsOn: ['ghost'], content: '# A\n' },
      ],
    });
    const { diagnostics } = await validateSessionPlanSet({ cwd, planSetId: 'set' });
    const diag = diagnostics.find((d) => d.code === 'unknown-child-dependency');
    expect(diag?.dependency).toBe('ghost');
  });

  it('reports missing-anchor', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'set',
      writeAnchor: false,
      children: [{ id: 'plan-01', file: 'plans/a.md', content: '# A\n' }],
    });
    const { diagnostics } = await validateSessionPlanSet({ cwd, planSetId: 'set' });
    expect(diagnostics.some((d) => d.code === 'missing-anchor')).toBe(true);
  });

  it('reports missing-child-file', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'set',
      children: [{ id: 'plan-01', file: 'plans/a.md' }],
    });
    const { diagnostics } = await validateSessionPlanSet({ cwd, planSetId: 'set' });
    expect(diagnostics.some((d) => d.code === 'missing-child-file')).toBe(true);
  });

  it('reports child-frontmatter-parse-error without throwing the whole run', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'set',
      children: [{ id: 'plan-01', file: 'plans/a.md', content: '---\nfoo: [unclosed\n---\n# A\n' }],
    });
    const { diagnostics } = await validateSessionPlanSet({ cwd, planSetId: 'set' });
    expect(diagnostics.some((d) => d.code === 'child-frontmatter-parse-error')).toBe(true);
  });

  it('returns ok with no diagnostics for a clean plan set', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'set',
      children: [{ id: 'plan-01', file: 'plans/a.md', content: '# A\n' }],
    });
    const { ok, diagnostics } = await validateSessionPlanSet({ cwd, planSetId: 'set' });
    expect(ok).toBe(true);
    expect(diagnostics).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// JSON-safe summaries
// ---------------------------------------------------------------------------

describe('session plan-set summary', () => {
  const makeTempDir = useTempDir('eforge-plan-set-summary-');

  it('survives JSON.stringify/parse with required fields retained', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'set',
      children: [
        { id: 'plan-01', file: 'plans/a.md', content: '# A\n' },
        { id: 'plan-02', file: 'plans/b.md', dependsOn: ['plan-01'], content: '# B\n' },
      ],
    });
    const load = await loadSessionPlanSet({ cwd, planSetId: 'set' });
    const { diagnostics } = await validateSessionPlanSet({ cwd, planSetId: 'set' });
    const summary = summarizeSessionPlanSet(load, diagnostics);

    const json = JSON.stringify(summary);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe('set');
    expect(parsed.children.map((c: { id: string }) => c.id)).toEqual(['plan-01', 'plan-02']);
    expect(parsed.children[1].dependsOn).toEqual(['plan-01']);
    expect(parsed.anchor.exists).toBe(true);
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
  });

  it('preserves manifest and child externalRefs through JSON.stringify/parse', async () => {
    const cwd = makeTempDir();
    const dir = resolve(cwd, '.eforge', 'session-plans', 'set');
    await mkdir(resolve(dir, 'plans'), { recursive: true });
    await writeFile(resolve(dir, 'umbrella.md'), '# U\n', 'utf-8');
    await writeFile(resolve(dir, 'plans', 'a.md'), '# A\n', 'utf-8');
    await writeFile(
      resolve(dir, 'plan-set.yaml'),
      `id: set
title: Set
status: planning
strategy: dag
anchor: umbrella.md
externalRefs:
  - kind: doc
    ref: spec-123
children:
  - id: plan-01
    title: One
    file: plans/a.md
    kind: plan
    buildable: true
    status: planning
    dependsOn: []
    externalRefs:
      - kind: issue
        ref: ABC-1
`,
      'utf-8',
    );

    const load = await loadSessionPlanSet({ cwd, planSetId: 'set' });
    const { diagnostics } = await validateSessionPlanSet({ cwd, planSetId: 'set' });
    const summary = summarizeSessionPlanSet(load, diagnostics);
    const parsed = JSON.parse(JSON.stringify(summary));
    expect(parsed.externalRefs).toEqual([{ kind: 'doc', ref: 'spec-123' }]);
    expect(parsed.children[0].externalRefs).toEqual([{ kind: 'issue', ref: 'ABC-1' }]);
  });

  it('exposes diagnostic codes in the summary', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'set',
      children: [{ id: 'plan-01', file: 'plans/a.md', dependsOn: ['ghost'], content: '# A\n' }],
    });
    const load = await loadSessionPlanSet({ cwd, planSetId: 'set' });
    const { diagnostics } = await validateSessionPlanSet({ cwd, planSetId: 'set' });
    const summary = summarizeSessionPlanSet(load, diagnostics);
    const parsed = JSON.parse(JSON.stringify(summary));
    expect(parsed.diagnostics.map((d: { code: string }) => d.code)).toContain('unknown-child-dependency');
  });

  it('derives a per-child validation summary from the set diagnostics', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'set',
      children: [
        // plan-01 is clean; plan-02 depends on a non-existent child id.
        { id: 'plan-01', file: 'plans/a.md', content: '# A\n' },
        { id: 'plan-02', file: 'plans/b.md', dependsOn: ['ghost'], content: '# B\n' },
      ],
    });
    const { summary } = await validateSessionPlanSet({ cwd, planSetId: 'set' });
    const byId = Object.fromEntries(summary.children.map((c) => [c.id, c.validation]));
    expect(byId['plan-01']).toEqual({ ok: true, diagnosticCount: 0 });
    expect(byId['plan-02']).toEqual({ ok: false, diagnosticCount: 1 });
  });
});

// ---------------------------------------------------------------------------
// Flat session-plan compatibility (unchanged behavior)
// ---------------------------------------------------------------------------

describe('flat session-plan compatibility', () => {
  const makeTempDir = useTempDir('eforge-plan-set-compat-');

  it('resolveSessionPlanPath still rejects / and \\ session ids', () => {
    expect(() => resolveSessionPlanPath({ cwd: '/project', session: 'a/b' })).toThrow();
    expect(() => resolveSessionPlanPath({ cwd: '/project', session: 'a\\b' })).toThrow();
  });

  it('listActiveSessionPlans ignores a plan-set directory and returns only flat plans', async () => {
    const cwd = makeTempDir();
    const root = resolve(cwd, '.eforge', 'session-plans');
    await mkdir(root, { recursive: true });
    await writeFile(
      resolve(root, 'flat.md'),
      `---
session: flat
topic: Flat Plan
status: planning
planning_type: feature
planning_depth: focused
required_dimensions: []
optional_dimensions: []
skipped_dimensions: []
open_questions: []
profile: null
---

# Flat Plan
`,
      'utf-8',
    );
    await setupPlanSet({ cwd, planSetId: 'set', children: [{ id: 'plan-01', file: 'plans/a.md', content: '# A\n' }] });

    const active = await listActiveSessionPlans({ cwd });
    expect(active.map((e) => e.session)).toEqual(['flat']);
  });

  it('normalizeBuildSource passes a nested plan-set child path through unchanged', () => {
    const sourcePath = '/project/.eforge/session-plans/add-search/plans/plan-01.md';
    const content = '# Plan 01\n\nDo the thing.\n';
    const result = normalizeBuildSource({ sourcePath, content });
    expect(result.sourcePath).toBe(sourcePath);
    expect(result.content).toBe(content);
  });
});
