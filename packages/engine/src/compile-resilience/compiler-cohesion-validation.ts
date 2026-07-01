import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { OrchestrationConfig, PlanFile } from '../events.js';
import { parseArchitectureManifest, type PlanningArchitectureManifest } from '../planner-compiler/architecture-manifest-contracts.js';
import { COMPILER_DIAGNOSTICS_ARTIFACT, validateCompilerDiagnostics, type CompilerDiagnostics } from '../planner-compiler/compiler-diagnostics-contracts.js';

export interface ValidateCompilerCohesionInput {
  planDir: string;
  rel: (path: string) => string;
  orchestration: OrchestrationConfig;
  plans: PlanFile[];
}

export interface CompilerCohesionValidationResult {
  details: string[];
  warnings: string[];
}

export async function validateCompilerCohesion(input: ValidateCompilerCohesionInput): Promise<CompilerCohesionValidationResult> {
  const details: string[] = [];
  const warnings: string[] = [];
  const diagnostics = await readDiagnostics(input, details);
  const architecture = await readArchitecture(input, details);
  if (architecture?.manifest) {
    validatePlanAgreement(architecture.manifest, architecture.markdown, input.orchestration, details);
    validateFileOwnership(architecture.manifest, input.orchestration, details);
  }
  await validateCoverageAgreement(input, details);
  if (diagnostics) validateGapPreservation(diagnostics, architecture?.manifest, input.orchestration, details);
  return { details: [...new Set(details)].sort(), warnings };
}

async function readDiagnostics(input: ValidateCompilerCohesionInput, details: string[]): Promise<CompilerDiagnostics | undefined> {
  const diagnosticsPath = resolve(input.planDir, COMPILER_DIAGNOSTICS_ARTIFACT);
  let raw: string;
  try {
    raw = await readFile(diagnosticsPath, 'utf8');
  } catch (err) {
    details.push(`${input.rel(diagnosticsPath)}: unreadable compiler diagnostics: ${errorMessage(err)}`);
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    details.push(`${input.rel(diagnosticsPath)}: compiler diagnostics is not valid JSON: ${errorMessage(err)}`);
    return undefined;
  }
  const validation = validateCompilerDiagnostics(value);
  if (!validation.ok) {
    details.push(...validation.errors.slice(0, 8).map((error) => `${input.rel(diagnosticsPath)}: ${error}`));
    return undefined;
  }
  return value as CompilerDiagnostics;
}

async function readArchitecture(input: ValidateCompilerCohesionInput, details: string[]): Promise<{ markdown: string; manifest?: PlanningArchitectureManifest } | undefined> {
  const architecturePath = resolve(input.planDir, 'architecture.md');
  let markdown: string;
  try {
    markdown = await readFile(architecturePath, 'utf8');
  } catch (err) {
    details.push(`${input.rel(architecturePath)}: unreadable architecture.md: ${errorMessage(err)}`);
    return undefined;
  }
  const parsed = parseArchitectureManifest(markdown);
  if (!parsed.manifest) {
    details.push(...parsed.errors.map((error) => `${input.rel(architecturePath)}: ${error}`));
    return { markdown };
  }
  return { markdown, manifest: parsed.manifest };
}

function validatePlanAgreement(manifest: PlanningArchitectureManifest, markdown: string, orchestration: OrchestrationConfig, details: string[]): void {
  const manifestPlans = new Map(manifest.plans.map((plan) => [plan.planId, plan]));
  const orchestrationPlans = new Map(orchestration.plans.map((plan) => [plan.id, plan]));
  for (const planId of manifestPlans.keys()) {
    if (!orchestrationPlans.has(planId)) details.push(`architecture manifest plan missing from orchestration: ${planId}`);
  }
  for (const planId of orchestrationPlans.keys()) {
    if (!manifestPlans.has(planId)) details.push(`orchestration plan missing from architecture manifest: ${planId}`);
    if (!markdown.includes(`### ${planId} `) && !markdown.includes(`### ${planId} —`)) details.push(`architecture.md missing plan boundary heading: ${planId}`);
  }
  for (const [planId, manifestPlan] of manifestPlans) {
    const orchestrationPlan = orchestrationPlans.get(planId);
    if (!orchestrationPlan) continue;
    const manifestDeps = [...manifestPlan.dependsOnPlanIds].sort().join(',');
    const orchestrationDeps = [...(orchestrationPlan.dependsOn ?? [])].sort().join(',');
    if (manifestDeps !== orchestrationDeps) details.push(`plan dependency mismatch for ${planId}: architecture manifest [${manifestDeps}] vs orchestration [${orchestrationDeps}]`);
  }
}

function validateFileOwnership(manifest: PlanningArchitectureManifest, orchestration: OrchestrationConfig, details: string[]): void {
  const ownersByPath = new Map<string, string[]>();
  for (const entry of manifest.fileOwnership) {
    ownersByPath.set(entry.path, uniq([...(ownersByPath.get(entry.path) ?? []), ...entry.ownerPlanIds]));
  }
  const connected = dependencyConnectivity(orchestration);
  for (const [path, owners] of [...ownersByPath.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (let i = 0; i < owners.length; i += 1) {
      for (let j = i + 1; j < owners.length; j += 1) {
        const [planA, planB] = [owners[i], owners[j]].sort();
        if (!connected(planA, planB)) details.push(`file ownership conflict: ${path} claimed by ${planA} and ${planB} without a declared dependency`);
      }
    }
  }
}

function dependencyConnectivity(orchestration: OrchestrationConfig): (a: string, b: string) => boolean {
  const adjacency = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    adjacency.set(from, (adjacency.get(from) ?? new Set()).add(to));
    adjacency.set(to, (adjacency.get(to) ?? new Set()).add(from));
  };
  for (const plan of orchestration.plans) {
    for (const dependency of plan.dependsOn ?? []) link(plan.id, dependency);
  }
  return (a: string, b: string): boolean => {
    if (a === b) return true;
    const visited = new Set<string>([a]);
    const queue = [a];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adjacency.get(current) ?? []) {
        if (next === b) return true;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
}

async function validateCoverageAgreement(input: ValidateCompilerCohesionInput, details: string[]): Promise<void> {
  const coveragePath = resolve(input.planDir, 'acceptance-coverage.md');
  let coverage: string;
  try {
    coverage = await readFile(coveragePath, 'utf8');
  } catch (err) {
    details.push(`${input.rel(coveragePath)}: unreadable acceptance-coverage.md: ${errorMessage(err)}`);
    return;
  }
  const completeCriteria = coverageCriteria(coverage, 'Complete criteria');
  const incompleteCriteria = coverageCriteria(coverage, 'Incomplete criteria');
  const knownCriteria = new Set([...completeCriteria, ...incompleteCriteria]);
  const criteriaByPlan = new Map(input.plans.map((plan) => [plan.id, planTraceabilityCriteria(plan.body)]));
  const referencedCriteria = new Set([...criteriaByPlan.values()].flat());
  for (const criterion of completeCriteria) {
    if (!referencedCriteria.has(criterion)) details.push(`complete criterion not referenced by any plan: ${criterion}`);
  }
  for (const [planId, criteria] of criteriaByPlan) {
    for (const criterion of criteria) {
      if (!knownCriteria.has(criterion)) details.push(`plan ${planId} references criterion absent from acceptance-coverage.md: ${criterion}`);
    }
  }
}

function coverageCriteria(coverage: string, label: string): string[] {
  const match = coverage.match(new RegExp(`^${label}: (.+)$`, 'm'));
  if (!match || match[1].trim() === '(none)') return [];
  return match[1].split(',').map((value) => value.trim()).filter((value) => value.length > 0);
}

function planTraceabilityCriteria(body: string): string[] {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => line.trim() === '## Traceability');
  if (start === -1) return [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.startsWith('Criteria: ')) return line.slice('Criteria: '.length).split(',').map((value) => value.trim()).filter((value) => value.length > 0);
  }
  return [];
}

function validateGapPreservation(diagnostics: CompilerDiagnostics, manifest: PlanningArchitectureManifest | undefined, orchestration: OrchestrationConfig, details: string[]): void {
  const planIds = new Set(orchestration.plans.map((plan) => plan.id));
  const successfulCompile = diagnostics.compilerStatus === 'complete' || diagnostics.compilerStatus === 'complete-with-residue';
  for (const gap of diagnostics.reduce.gaps) {
    if (gap.representationRequired && gap.resolution === 'unrepresented' && successfulCompile) {
      details.push(`reduce gap requires representation but is unrepresented: ${gap.gapId}`);
    }
    if (gap.resolution === 'residue-represented' && gap.representedByCandidateId && !planIds.has(gap.representedByCandidateId)) {
      details.push(`reduce gap ${gap.gapId} represented by unknown plan: ${gap.representedByCandidateId}`);
    }
  }
  for (const conflict of diagnostics.reduce.conflicts) {
    if (conflict.resolution === 'residue-represented' && conflict.representedByCandidateId && !planIds.has(conflict.representedByCandidateId)) {
      details.push(`reduce conflict ${conflict.conflictId} represented by unknown plan: ${conflict.representedByCandidateId}`);
    }
  }
  if (manifest) {
    const manifestConflictIds = new Set(manifest.conflicts.map((conflict) => conflict.conflictId));
    const diagnosticsConflictIds = new Set(diagnostics.reduce.conflicts.map((conflict) => conflict.conflictId));
    for (const conflictId of diagnosticsConflictIds) {
      if (!manifestConflictIds.has(conflictId)) details.push(`reduce conflict missing from architecture manifest: ${conflictId}`);
    }
    for (const conflictId of manifestConflictIds) {
      if (!diagnosticsConflictIds.has(conflictId)) details.push(`architecture manifest conflict missing from compiler diagnostics: ${conflictId}`);
    }
  }
}

function uniq(values: string[]): string[] { return [...new Set(values)].sort(); }
function errorMessage(err: unknown): string { return err instanceof Error ? err.message : String(err); }
