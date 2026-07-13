import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { buildPlanningAtomTasks, classifyPlanningReduceGap, derivePlanningAtomGraph, deriveSourceInventory, runBoundedPlannerCompiler, type PlanningAtomOutput, type PlanningAtomTask, type PlanningReduceOutput } from '@eforge-build/engine/planner-compiler';
import { StubHarness } from './stub-harness.js';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Repair Loop', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

describe('planning compiler source-localization repair loop', () => {
  it('adds localized owner evidence during repair when the initial prompt is broad', async () => {
    const ownerPath = 'packages/api/src/routes/user.ts';
    const cwd = await workspace({ [ownerPath]: 'export function userRoute() { return "ok"; }\n' });
    const content = prd(['Account management workflows remain source-grounded with localized repository evidence.']);
    const [task] = expectedTasks(content);
    const firstAtom = completedOutput(task, 'initial');
    const repairedAtom = completedOutput(task, 'repaired');
    const harness = new StubHarness([
      atomSubmission(firstAtom),
      reduceSubmission(sourceGapOutput(task, 'gap-owner', { ownerPaths: [ownerPath], affectedAtomIds: [] })),
      atomSubmission(repairedAtom),
      reduceSubmission(completedReduceOutput(repairedAtom)),
    ]);

    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 1 });

    const firstAtomPrompt = harness.prompts[0] ?? '';
    expect(firstAtomPrompt).not.toContain(ownerPath);
    expect(firstAtomPrompt).not.toContain('userRoute');
    expect(result.status).toBe('complete');
    // Root-cause fixture: a broad initial plan repaired with the upstream
    // owner must still synthesize buildable artifacts, not owner failures.
    expect(result.map.outputs[0]?.moduleCandidates?.length).toBeGreaterThan(0);
    expect(result.validationErrors.join('\n')).not.toContain('classifier-owner-path-unlocalized');
    expect(result.validationErrors.join('\n')).not.toContain('no localized owner paths resolved');
    expect(result.sourceLocalizationBundle.records.flatMap((record) => record.candidateFiles.map((candidate) => candidate.path))).toContain(ownerPath);
    expect(result.sourceEvidenceBundle.records).toEqual(expect.arrayContaining([expect.objectContaining({ path: ownerPath, status: 'materialized', contentExcerpt: expect.stringContaining('userRoute') })]));
    expect(result.repairDiagnostics).toEqual([expect.objectContaining({ status: 'repaired', gapIds: ['gap-owner'], affectedAtomIds: [task.atomId], localizedOwnerPaths: [ownerPath], evidenceMaterializationStatus: [expect.objectContaining({ path: ownerPath, status: 'materialized' })], residueSynthesisBlocked: true })]);
    const repairedAtomPrompt = harness.prompts[2] ?? '';
    expect(repairedAtomPrompt).toContain(ownerPath);
    expect(repairedAtomPrompt).toContain('ownershipRationale');
    expect(repairedAtomPrompt).toContain('userRoute');
    expect(result.map.outputs[0]?.compactHandoff).toBe(`repaired ${task.atomId}`);
    expect(result.residue.candidates.some((candidate) => candidate.candidateId.includes('candidate-reduce-gap'))).toBe(false);
    expect(harness.calls.every((call) => call.tools === 'none')).toBe(true);
  });

  it('caps repair hints before rerunning localization so repair cannot violate the projectHints limit', async () => {
    const ownerPath = 'packages/api/src/routes/user.ts';
    const cwd = await workspace({ [ownerPath]: 'export function userRoute() { return "ok"; }\n' });
    const content = prd(['Account management workflows remain source-grounded with localized repository evidence.']);
    const [task] = expectedTasks(content);
    const atom = completedOutput(task, 'initial');
    const repairedAtom = completedOutput(task, 'repaired');
    const existingHints = Array.from({ length: 100 }, (_, index) => ({ kind: 'keyword' as const, query: `preexisting hint ${index}` }));
    const harness = new StubHarness([
      atomSubmission(atom),
      reduceSubmission(sourceGapOutput(task, 'gap-owner', { ownerPaths: [ownerPath], affectedAtomIds: [] })),
      atomSubmission(repairedAtom),
      reduceSubmission(completedReduceOutput(repairedAtom)),
    ]);

    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 1, sourceLocalizationHints: { projectHints: existingHints } });

    expect(result.status).toBe('complete');
    expect(result.validationErrors.some((error) => error.includes('projectHints is capped'))).toBe(false);
    expect(result.sourceLocalizationBundle.diagnostics.some((diagnostic) => diagnostic.message.includes('projectHints is capped'))).toBe(false);
    expect(result.sourceEvidenceBundle.records).toContainEqual(expect.objectContaining({ path: ownerPath, status: 'materialized' }));
  });

  it('materializes every repair-critical owner path under tight per-atom evidence budgets', async () => {
    const ownerPaths = ['packages/api/src/routes/a.ts', 'packages/api/src/routes/b.ts', 'packages/api/src/routes/c.ts', 'packages/api/src/routes/d.ts'];
    const cwd = await workspace(Object.fromEntries(ownerPaths.map((ownerPath, index) => [ownerPath, `export function ownerRoute${index}() { return 'padding-padding-padding'; }\n`])));
    const content = prd(['Account management workflows remain source-grounded with localized repository evidence.']);
    const [task] = expectedTasks(content);
    const harness = new StubHarness([
      atomSubmission(completedOutput(task, 'initial')),
      reduceSubmission(sourceGapOutput(task, 'gap-owners', { ownerPaths, affectedAtomIds: [] })),
      atomSubmission(completedOutput(task, 'repaired')),
      reduceSubmission(completedReduceOutput(completedOutput(task, 'repaired'))),
    ]);

    // The generic per-atom byte budget fits only one owner excerpt; without repair
    // priority the remaining owner paths would drop as budget-exceeded and the
    // compile would fail with "localized owner paths not materialized".
    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 1, sourceEvidenceLimits: { maxEvidenceBytesPerAtom: 100 } });

    expect(result.status).toBe('complete');
    expect(result.validationErrors).toEqual([]);
    for (const ownerPath of ownerPaths) {
      expect(result.sourceEvidenceBundle.records).toContainEqual(expect.objectContaining({ path: ownerPath, status: 'materialized', priority: true }));
    }
    const repairedAtomPrompt = harness.prompts[2] ?? '';
    for (const [index] of ownerPaths.entries()) expect(repairedAtomPrompt).toContain(`ownerRoute${index}`);
    expect(result.repairDiagnostics).toEqual([expect.objectContaining({ status: 'repaired', gapIds: ['gap-owners'] })]);
  });

  it('names the dropped paths, budgets, and atoms when repair-critical evidence cannot materialize', async () => {
    const blockedPath = 'packages/api/src/routes/blocked.ts';
    const missingPath = 'packages/api/src/routes/missing.ts';
    const cwd = await workspace({ [blockedPath]: `export function blockedRoute() { return 'padding-padding-padding'; }\n` });
    const content = prd(['Account management workflows remain source-grounded with localized repository evidence.']);
    const [task] = expectedTasks(content);
    const harness = new StubHarness([
      atomSubmission(completedOutput(task, 'initial')),
      reduceSubmission(sourceGapOutput(task, 'gap-owners', { ownerPaths: [blockedPath, missingPath], affectedAtomIds: [] })),
      atomSubmission(completedOutput(task, 'repair')),
      reduceSubmission(sourceGapOutput(task, 'gap-owners-after', { ownerPaths: [blockedPath, missingPath], affectedAtomIds: [] })),
    ]);

    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 1, sourceEvidenceLimits: { maxPriorityEvidenceBytesPerAtom: 10 } });

    expect(result.status).toBe('incomplete');
    expect(result.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining(`${missingPath}(missing:file-not-found)`)]));
    expect(result.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining(`${blockedPath}(budget-exceeded:max-priority-evidence-bytes-per-atom@${task.atomId})`)]));
    expect(result.repairDiagnostics[0]?.evidenceMaterializationStatus).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: blockedPath, status: 'budget-exceeded', reason: 'max-priority-evidence-bytes-per-atom', budgetAtomIds: [task.atomId], priority: true }),
      expect.objectContaining({ path: missingPath, status: 'missing', reason: 'file-not-found', priority: true }),
    ]));
  });

  it('reports exhausted diagnostics and blocks candidate-reduce-gap artifacts when no owner localizes', async () => {
    const cwd = await workspace({});
    const content = prd(['unknown subsystem updates a missing owner path with localized repository evidence.']);
    const [task] = expectedTasks(content);
    const atom = completedOutput(task, 'initial');
    const harness = new StubHarness([
      atomSubmission(atom),
      reduceSubmission(sourceGapOutput(task, 'gap-owner')),
      atomSubmission(completedOutput(task, 'repair')),
      reduceSubmission(sourceGapOutput(task, 'gap-owner-after-repair')),
    ]);

    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 1 });

    expect(result.status).toBe('incomplete');
    expect(result.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('source localization repair exhausted:gap-owner-after-repair')]));
    expect(result.validationErrors).not.toEqual(expect.arrayContaining([expect.stringContaining('source localization repair exhausted:gap-owner:')]));
    expect(result.repairDiagnostics[0]).toMatchObject({ attempt: 1, status: 'exhausted', maxAttempts: 1, gapIds: ['gap-owner-after-repair'], gapClassifications: [{ gapId: 'gap-owner-after-repair', issueKind: 'missing-owner-path', sourceLocalizationSignal: true }], affectedAtomIds: [task.atomId], criterionIds: ['ac-001'], aspectIds: task.aspectIds, localizedOwnerPaths: [], localizedOwnerStatus: [], evidenceMaterializationStatus: [], unresolvedReason: 'no localized owner paths resolved', residueSynthesisBlocked: true });
    expect(result.repairDiagnostics[0]?.sourceNeedIds).toEqual([expect.stringContaining('missing-localized-owner-path')]);
    expect(result.repairDiagnostics[0]?.coverageStatus).toEqual({ criteria: { 'ac-001': 'covered' }, aspects: Object.fromEntries(task.aspectIds.map((aspectId) => [aspectId, 'covered'])), sourceNeeds: Object.fromEntries(result.repairDiagnostics[0]!.sourceNeedIds.map((needId) => [needId, 'covered'])) });
    expect(result.residue.candidates.some((candidate) => candidate.candidateId.includes('candidate-reduce-gap'))).toBe(false);
    expect(harness.calls.every((call) => call.tools === 'none')).toBe(true);
  });

  it('records each bounded repair attempt including intermediate unresolved diagnostics', async () => {
    const ownerPath = 'packages/api/src/routes/user.ts';
    const cwd = await workspace({ [ownerPath]: 'export function userRoute() { return "ok"; }\n' });
    const content = prd(['Account management workflows remain source-grounded with localized repository evidence.']);
    const [task] = expectedTasks(content);
    const firstAtom = completedOutput(task, 'initial');
    const repairOne = completedOutput(task, 'repair-one');
    const repairTwo = completedOutput(task, 'repair-two');
    const harness = new StubHarness([
      atomSubmission(firstAtom),
      reduceSubmission(sourceGapOutput(task, 'gap-owner', { ownerPaths: [ownerPath], affectedAtomIds: [] })),
      atomSubmission(repairOne),
      reduceSubmission(sourceGapOutput(task, 'gap-owner-still', { ownerPaths: [ownerPath], affectedAtomIds: [] })),
      atomSubmission(repairTwo),
      reduceSubmission(completedReduceOutput(repairTwo)),
    ]);

    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 2 });

    expect(result.status).toBe('complete');
    expect(result.repairDiagnostics).toHaveLength(2);
    expect(result.repairDiagnostics[0]).toMatchObject({ attempt: 1, maxAttempts: 2, status: 'unresolved', gapIds: ['gap-owner-still'], affectedAtomIds: [task.atomId], localizedOwnerPaths: [ownerPath], evidenceMaterializationStatus: [expect.objectContaining({ path: ownerPath, status: 'materialized' })] });
    expect(result.repairDiagnostics[0]?.coverageStatus.criteria).toEqual({ 'ac-001': 'covered' });
    expect(result.repairDiagnostics[0]?.sourceNeedIds.length).toBeGreaterThan(0);
    expect(result.repairDiagnostics[1]).toMatchObject({ attempt: 2, maxAttempts: 2, status: 'repaired', gapIds: ['gap-owner-still'], affectedAtomIds: [task.atomId], localizedOwnerPaths: [ownerPath], evidenceMaterializationStatus: [expect.objectContaining({ path: ownerPath, status: 'materialized' })] });
    expect(result.map.outputs[0]?.compactHandoff).toBe(`repair-two ${task.atomId}`);
  });

  it('reruns only affected atoms and preserves sorted prior outputs', async () => {
    const cwd = await workspace({ 'packages/engine/src/a.ts': 'export const a = 1;\n', 'packages/client/src/b.ts': 'export const b = 2;\n' });
    const content = prd(['engine updates `packages/engine/src/a.ts` with localized repository evidence.', 'client updates `packages/client/src/b.ts` with localized repository evidence.']);
    const [affectedTask, unaffectedTask] = expectedTasks(content);
    const affectedInitial = completedOutput(affectedTask, 'initial');
    const unaffectedInitial = completedOutput(unaffectedTask, 'initial');
    const affectedRepaired = completedOutput(affectedTask, 'repaired');
    const harness = new StubHarness([
      atomSubmission(affectedInitial),
      atomSubmission(unaffectedInitial),
      reduceSubmission(sourceGapOutput(affectedTask, 'gap-a')),
      atomSubmission(affectedRepaired),
      reduceSubmission(completedReduceOutput(affectedRepaired, unaffectedInitial)),
    ]);

    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 1 });

    expect(result.status).toBe('complete');
    expect(harness.customToolSets.filter((tools) => tools?.some((tool) => tool.name === 'submit_atom_output'))).toHaveLength(3);
    expect(result.map.outputs.map((output) => output.atomId)).toEqual([...result.map.outputs.map((output) => output.atomId)].sort());
    expect(result.map.outputs.find((output) => output.atomId === unaffectedTask.atomId)?.compactHandoff).toBe(`initial ${unaffectedTask.atomId}`);
    expect(result.map.outputs.find((output) => output.atomId === affectedTask.atomId)?.compactHandoff).toBe(`repaired ${affectedTask.atomId}`);
  });

  it('infers affected atoms from owner paths when reducer omits affected atom ids', async () => {
    const ownerPath = 'packages/engine/src/a.ts';
    const cwd = await workspace({ [ownerPath]: 'export const a = 1;\n', 'packages/client/src/b.ts': 'export const b = 2;\n' });
    const content = prd(['engine updates `packages/engine/src/a.ts` with localized repository evidence.', 'client updates `packages/client/src/b.ts` with localized repository evidence.']);
    const tasks = expectedTasks(content);
    const affectedTask = tasks.find((task) => task.evidencePaths.includes(ownerPath)) ?? tasks[0]!;
    const unaffectedTask = tasks.find((task) => task.atomId !== affectedTask.atomId)!;
    const initialOutputs = tasks.map((task) => completedOutput(task, 'initial'));
    const unaffectedInitial = initialOutputs.find((output) => output.atomId === unaffectedTask.atomId)!;
    const affectedRepaired = completedOutput(affectedTask, 'repaired');
    const harness = new StubHarness([
      ...initialOutputs.map((output) => atomSubmission(output)),
      reduceSubmission(sourceGapOutput(affectedTask, 'gap-a', { ownerPaths: [ownerPath], affectedAtomIds: [] })),
      atomSubmission(affectedRepaired),
      reduceSubmission(completedReduceOutput(affectedRepaired, unaffectedInitial)),
    ]);

    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 1 });

    expect(result.validationErrors).toEqual([]);
    expect(result.residue.validationErrors).toEqual([]);
    expect(result.status).toBe('complete');
    expect(harness.customToolSets.filter((tools) => tools?.some((tool) => tool.name === 'submit_atom_output'))).toHaveLength(3);
    expect(result.map.outputs.find((output) => output.atomId === unaffectedTask.atomId)?.compactHandoff).toBe(`initial ${unaffectedTask.atomId}`);
    expect(result.map.outputs.find((output) => output.atomId === affectedTask.atomId)?.compactHandoff).toBe(`repaired ${affectedTask.atomId}`);
    expect(result.repairDiagnostics[0]).toMatchObject({ status: 'repaired', affectedAtomIds: [affectedTask.atomId], localizedOwnerPaths: [ownerPath] });
  });

  it('classifies legacy unstructured source/localization reduce gaps', async () => {
    const cwd = await workspace({ 'packages/api/src/routes/user.ts': 'export function userRoute() { return "ok"; }\n' });
    const content = prd(['api route updates expose the user route contract with localized repository evidence.']);
    const [task] = expectedTasks(content);
    const atom = completedOutput(task, 'initial');
    const harness = new StubHarness([
      atomSubmission(atom),
      reduceSubmission({ nodeId: 'reduce-000-001', status: 'incomplete', compactSummary: 'legacy gaps', gaps: [
        { gapId: 'gap-dir', title: 'Directory evidence only', criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: 'Directory-only evidence packages/api does not include materialized source.', representationRequired: true },
        { gapId: 'gap-materialized', title: 'Missing materialized source', criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: 'Missing materialized source for packages/api/src/routes/user.ts.', representationRequired: true },
        { gapId: 'gap-ambiguous', title: 'Localization ambiguity', criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: 'Multiple candidates create localization ambiguity for the owner path.', representationRequired: true },
      ] }),
    ]);

    expect(classifyPlanningReduceGap({ gapId: 'gap-owner', title: 'Missing owner', criterionIds: ['ac-001'], aspectIds: ['aspect-1'], description: 'Missing localized owner for source need need-1.', representationRequired: true })).toMatchObject({ issueKind: 'missing-owner-path', sourceLocalizationSignal: true });
    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 0 });

    expect(result.status).toBe('incomplete');
    expect(result.repairDiagnostics[0]).toMatchObject({ attempt: 0, maxAttempts: 0, status: 'exhausted', gapIds: ['gap-ambiguous', 'gap-dir', 'gap-materialized'], unresolvedReason: 'repair attempts disabled', residueSynthesisBlocked: true });
    expect(result.repairDiagnostics[0]?.gapClassifications.map((item) => item.issueKind).sort()).toEqual(['directory-only-evidence', 'localization-ambiguity', 'missing-materialized-source']);
    expect(result.residue.candidates.some((candidate) => candidate.reason === 'reduce-gap')).toBe(false);
  });

  it('fails closed when multiple existing recovery owners remain ambiguous after repair', async () => {
    const owners = ['packages/engine/src/recovery/first.ts', 'packages/engine/src/recovery/second.ts'];
    const cwd = await workspace(Object.fromEntries(owners.map((owner, index) => [owner, `export const recovery${index} = true;\n`])));
    const content = prd(['Recovery reporting remains source-grounded with localized repository evidence.']);
    const [task] = expectedTasks(content);
    const ambiguousGap = (gapId: string): PlanningReduceOutput => ({
      ...sourceGapOutput(task, gapId, { ownerPaths: owners, affectedAtomIds: [] }),
      gaps: [{ ...sourceGapOutput(task, gapId, { ownerPaths: owners, affectedAtomIds: [] }).gaps![0]!, title: 'Ambiguous recovery owner', description: 'Multiple existing recovery owners remain ambiguous.', issueKind: 'localization-ambiguity' }],
    });
    const harness = new StubHarness([
      atomSubmission(completedOutput(task, 'initial')),
      reduceSubmission(ambiguousGap('gap-ambiguous-initial')),
      atomSubmission(completedOutput(task, 'repaired')),
      reduceSubmission(ambiguousGap('gap-ambiguous-final')),
    ]);

    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 1 });

    expect(result.status).toBe('incomplete');
    expect(result.repairDiagnostics[0]).toMatchObject({ status: 'exhausted', gapIds: ['gap-ambiguous-final'], gapClassifications: [{ gapId: 'gap-ambiguous-final', issueKind: 'localization-ambiguity' }], residueSynthesisBlocked: true });
    expect(result.residue.candidates.some((candidate) => candidate.candidateId.includes('candidate-reduce-gap'))).toBe(false);
  });

  it('remains incomplete when a rerun drops an unchanged ambiguity gap', async () => {
    const owners = ['packages/engine/src/recovery/first.ts', 'packages/engine/src/recovery/second.ts'];
    const cwd = await workspace(Object.fromEntries(owners.map((owner, index) => [owner, `export const recovery${index} = true;\n`])));
    const content = prd(['Recovery reporting remains source-grounded with localized repository evidence.']);
    const [task] = expectedTasks(content);
    const initial = sourceGapOutput(task, 'gap-ambiguous-initial', { ownerPaths: owners, affectedAtomIds: [] });
    initial.gaps![0] = { ...initial.gaps![0]!, title: 'Ambiguous recovery owner', description: 'Multiple existing recovery owners remain ambiguous.', issueKind: 'localization-ambiguity' };
    const harness = new StubHarness([
      atomSubmission(completedOutput(task, 'initial')),
      reduceSubmission(initial),
      atomSubmission(completedOutput(task, 'repaired')),
      reduceSubmission(completedReduceOutput(completedOutput(task, 'repaired'))),
    ]);

    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 1 });

    expect(result.status).toBe('incomplete');
    expect(result.repairDiagnostics[0]).toMatchObject({ status: 'exhausted', gapIds: ['gap-ambiguous-initial'] });
  });

  it('repairs a malformed reducer reference through the criterion-linked proposed recovery classifier file', async () => {
    const classifierPath = 'packages/engine/src/recovery/upstream-plan-root-cause-classifier.ts';
    const cwd = await workspace({ 'packages/engine/src/recovery/index.ts': 'export const recovery = true;\n' });
    const content = prd([`Add upstream plan root-cause reporting with a new classifier at \`${classifierPath}\`.`]);
    const [task] = expectedTasks(content);
    const malformedGap = sourceGapOutput(task, 'gap-classifier', { ownerPaths: [classifierPath], affectedAtomIds: [task.atomId] });
    malformedGap.gaps![0] = { ...malformedGap.gaps![0]!, sourceNeedIds: [task.atomId] };
    const harness = new StubHarness([
      atomSubmission(completedOutput(task, 'initial')),
      reduceSubmission(malformedGap),
      atomSubmission(completedOutput(task, 'repaired')),
      reduceSubmission(completedReduceOutput(completedOutput(task, 'repaired'))),
    ]);

    const result = await runBoundedPlannerCompiler({
      sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 1,
    });

    expect(result.status).toBe('complete');
    expect(result.map.outputs[0]?.moduleCandidates?.length).toBeGreaterThan(0);
    expect(result.validationErrors.join('\n')).not.toContain('classifier-owner-path-unlocalized');
    expect(result.validationErrors.join('\n')).not.toContain('no localized owner paths resolved');
  });

  it('ignores informational source-localization gaps for repair exhaustion', async () => {
    const cwd = await workspace({});
    const content = prd(['Event contract diagnostics remain informational when no representation is required.']);
    const [task] = expectedTasks(content);
    const atom = completedOutput(task, 'initial');
    const harness = new StubHarness([
      atomSubmission(atom),
      reduceSubmission({
        nodeId: 'reduce-000-001',
        status: 'completed',
        compactSummary: 'Informational source diagnostic only.',
        reduceDigest: { sourceId: 'reduce-000-001', sourceKind: 'reduce', status: 'completed', summary: 'Informational source diagnostic only.', criterionIds: task.criterionIds, aspectIds: task.aspectIds },
        gaps: [{ gapId: 'gap-info-source', title: 'Contract evidence advisory', criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: 'Exact event schema evidence was not present in the excerpt.', representationRequired: false, issueKind: 'missing-contract-evidence', sourceLocalizationSignal: true }],
        planFragments: atom.planFragments,
        moduleCandidates: atom.moduleCandidates,
      }),
    ]);

    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'repair.md', sourceHash: hash(content), cwd, harness, limits, maxRepairAttempts: 1 });

    expect(result.status).toBe('complete');
    expect(result.repairDiagnostics).toEqual([]);
    expect(result.validationErrors.some((error) => error.includes('source localization repair exhausted'))).toBe(false);
    expect(harness.calls).toHaveLength(2);
  });

  it('rejects prose slash fragments while extracting concrete owner paths from reduce gaps', () => {
    const classified = classifyPlanningReduceGap({
      gapId: 'gap-prose-paths',
      title: 'Missing owner paths',
      criterionIds: ['ac-001'],
      aspectIds: ['aspect-1'],
      description: 'Ignore Apply/resume, Abandon/approval, Config/reference, dirty/conflicting, and blocker/verdict; keep packages/engine/src/a.ts and docs/config.md.',
      representationRequired: true,
      issueKind: 'missing-owner-path',
      sourceLocalizationSignal: true,
    });

    expect(classified?.ownerPaths).toEqual(['docs/config.md', 'packages/engine/src/a.ts']);
  });

  it('treats exploration-only issue kinds as non-repair-triggering unless the reducer sets an explicit signal', () => {
    const base = { criterionIds: ['ac-001'], aspectIds: ['aspect-1'], representationRequired: true };
    // Descriptions carry regex bait ("budget", "broad directory") that the legacy inference would
    // reclassify into source-gap kinds; exploration-only kinds must not be re-inferred from text.
    const toolBudgetGap = { ...base, gapId: 'gap-budget', title: 'Exploration budget exhausted', description: 'Exploration tool budget exhausted before localization completed.', issueKind: 'tool-budget' as const };
    const tooBroadGap = { ...base, gapId: 'gap-broad', title: 'Scope too broad', description: 'Scope spans a broad directory of unrelated subsystems.', issueKind: 'too-broad' as const };

    expect(classifyPlanningReduceGap(toolBudgetGap)).toBeUndefined();
    expect(classifyPlanningReduceGap(tooBroadGap)).toBeUndefined();

    expect(classifyPlanningReduceGap({ ...toolBudgetGap, sourceLocalizationSignal: true })).toMatchObject({ issueKind: 'tool-budget', sourceLocalizationSignal: true });
    expect(classifyPlanningReduceGap({ ...tooBroadGap, sourceLocalizationSignal: true })).toMatchObject({ issueKind: 'too-broad', sourceLocalizationSignal: true });

    // Legacy gaps without an issueKind keep the existing inference fallback.
    expect(classifyPlanningReduceGap({ ...base, gapId: 'gap-legacy', title: 'Missing owner', description: 'Missing localized owner for source need need-1.' })).toMatchObject({ issueKind: 'missing-owner-path', sourceLocalizationSignal: true });
    expect(classifyPlanningReduceGap({ ...base, gapId: 'gap-generic', title: 'Advice', description: 'Consider a follow-up refactor.', issueKind: 'generic' as const })).toBeUndefined();
  });
});

function expectedTasks(content: string): PlanningAtomTask[] {
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'repair.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'repair.md', limits, inventory });
  return buildPlanningAtomTasks({ graph, inventory });
}

function atomSubmission(output: PlanningAtomOutput) {
  return { toolCalls: [{ tool: 'submit_atom_output', toolUseId: `submit-${output.atomId}`, input: output, output: 'ok' }] };
}

function reduceSubmission(output: PlanningReduceOutput) {
  return { toolCalls: [{ tool: 'submit_reduce_output', toolUseId: `submit-${output.nodeId}`, input: output, output: 'ok' }] };
}

function completedOutput(task: PlanningAtomTask, label: string): PlanningAtomOutput {
  return {
    atomId: task.atomId,
    status: 'completed',
    aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })),
    compactHandoff: `${label} ${task.atomId}`,
    planFragments: [{ fragmentId: `fragment-${label}-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${label} ${task.title}.` }],
    moduleCandidates: [{ moduleId: `module-${label}-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Implement ${label} ${task.title}.`, validationExpectation: 'Relevant checks pass.' }],
  };
}

function completedReduceOutput(...outputs: PlanningAtomOutput[]): PlanningReduceOutput {
  const criterionIds = outputs.flatMap((output) => output.moduleCandidates?.flatMap((module) => module.criterionIds) ?? []);
  const aspectIds = outputs.flatMap((output) => output.moduleCandidates?.flatMap((module) => module.aspectIds) ?? []);
  return { nodeId: 'reduce-000-001', status: 'completed', compactSummary: 'Repaired source localization produced product-scoped modules.', reduceDigest: { sourceId: 'reduce-000-001', sourceKind: 'reduce', status: 'completed', summary: 'Repaired source localization produced product-scoped modules.', criterionIds, aspectIds }, planFragments: outputs.flatMap((output) => output.planFragments ?? []), moduleCandidates: outputs.flatMap((output) => output.moduleCandidates ?? []) };
}

function sourceGapOutput(task: PlanningAtomTask, gapId: string, options: { ownerPaths?: string[]; affectedAtomIds?: string[] } = {}): PlanningReduceOutput {
  return {
    nodeId: 'reduce-000-001',
    status: 'incomplete',
    compactSummary: `Missing localized owner path for ${task.atomId}.`,
    gaps: [{ gapId, title: 'Missing localized owner path', criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Missing localized owner path${options.ownerPaths?.length ? ` ${options.ownerPaths.join(', ')}` : ''} prevents source-grounded product planning.`, representationRequired: true, issueKind: 'missing-owner-path', sourceLocalizationSignal: true, affectedAtomIds: options.affectedAtomIds ?? [task.atomId], ...(options.ownerPaths ? { ownerPaths: options.ownerPaths } : {}) }],
  };
}

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eforge-repair-loop-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }
  return root;
}
