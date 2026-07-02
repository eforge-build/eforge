import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { buildPlanningAtomTasks, derivePlanningAtomGraph, deriveSharedPlanningBrief, deriveSourceInventory, runPlanningAtomMap, validatePlanningAtomOutput, validateSharedPlanningBrief, type PlanningAtomOutput, type PlanningAtomTask } from '@eforge-build/engine/planner-compiler';
import { StubHarness } from './stub-harness.js';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Shared Brief', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

function fixture(criteria = ['engine updates `packages/engine/src/shared.ts` for one aspect.', 'engine validates `packages/engine/src/shared.ts` for another aspect.']) {
  const content = prd(criteria);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'shared-brief.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'shared-brief.md', limits, inventory });
  const brief = deriveSharedPlanningBrief({ graph });
  const tasks = buildPlanningAtomTasks({ graph, inventory, sharedBrief: brief });
  return { content, inventory, graph, brief, tasks, taskById: new Map(tasks.map((task) => [task.atomId, task])) };
}

describe('planning shared brief and evidence ownership', () => {
  it('assigns deterministic primary ownership for evidence referenced by multiple atoms', () => {
    const { graph, brief } = fixture();
    const ownership = brief.evidenceOwnership.find((entry) => entry.path === 'packages/engine/src/shared.ts');

    expect(validateSharedPlanningBrief(brief, graph)).toEqual({ ok: true, errors: [] });
    expect(ownership?.shared).toBe(true);
    expect(ownership?.referencedByAtomIds.length).toBe(2);
    expect(ownership?.primaryAtomId).toBe(ownership?.referencedByAtomIds[0]);
    expect(ownership?.consumerAtomIds).toEqual(ownership?.referencedByAtomIds.slice(1));
    expect(brief.atomBriefs.find((atomBrief) => atomBrief.atomId === ownership?.consumerAtomIds[0])?.prerequisiteAtomIds).toEqual([ownership?.primaryAtomId]);
  });

  it('marks single-use evidence as local and excludes broad or generated evidence candidates', () => {
    const { brief } = fixture(['engine updates `packages/engine/src/local.ts` and ignores packages plus eforge/plans/foo/orchestration.yaml.']);
    const [atomBrief] = brief.atomBriefs;

    expect(brief.evidenceOwnership.map((entry) => entry.path)).toEqual(['packages/engine/src/local.ts']);
    expect(brief.evidenceOwnership[0].shared).toBe(false);
    expect(atomBrief.localEvidencePaths).toEqual(['packages/engine/src/local.ts']);
    expect(atomBrief.ownedEvidencePaths).toEqual([]);
  });

  it('fits the byte budget by construction, dropping lowest-value sections with diagnostics', () => {
    const { graph } = fixture();

    const brief = deriveSharedPlanningBrief({ graph, limits: { maxTotalBriefBytes: 1 } });

    expect(brief.byteLength).toBeLessThanOrEqual(1);
    expect(brief.sections).toEqual([]);
    expect(brief.budgetDiagnostics.some((diagnostic) => diagnostic.code === 'section-dropped-total-budget')).toBe(true);
    expect(validateSharedPlanningBrief(brief, graph)).toEqual({ ok: true, errors: [] });
  });

  it('demotes lowest-value evidence sections beyond the per-atom section budget', () => {
    const { graph } = fixture();

    const brief = deriveSharedPlanningBrief({ graph, limits: { maxSectionsPerAtom: 1 } });

    expect(validateSharedPlanningBrief(brief, graph)).toEqual({ ok: true, errors: [] });
    for (const atomBrief of brief.atomBriefs) expect(atomBrief.sectionIds.length).toBeLessThanOrEqual(1);
    expect(brief.budgetDiagnostics.some((diagnostic) => diagnostic.code === 'atom-section-demoted')).toBe(true);
    // Demoted paths stay visible through evidence summaries and ownership.
    expect(brief.evidenceOwnership.map((entry) => entry.path)).toContain('packages/engine/src/shared.ts');
  });

  it('assigns criterion-less global localization records to one owner atom instead of broadcasting', () => {
    const { graph } = fixture();
    const globalRecord = {
      needId: 'inventory-evidence-tsconfig-json',
      kind: 'literal-path' as const,
      query: 'tsconfig.json',
      status: 'resolved' as const,
      candidateFiles: [{ path: 'tsconfig.json', score: 100, reason: 'literal path match', confidence: 'high' as const, signals: ['literal-path'] }],
      confidence: 'high' as const,
      reason: 'literal path match',
      linkedCriterionIds: [],
      linkedAspectIds: [],
      assignedAtomIds: [],
      diagnostics: [],
      budgetNotes: [],
    };

    const brief = deriveSharedPlanningBrief({ graph, sourceLocalizationBundle: { records: [globalRecord], byAtomId: {}, diagnostics: [], limits: { maxIndexedFiles: 100, maxCandidateFilesPerNeed: 12, maxDirectoryExpansionFiles: 20, maxBytesPerScannedFile: 10_000, maxTotalScannedBytes: 100_000 }, indexDiagnostics: [] } });
    const ownership = brief.evidenceOwnership.find((entry) => entry.path === 'tsconfig.json');

    expect(graph.atoms.length).toBeGreaterThan(1);
    expect(ownership?.referencedByAtomIds.length).toBe(1);
    expect(ownership?.shared).toBe(false);
  });

  it('truncates oversized sections to the exact section byte budget', () => {
    const { graph } = fixture();

    const brief = deriveSharedPlanningBrief({ graph, limits: { maxSectionBytes: 64 } });

    expect(validateSharedPlanningBrief(brief, graph)).toEqual({ ok: true, errors: [] });
    for (const section of brief.sections) expect(section.byteLength).toBeLessThanOrEqual(64);
  });

  it('validates shared findings against owned evidence and atom aspects', () => {
    const { graph, inventory, brief, tasks } = fixture();
    const consumerTask = tasks.find((task) => task.sharedBrief?.sharedEvidenceRefs.length)!;

    const invalid = validatePlanningAtomOutput({ graph, inventory, sharedBrief: brief, task: consumerTask, output: {
      atomId: consumerTask.atomId,
      status: 'completed',
      aspectUpdates: consumerTask.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [consumerTask.atomId] })),
      sharedFindings: [{ findingId: 'finding-bad', sourceAtomId: consumerTask.atomId, evidencePath: 'packages/engine/src/shared.ts', aspectIds: consumerTask.aspectIds, summary: 'Consumer tried to publish a shared finding.', byteLength: 43 }],
    } });

    expect(invalid).toEqual({ ok: false, errors: ['shared finding references unowned evidence:finding-bad:packages/engine/src/shared.ts'] });
  });

  it('chooses shared evidence owners that do not conflict with graph dependencies', () => {
    const data = fixture();
    const [firstAtomId, secondAtomId] = data.graph.atoms.map((atom) => atom.atomId).sort();
    const graph = { ...data.graph, edges: [{ fromAtomId: secondAtomId, toAtomId: firstAtomId, reason: 'test-dependency' }] };

    const brief = deriveSharedPlanningBrief({ graph });
    const ownership = brief.evidenceOwnership.find((entry) => entry.path === 'packages/engine/src/shared.ts');

    expect(validateSharedPlanningBrief(brief, graph)).toEqual({ ok: true, errors: [] });
    expect(ownership?.primaryAtomId).toBe(secondAtomId);
    expect(brief.atomBriefs.find((atomBrief) => atomBrief.atomId === firstAtomId)?.prerequisiteAtomIds).toEqual([secondAtomId]);
  });

  it('runs primary evidence owners before consumers and passes accepted shared findings forward', async () => {
    const data = fixture();
    const primaryTask = data.tasks.find((task) => task.sharedBrief?.ownedEvidencePaths.includes('packages/engine/src/shared.ts'))!;
    const consumerTask = data.tasks.find((task) => task.sharedBrief?.sharedEvidenceRefs.some((ref) => ref.path === 'packages/engine/src/shared.ts'))!;
    const finding = { findingId: 'finding-shared-ts', sourceAtomId: primaryTask.atomId, evidencePath: 'packages/engine/src/shared.ts', aspectIds: primaryTask.aspectIds, summary: 'Shared file exports the bounded planner contract.', byteLength: 48 };
    const harness = new StubHarness([
      atomSubmission(completedOutput(primaryTask, { sharedFindings: [finding] })),
      atomSubmission(completedOutput(consumerTask)),
    ]);

    const result = await runPlanningAtomMap({ graph: data.graph, inventory: data.inventory, sharedBrief: data.brief, sourceContent: data.content, cwd: process.cwd(), harness, parallelism: 2 });

    expect(result.mapComplete).toBe(true);
    expect(result.completedAtomIds).toEqual([consumerTask.atomId, primaryTask.atomId].sort());
    expect(result.sharedFindings).toEqual([finding]);
    expect(harness.prompts[0]).toContain('ownedEvidencePaths');
    expect(harness.prompts[1]).toContain('acceptedSharedFindings');
    expect(harness.prompts[1]).toContain('Shared file exports the bounded planner contract.');
  });

  it('fills map parallelism with independent atoms when a shared evidence consumer is waiting', async () => {
    const data = fixture([
      'engine updates `packages/engine/src/shared.ts` for one aspect.',
      'engine validates `packages/engine/src/shared.ts` for another aspect.',
      'engine updates `packages/engine/src/independent.ts` independently.',
    ]);
    const primaryTask = data.tasks.find((task) => task.sharedBrief?.ownedEvidencePaths.includes('packages/engine/src/shared.ts'))!;
    const consumerTask = data.tasks.find((task) => task.sharedBrief?.sharedEvidenceRefs.some((ref) => ref.path === 'packages/engine/src/shared.ts'))!;
    const independentTask = data.tasks.find((task) => task.atomId !== primaryTask.atomId && task.atomId !== consumerTask.atomId)!;
    const live: unknown[] = [];
    const harness = new StubHarness([
      atomSubmission(completedOutput(primaryTask)),
      atomSubmission(completedOutput(independentTask)),
      atomSubmission(completedOutput(consumerTask)),
    ]);

    const result = await runPlanningAtomMap({ graph: data.graph, inventory: data.inventory, sharedBrief: data.brief, sourceContent: data.content, cwd: process.cwd(), harness, parallelism: 2, onEvent: (event) => live.push(event) });

    const atomStatuses = live.filter((event): event is { type: string; atomId: string; status: string } => typeof event === 'object' && event !== null && (event as { type?: string }).type === 'planning:map-reduce:atom:status');
    const firstCompletedIndex = atomStatuses.findIndex((event) => event.status === 'completed');
    const initialRunningAtomIds = atomStatuses.slice(0, firstCompletedIndex).filter((event) => event.status === 'running').map((event) => event.atomId).sort();
    expect(result.mapComplete).toBe(true);
    expect(initialRunningAtomIds).toEqual([independentTask.atomId, primaryTask.atomId].sort());
  });

  it('passes accepted shared interface findings and section content to consumers', async () => {
    const data = fixture(['engine updates the event schema contract for one aspect.', 'engine validates the event schema contract for another aspect.']);
    const primaryTask = data.tasks.find((task) => task.sharedBrief?.ownedInterfaceKeys.includes('schema-contract'))!;
    const consumerTask = data.tasks.find((task) => task.sharedBrief?.sharedInterfaceRefs.some((ref) => ref.key === 'schema-contract'))!;
    const finding = { findingId: 'finding-event-schema', sourceAtomId: primaryTask.atomId, interfaceKey: 'schema-contract', aspectIds: primaryTask.aspectIds, summary: 'Event schema variants share the same discriminant contract.', byteLength: 60 };
    const harness = new StubHarness([
      atomSubmission(completedOutput(primaryTask, { sharedFindings: [finding] })),
      atomSubmission(completedOutput(consumerTask)),
    ]);

    const result = await runPlanningAtomMap({ graph: data.graph, inventory: data.inventory, sharedBrief: data.brief, sourceContent: data.content, cwd: process.cwd(), harness, parallelism: 2 });

    expect(result.mapComplete).toBe(true);
    expect(result.sharedFindings).toEqual([finding]);
    expect(harness.prompts[0]).toContain('ownedInterfaceKeys');
    expect(harness.prompts[0]).toContain('Shared interface schema-contract');
    expect(harness.prompts[1]).toContain('sharedInterfaceRefs');
    expect(harness.prompts[1]).toContain('Event schema variants share the same discriminant contract.');
  });
});

function atomSubmission(output: PlanningAtomOutput) {
  return { toolCalls: [{ tool: 'submit_atom_output', toolUseId: `submit-${output.atomId}`, input: output, output: 'ok' }] };
}

function completedOutput(task: PlanningAtomTask, extra: Partial<PlanningAtomOutput> = {}): PlanningAtomOutput {
  return {
    atomId: task.atomId,
    status: 'completed',
    aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })),
    compactHandoff: `completed ${task.atomId}`,
    ...extra,
  };
}
