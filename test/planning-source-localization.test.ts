import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { derivePlanningAtomGraph, deriveRepositoryIndex, deriveSourceInventory, deriveSourceLocalization, deriveSourceLocalizationNeeds, type SourceLocalizationBundle } from '@eforge-build/engine/planner-compiler';
import { createPlanningTempWorkspace, type PlanningTempWorkspace } from './helpers/planning-temp-workspace.js';

const execFileAsync = promisify(execFile);
const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 3, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');
const workspaces: PlanningTempWorkspace[] = [];

afterEach(async () => { await Promise.all(workspaces.splice(0).map((workspace) => workspace.cleanup())); });

function prd(criteria: string[]): string {
  return ['# Source Localization', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

async function workspace(files: Record<string, string>, options: { git?: boolean } = {}): Promise<PlanningTempWorkspace> {
  const created = await createPlanningTempWorkspace(files, options);
  workspaces.push(created);
  return created;
}

describe('planning source localization foundation', () => {
  it('does not infer command surfaces from client substrings', () => {
    const content = prd(['Client updates events.']);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const needs = deriveSourceLocalizationNeeds({ inventory });

    expect(inventory.criteria[0].interfaceKeys).not.toContain('command-surface');
    expect(needs.some((item) => item.kind === 'command')).toBe(false);
  });

  it('derives a stable repository index with generic excludes and generated artifact filtering', async () => {
    const temp = await workspace({
      'modules/alpha/src/main.ts': 'export const kept = true;',
      'node_modules/pkg/index.js': 'ignored',
      'dist/bundle.js': 'ignored',
      'build/out.js': 'ignored',
      'coverage/report.json': '{}',
      '.cache/state.json': '{}',
      '.eforge/state.json': '{}',
      '.decomposition/output.json': '{}',
      'notes/planner-inspection-handoff.json': '{}',
      'notes/output.json': '{}',
      'notes/graph.json': '{}',
      'notes/orchestration.yaml': 'ignored',
    });

    const index = await deriveRepositoryIndex({ cwd: temp.cwd });

    expect(index.files.map((file) => file.path)).toEqual(['modules/alpha/src/main.ts']);
    expect(index.diagnostics.map((diagnostic) => diagnostic.code)).toContain('git-ls-files-unavailable');
    expect(index.limits.maxIndexedFiles).toBeGreaterThan(0);
    expect(index.limits.maxTotalScannedBytes).toBeGreaterThan(0);
  });

  it('localizes generic manifests, entrypoints, schemas, commands, routes, UI, docs, and tests without repository-specific defaults', async () => {
    const temp = await workspace({
      'workspace/widgets/package.json': JSON.stringify({ main: './src/index.ts', bin: { widget: './src/command-handler.ts' } }),
      'workspace/widgets/src/index.ts': 'export * from "./api-route";',
      'workspace/widgets/src/contracts/widget-schema.ts': 'export interface WidgetContract { id: string }',
      'workspace/widgets/src/command-handler.ts': 'export function commandHandler() {}',
      'workspace/widgets/src/api-route.ts': 'export const route = "/api/widgets";',
      'workspace/widgets/src/components/widget-view.tsx': 'export function WidgetView() { return <button />; }',
      'workspace/widgets/README.md': '# Widget docs',
      'workspace/widgets/src/widget.test.ts': 'test("widget", () => {});',
      'workspace/widgets/src/plugin-extension.ts': 'export const extension = { contributions: [] };',
    });
    const content = prd([
      'Widget package exposes manifest entrypoints, command handlers, API routes, UI, docs, tests, plugin extension, and schema contract surfaces.',
      'Widget schema contract and route API are localized through keywords rather than named workspace defaults.',
    ]);
    const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'widget-prd.md' });
    const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits, inventory });

    const bundle = await deriveSourceLocalization({ cwd: temp.cwd, inventory, graph, hints: { projectHints: [
      { kind: 'manifest', query: 'widget manifest', subsystemHints: ['widgets'] },
      { kind: 'entrypoint', query: 'widget entrypoint', subsystemHints: ['widgets'] },
      { kind: 'command', query: 'command handler', subsystemHints: ['widgets'] },
      { kind: 'route', query: 'api route', subsystemHints: ['widgets'] },
      { kind: 'ui', query: 'widget view', subsystemHints: ['widgets'] },
      { kind: 'docs', query: 'widget docs', subsystemHints: ['widgets'] },
      { kind: 'test', query: 'widget test', subsystemHints: ['widgets'] },
      { kind: 'extension', query: 'plugin extension', subsystemHints: ['widgets'] },
      { kind: 'interface', query: 'schema contract', interfaceKeys: ['schema-contract'], subsystemHints: ['widgets'] },
    ] } });

    const candidates = allCandidates(bundle);
    expect(candidates).toContain('workspace/widgets/package.json');
    expect(candidates).toContain('workspace/widgets/src/index.ts');
    expect(candidates).toContain('workspace/widgets/src/contracts/widget-schema.ts');
    expect(candidates).toContain('workspace/widgets/src/command-handler.ts');
    expect(candidates).toContain('workspace/widgets/src/api-route.ts');
    expect(candidates).toContain('workspace/widgets/src/components/widget-view.tsx');
    expect(candidates).toContain('workspace/widgets/README.md');
    expect(candidates).toContain('workspace/widgets/src/widget.test.ts');
    expect(candidates).toContain('workspace/widgets/src/plugin-extension.ts');
    expect(candidates.join('\n')).not.toContain('eforge');
  });

  it('localizes route, client, and extension fixtures through generic hints without eforge defaults', async () => {
    const temp = await workspace({
      'packages/server/src/routes/session.ts': 'export const sessionRoute = "/api/session";',
      'packages/client/src/api/session-client.ts': 'export async function fetchSession() { return fetch("/api/session"); }',
      'packages/pi-eforge/src/session-extension.ts': 'export const sessionExtension = { contributions: [] };',
      'packages/eforge/src/unrelated.ts': 'export const unrelated = true;',
    });
    const content = prd(['Session route, session client API, and session extension surfaces are localized from repository fixture signals.']);
    const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'session-prd.md' });
    const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits, inventory });

    const bundle = await deriveSourceLocalization({ cwd: temp.cwd, inventory, graph, hints: { projectHints: [
      { kind: 'route', query: 'session route', keywords: ['sessionRoute'], subsystemHints: ['session'] },
      { kind: 'consumer-surface', query: 'session client API', keywords: ['fetchSession'], subsystemHints: ['session'] },
      { kind: 'extension', query: 'session extension', keywords: ['sessionExtension'], subsystemHints: ['session'] },
    ] } });

    const candidates = allCandidates(bundle);
    expect(candidates).toContain('packages/server/src/routes/session.ts');
    expect(candidates).toContain('packages/client/src/api/session-client.ts');
    expect(candidates).toContain('packages/pi-eforge/src/session-extension.ts');
    expect(candidates).not.toContain('packages/eforge/src/unrelated.ts');
  });

  it('expands directory evidence with candidate reasons and budget diagnostics', async () => {
    const temp = await workspace({
      'workspace/tools/src/a.ts': 'export const command = true;',
      'workspace/tools/src/b.ts': 'export const route = true;',
      'workspace/tools/src/c.ts': 'export const schema = true;',
    });
    const content = prd(['Command route schema work lives under `workspace/tools/src`.']);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits, inventory });

    const bundle = await deriveSourceLocalization({ cwd: temp.cwd, inventory, graph, limits: { maxDirectoryExpansionFiles: 2, maxCandidateFilesPerNeed: 2 } });
    const directory = bundle.records.find((record) => record.kind === 'directory' && record.query === 'workspace/tools/src')!;

    expect(directory.candidateFiles).toHaveLength(2);
    expect(directory.candidateFiles.every((candidate) => candidate.reason === 'directory expansion')).toBe(true);
    expect(directory.diagnostics.map((diagnostic) => diagnostic.code)).toContain('directory-expansion-budget');
    expect(directory.budgetNotes.join('\n')).toContain('candidate-files:');
  });

  it('assigns global inventory candidates to atoms through criteria, subsystem, and interface overlap', async () => {
    const temp = await workspace({ 'workspace/catalog/src/catalog-schema.ts': 'export type CatalogSchema = { id: string };' });
    const content = prd(['Catalog schema contract is implemented in `workspace/catalog/src/catalog-schema.ts`.', 'Catalog route API consumes the schema contract.']);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits, inventory });

    const bundle = await deriveSourceLocalization({ cwd: temp.cwd, inventory, graph });
    const globalRecord = bundle.records.find((record) => record.needId.includes('inventory-interface') || record.needId.includes('inventory-subsystem'));

    expect(globalRecord?.assignedAtomIds.length).toBeGreaterThan(0);
    expect(Object.keys(bundle.byAtomId).length).toBeGreaterThan(0);
    expect(allCandidates(bundle)).toContain('workspace/catalog/src/catalog-schema.ts');
  });

  it('applies configurable ignores and project hints only through localization input hints', async () => {
    const temp = await workspace({
      'workspace/visible/src/config.ts': 'export const config = true;',
      'workspace/ignored/src/config.ts': 'export const config = true;',
    });
    const content = prd(['Configuration files must be localized.']);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits, inventory });

    const bundle = await deriveSourceLocalization({ cwd: temp.cwd, inventory, graph, hints: { ignorePrefixes: ['workspace/ignored'], projectHints: [{ kind: 'config', query: 'visible config', paths: ['workspace/visible/src/config.ts'], subsystemHints: ['visible'] }] } });

    expect(allCandidates(bundle)).toContain('workspace/visible/src/config.ts');
    expect(allCandidates(bundle)).not.toContain('workspace/ignored/src/config.ts');
    expect(bundle.records.some((record) => record.needId.startsWith('project-hint-config'))).toBe(true);
  });

  it('scores manifest entrypoint targets and all project hint paths and keywords', async () => {
    const temp = await workspace({
      'workspace/app/package.json': JSON.stringify({ main: './src/start.ts' }),
      'workspace/app/src/start.ts': 'export const start = true;',
      'workspace/app/src/extra.ts': 'export const magicKeyword = true;',
    });
    const content = prd(['The app entrypoint and magic keyword implementation are localized.']);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });

    const bundle = await deriveSourceLocalization({ cwd: temp.cwd, inventory, hints: { projectHints: [{ kind: 'entrypoint', query: 'app entrypoint', paths: ['workspace/app/src/start.ts', 'workspace/app/src/extra.ts'], keywords: ['magicKeyword'], subsystemHints: ['app'] }] } });

    expect(allCandidates(bundle)).toContain('workspace/app/src/start.ts');
    expect(allCandidates(bundle)).toContain('workspace/app/src/extra.ts');
    expect(bundle.records.some((record) => record.needId.startsWith('project-hint-keyword-magickeyword'))).toBe(true);
  });

  it('bounds fallback indexing and applies caller ignores while walking', async () => {
    const temp = await workspace({
      'keep/a.ts': 'export const a = true;',
      'keep/b.ts': 'export const b = true;',
      'vendor/ignored.ts': 'export const ignored = true;',
    });

    const index = await deriveRepositoryIndex({ cwd: temp.cwd, hints: { ignorePrefixes: ['vendor'] }, limits: { maxIndexedFiles: 1 } });

    expect(index.files).toHaveLength(1);
    expect(index.files.map((file) => file.path)).not.toContain('vendor/ignored.ts');
    expect(index.truncated).toBe(true);
    expect(index.diagnostics.map((diagnostic) => diagnostic.code)).toContain('index-file-limit');
  });

  it('applies nested caller ignore globs and generated plan artifact filtering', async () => {
    const temp = await workspace({
      'workspace/keep/file.ts': 'export const keep = true;',
      'workspace/generated/deep/file.ts': 'export const ignored = true;',
      'eforge/plans/foo/module-bar.md': '# generated module plan',
    });

    const index = await deriveRepositoryIndex({ cwd: temp.cwd, hints: { ignoreGlobs: ['**/generated/**'] } });

    expect(index.files.map((file) => file.path)).toEqual(['workspace/keep/file.ts']);
  });

  it('reports invalid localization inputs as structured diagnostics', async () => {
    const temp = await workspace({ 'workspace/keep/file.ts': 'export const keep = true;' });

    const bundle = await deriveSourceLocalization({ cwd: temp.cwd, hints: { ignorePrefixes: ['../outside'], projectHints: [{ kind: 'bogus', query: '' } as never] }, limits: { maxIndexedFiles: -1 } });

    expect(bundle.diagnostics.map((diagnostic) => diagnostic.code)).toContain('invalid-localization-limit');
    expect(bundle.diagnostics.map((diagnostic) => diagnostic.code)).toContain('invalid-localization-hint');
  });

  it('does not execute repository fsmonitor config or scan tracked symlinks', async () => {
    const temp = await workspace({ 'real.ts': 'export const real = true;' }, { git: true });
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'eforge-planning-outside-'));
    try {
      const marker = path.join(temp.cwd, 'fsmonitor-ran');
      const monitor = path.join(temp.cwd, 'fsmonitor.sh');
      await writeFile(monitor, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`, 'utf8');
      await chmod(monitor, 0o755);
      await writeFile(path.join(outsideDir, 'secret.ts'), 'export const secret = true;', 'utf8');
      await symlink(path.join(outsideDir, 'secret.ts'), path.join(temp.cwd, 'linked-secret.ts'));
      await execFileAsync('git', ['add', '-A'], { cwd: temp.cwd });
      await execFileAsync('git', ['config', 'core.fsmonitor', monitor], { cwd: temp.cwd });

      const index = await deriveRepositoryIndex({ cwd: temp.cwd });

      await expect(writeFile(marker, '', { flag: 'wx' })).resolves.toBeUndefined();
      expect(index.files.map((file) => file.path)).not.toContain('linked-secret.ts');
      expect(index.files.some((file) => file.textSample?.includes('secret'))).toBe(false);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

function allCandidates(bundle: SourceLocalizationBundle): string[] {
  return [...new Set(bundle.records.flatMap((record) => record.candidateFiles.map((candidate) => candidate.path)))].sort();
}
