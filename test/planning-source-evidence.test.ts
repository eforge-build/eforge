import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { buildPlanningAtomTasks, derivePlanningAtomGraph, deriveSharedPlanningBrief, deriveSourceInventory, deriveSourceLocalization, materializePlanningSourceEvidence, runPlanningAtomMap, sourceEvidenceRecordsForAtom, type PlanningAtomOutput, type PlanningAtomTask } from '@eforge-build/engine/planner-compiler';
import { StubHarness } from './stub-harness.js';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');
let cwd: string;

beforeEach(async () => { cwd = await mkdtemp(join(tmpdir(), 'eforge-source-evidence-')); });
afterEach(async () => { await rm(cwd, { recursive: true, force: true }); });

function prd(criteria: string[]): string {
  return ['# Source Evidence', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

async function fixture(criteria: string[]) {
  const content = prd(criteria);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'source-evidence.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'source-evidence.md', limits, inventory });
  const brief = deriveSharedPlanningBrief({ graph });
  return { content, inventory, graph, brief };
}

describe('planning source evidence materialization', () => {
  it('materializes concrete evidence files for the primary owning atom only', async () => {
    await writeEvidence('packages/engine/src/shared.ts', 'export const shared = true;\n'.repeat(5));
    const data = await fixture(['engine updates `packages/engine/src/shared.ts` for one aspect.', 'engine validates `packages/engine/src/shared.ts` for another aspect.']);

    const bundle = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief });
    const record = bundle.records.find((item) => item.path === 'packages/engine/src/shared.ts')!;
    const ownership = data.brief.evidenceOwnership.find((item) => item.path === record.path)!;
    const consumerAtomId = ownership.consumerAtomIds[0];

    expect(bundle.validationErrors).toEqual([]);
    expect(record.status).toBe('materialized');
    expect(record.contentExcerpt).toContain('export const shared = true');
    expect(record.deliveredToAtomIds).toEqual([ownership.primaryAtomId]);
    expect(sourceEvidenceRecordsForAtom(bundle, ownership.primaryAtomId!).find((item) => item.path === record.path)?.contentExcerpt).toContain('export const shared');
    expect(sourceEvidenceRecordsForAtom(bundle, consumerAtomId).find((item) => item.path === record.path)?.contentExcerpt).toBeUndefined();
  });

  it('materializes localized directory candidates as concrete records with rationale and byte accounting', async () => {
    await writeEvidence('packages/engine/src/a.ts', 'export const localizedA = true;\n');
    await writeEvidence('packages/engine/src/b.ts', 'export const localizedB = true;\n');
    const content = prd(['engine updates `packages/engine/src` with localized source evidence.']);
    const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'source-evidence.md' });
    const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'source-evidence.md', limits, inventory });
    const localization = await deriveSourceLocalization({ cwd, inventory, graph });
    const brief = deriveSharedPlanningBrief({ graph, sourceLocalizationBundle: localization });

    const bundle = await materializePlanningSourceEvidence({ cwd, graph, sharedBrief: brief });
    const paths = bundle.records.map((record) => record.path).sort();
    const localized = bundle.records.find((record) => record.path === 'packages/engine/src/a.ts')!;

    expect(paths).toEqual(['packages/engine/src/a.ts', 'packages/engine/src/b.ts']);
    expect(bundle.records.some((record) => record.path === 'packages/engine/src' && record.status === 'directory')).toBe(false);
    expect(localized.status).toBe('materialized');
    expect(localized.localizationNeedIds?.length).toBeGreaterThan(0);
    expect(localized.ownershipRationale).toContain('directory expansion');
    expect(localized.budgetNotes).toContain('excerpt-bytes:32/8000');
    expect(bundle.totalBytes).toBe(64);
    expect(bundle.bytesByAtomId?.[graph.atoms[0].atomId]).toBe(64);
  });

  it('records missing, directory, non-actionable, and oversized evidence statuses without throwing', async () => {
    await mkdir(join(cwd, 'packages/engine/src'), { recursive: true });
    await writeFile(join(cwd, 'packages/engine/src/huge.ts'), 'x'.repeat(50));
    const data = await fixture(['engine uses `packages/engine/src/missing.ts`, `packages/engine/src`, and `packages/engine/src/huge.ts`.']);
    data.brief.evidenceOwnership.push({ path: 'packages', referencedByAtomIds: [data.graph.atoms[0].atomId], consumerAtomIds: [], shared: false, reason: 'test-non-actionable' });

    const bundle = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief, limits: { maxBytesPerFile: 10 } });
    const statuses = new Map(bundle.records.map((record) => [record.path, record.status]));

    expect(statuses.get('packages/engine/src/missing.ts')).toBe('missing');
    expect(statuses.get('packages/engine/src')).toBe('directory');
    expect(statuses.get('packages/engine/src/huge.ts')).toBe('too-large');
    expect(statuses.get('packages')).toBe('non-actionable');
  });

  it('spends binding file budgets on criterion-linked evidence, not alphabetical path order', async () => {
    await writeEvidence('packages/engine/src/linked.ts', 'export const linked = true;\n');
    await writeEvidence('packages/engine/src/aaa-sweep.ts', 'export const sweep = true;\n');
    const data = await fixture(['engine updates `packages/engine/src/linked.ts`.']);
    const atomId = data.graph.atoms[0].atomId;
    // An alphabetically-first surface sweep-in competes for the single slot.
    data.brief.evidenceOwnership.unshift({ path: 'packages/engine/src/aaa-sweep.ts', referencedByAtomIds: [atomId], consumerAtomIds: [], shared: false, reason: 'surface-sweep', localizationConfidence: 'medium', candidateRank: 4 });

    const bundle = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief, limits: { maxFilesPerAtom: 1 } });
    const statuses = new Map(bundle.records.map((record) => [record.path, record.status]));

    expect(data.brief.evidenceOwnership.find((entry) => entry.path === 'packages/engine/src/linked.ts')?.criterionLinked).toBe(true);
    expect(statuses.get('packages/engine/src/linked.ts')).toBe('materialized');
    expect(statuses.get('packages/engine/src/aaa-sweep.ts')).toBe('budget-exceeded');
  });

  it('marks records as budget-exceeded when total or per-atom evidence budgets are exhausted', async () => {
    await writeEvidence('packages/engine/src/a.ts', 'a'.repeat(40));
    await writeEvidence('packages/engine/src/b.ts', 'b'.repeat(40));
    const data = await fixture(['engine updates `packages/engine/src/a.ts` and `packages/engine/src/b.ts`.']);

    const totalLimited = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief, limits: { maxBytesTotal: 10 } });
    const atomLimited = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief, limits: { maxEvidenceBytesPerAtom: 10 } });

    expect(totalLimited.records.some((record) => record.status === 'budget-exceeded' && record.reason === 'max-total-evidence-bytes')).toBe(true);
    expect(atomLimited.records.some((record) => record.status === 'budget-exceeded' && record.reason === 'max-evidence-bytes-per-atom')).toBe(true);
  });

  it('allows empty materialized files without validation errors', async () => {
    await writeEvidence('packages/engine/src/empty.ts', '');
    const data = await fixture(['engine updates `packages/engine/src/empty.ts`.']);

    const bundle = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief });
    const record = bundle.records.find((item) => item.path === 'packages/engine/src/empty.ts')!;

    expect(bundle.validationErrors).toEqual([]);
    expect(record.status).toBe('materialized');
    expect(record.contentExcerpt).toBe('');
    expect(record.excerptByteLength).toBe(0);
  });

  it('truncates source evidence excerpts on UTF-8 character boundaries', async () => {
    await writeEvidence('packages/engine/src/unicode.ts', '😀abc');
    const data = await fixture(['engine updates `packages/engine/src/unicode.ts`.']);

    const bundle = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief, limits: { maxExcerptBytesPerFile: 5 } });
    const record = bundle.records.find((item) => item.path === 'packages/engine/src/unicode.ts')!;

    expect(bundle.validationErrors).toEqual([]);
    expect(record.status).toBe('materialized');
    expect(record.contentExcerpt).toBe('😀a');
    expect(record.excerptByteLength).toBe(5);
  });

  it('does not materialize symlinks or files resolved outside the project root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'eforge-source-evidence-outside-'));
    try {
      await writeFile(join(outside, 'secret.ts'), 'export const secret = true;');
      await mkdir(join(outside, 'packages/engine/src'), { recursive: true });
      await writeFile(join(outside, 'packages/engine/src/escape.ts'), 'export const escape = true;');
      await mkdir(join(cwd, 'test'), { recursive: true });
      await symlink(join(outside, 'secret.ts'), join(cwd, 'test/link.ts'));
      await symlink(join(outside, 'packages'), join(cwd, 'packages'), 'dir');
      const data = await fixture(['engine updates `test/link.ts` and `packages/engine/src/escape.ts`.']);

      const bundle = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief });
      const records = new Map(bundle.records.map((record) => [record.path, record]));

      expect(records.get('test/link.ts')?.status).toBe('read-error');
      expect(records.get('test/link.ts')?.reason).toBe('symlinks-are-not-materialized');
      expect(records.get('test/link.ts')?.contentExcerpt).toBeUndefined();
      expect(records.get('packages/engine/src/escape.ts')?.status).toBe('read-error');
      expect(records.get('packages/engine/src/escape.ts')?.reason).toBe('resolved-path-outside-cwd');
      expect(records.get('packages/engine/src/escape.ts')?.contentExcerpt).toBeUndefined();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('materializes repair-priority paths ahead of higher-value generic evidence', async () => {
    await writeEvidence('packages/engine/src/linked.ts', 'export const linked = true;\n');
    await writeEvidence('packages/engine/src/zz-priority.ts', 'export const priority = true;\n');
    const data = await fixture(['engine updates `packages/engine/src/linked.ts`.']);
    const atomId = data.graph.atoms[0].atomId;
    // Not criterion-linked, no localization confidence: loses every generic ranking tier.
    data.brief.evidenceOwnership.push({ path: 'packages/engine/src/zz-priority.ts', referencedByAtomIds: [atomId], consumerAtomIds: [], shared: false, reason: 'synthetic-repair-evidence' });

    const bundle = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief, limits: { maxFilesTotal: 1 }, priorityPaths: ['packages/engine/src/zz-priority.ts'] });
    const records = new Map(bundle.records.map((record) => [record.path, record]));

    expect(records.get('packages/engine/src/zz-priority.ts')).toMatchObject({ status: 'materialized', priority: true });
    expect(records.get('packages/engine/src/zz-priority.ts')?.budgetNotes).toContain('priority');
    expect(records.get('packages/engine/src/linked.ts')).toMatchObject({ status: 'budget-exceeded', reason: 'max-files-total' });
  });

  it('materializes all shared repair-priority files on one primary atom past the generic per-atom byte budget', async () => {
    const sharedPaths = ['packages/engine/src/a.ts', 'packages/engine/src/b.ts', 'packages/engine/src/c.ts', 'packages/engine/src/d.ts'];
    for (const sharedPath of sharedPaths) await writeEvidence(sharedPath, 'x'.repeat(40));
    const backticked = sharedPaths.map((sharedPath) => `\`${sharedPath}\``).join(', ');
    const data = await fixture([`engine updates ${backticked} for one aspect.`, `engine validates ${backticked} for another aspect.`]);
    const primaryAtomId = data.brief.evidenceOwnership.find((entry) => entry.path === sharedPaths[0])!.primaryAtomId!;
    expect(data.brief.evidenceOwnership.filter((entry) => sharedPaths.includes(entry.path)).every((entry) => entry.shared && entry.primaryAtomId === primaryAtomId)).toBe(true);

    const withoutPriority = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief, limits: { maxEvidenceBytesPerAtom: 100 } });
    const dropped = withoutPriority.records.filter((record) => record.status === 'budget-exceeded');
    expect(dropped.length).toBe(2);
    expect(dropped.every((record) => record.reason === 'max-evidence-bytes-per-atom' && record.budgetAtomIds?.length === 1 && record.budgetAtomIds[0] === primaryAtomId)).toBe(true);

    const withPriority = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief, limits: { maxEvidenceBytesPerAtom: 100 }, priorityPaths: sharedPaths });
    expect(withPriority.validationErrors).toEqual([]);
    expect(withPriority.records.filter((record) => sharedPaths.includes(record.path)).every((record) => record.status === 'materialized' && record.priority === true && record.deliveredToAtomIds[0] === primaryAtomId)).toBe(true);
    expect(withPriority.bytesByAtomId?.[primaryAtomId]).toBe(160);
  });

  it('keeps priority materialization bounded by the priority per-atom ceiling and the global byte budget', async () => {
    const sharedPaths = ['packages/engine/src/a.ts', 'packages/engine/src/b.ts', 'packages/engine/src/c.ts'];
    for (const sharedPath of sharedPaths) await writeEvidence(sharedPath, 'x'.repeat(40));
    const backticked = sharedPaths.map((sharedPath) => `\`${sharedPath}\``).join(', ');
    const data = await fixture([`engine updates ${backticked}.`]);
    const atomId = data.graph.atoms[0].atomId;

    const atomCeiling = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief, limits: { maxPriorityEvidenceBytesPerAtom: 100 }, priorityPaths: sharedPaths });
    const atomCeilingDropped = atomCeiling.records.filter((record) => record.status === 'budget-exceeded');
    expect(atomCeilingDropped.length).toBe(1);
    expect(atomCeilingDropped[0]).toMatchObject({ reason: 'max-priority-evidence-bytes-per-atom', priority: true, budgetAtomIds: [atomId] });

    const totalCeiling = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief, limits: { maxBytesTotal: 100 }, priorityPaths: sharedPaths });
    expect(totalCeiling.records.some((record) => record.status === 'budget-exceeded' && record.reason === 'max-total-evidence-bytes' && record.priority === true)).toBe(true);
    expect(totalCeiling.totalBytes).toBeLessThanOrEqual(100);
  });

  it('passes materialized source evidence to atom prompts while keeping mapper tools disabled', async () => {
    await writeEvidence('packages/engine/src/local.ts', 'export function localEvidence() { return true; }');
    const data = await fixture(['engine updates `packages/engine/src/local.ts`.']);
    const bundle = await materializePlanningSourceEvidence({ cwd, graph: data.graph, sharedBrief: data.brief });
    const [task] = buildPlanningAtomTasks({ graph: data.graph, inventory: data.inventory, sharedBrief: data.brief });
    const harness = new StubHarness([atomSubmission(completedOutput(task))]);

    const result = await runPlanningAtomMap({ graph: data.graph, inventory: data.inventory, sharedBrief: data.brief, sourceEvidenceBundle: bundle, sourceContent: data.content, cwd, harness });

    expect(result.mapComplete).toBe(true);
    expect(harness.calls[0].tools).toBe('none');
    expect(harness.prompts[0]).toContain('## Source evidence');
    expect(harness.prompts[0]).toContain('export function localEvidence');
  });
});

async function writeEvidence(relativePath: string, content: string): Promise<void> {
  const absolute = join(cwd, relativePath);
  await mkdir(join(absolute, '..'), { recursive: true });
  await writeFile(absolute, content);
}

function atomSubmission(output: PlanningAtomOutput) {
  return { toolCalls: [{ tool: 'submit_atom_output', toolUseId: `submit-${output.atomId}`, input: output, output: 'ok' }] };
}

function completedOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return { atomId: task.atomId, status: 'completed', aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })), compactHandoff: `completed ${task.atomId}` };
}
