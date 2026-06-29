import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import type { PipelineContext } from '../../pipeline/types.js';
import type { PlanningDecompositionGraph, PlanningDecompositionUnit, PlanningUnitOutput } from '../planning-decomposition.js';

const FORBIDDEN = new Set(['sourceContent', 'rawSource', 'prompt', 'transcript', 'rawTranscript']);
const MAX_NOTE_ITEMS = 12;
const MAX_TEXT = 500;

export function decompositionDir(ctx: PipelineContext): string {
  return resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName, '.decomposition');
}

export function unitArtifactDir(ctx: PipelineContext, unitId: string): string {
  return resolve(decompositionDir(ctx), 'units', unitId);
}

export async function initializeDecompositionArtifacts(ctx: PipelineContext, graph: PlanningDecompositionGraph): Promise<string> {
  const dir = decompositionDir(ctx);
  await mkdir(resolve(dir, 'units'), { recursive: true });
  await writeGraphArtifact(ctx, graph);
  return dir;
}

export async function writeGraphArtifact(ctx: PipelineContext, graph: PlanningDecompositionGraph): Promise<string> {
  const path = resolve(decompositionDir(ctx), 'graph.json');
  await persistJson(path, graph);
  return path;
}

export async function writeUnitOutputArtifact(ctx: PipelineContext, output: PlanningUnitOutput): Promise<string> {
  assertNoForbiddenKeys(output);
  const dir = unitArtifactDir(ctx, output.unitId);
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, 'output.json');
  await persistJson(path, sanitizedUnitOutput(output));
  return path;
}

function sanitizedUnitOutput(output: PlanningUnitOutput): Record<string, unknown> {
  return {
    unitId: output.unitId,
    ...(output.artifactPath !== undefined ? { artifactPath: output.artifactPath } : {}),
    ...(output.byteLength !== undefined ? { byteLength: output.byteLength } : {}),
    ...(output.contentHash !== undefined ? { contentHash: output.contentHash } : {}),
    ...(output.status !== undefined ? { status: output.status } : {}),
    ...(output.coveredCriteria !== undefined ? { coveredCriteria: [...output.coveredCriteria] } : {}),
    ...(output.discoveredFiles !== undefined ? { discoveredFiles: boundedStrings(output.discoveredFiles) } : {}),
    ...(output.sharedContractNotes !== undefined ? { sharedContractNotes: boundedStrings(output.sharedContractNotes) } : {}),
    ...(output.moduleSuggestions !== undefined ? { moduleSuggestions: output.moduleSuggestions.slice(0, MAX_NOTE_ITEMS).map((module) => ({ id: module.id, description: cap(module.description), dependsOn: [...module.dependsOn] })) } : {}),
    ...(output.planSuggestions !== undefined ? { planSuggestions: output.planSuggestions.slice(0, MAX_NOTE_ITEMS).map((plan) => ({ id: plan.id, ...(plan.name !== undefined ? { name: cap(plan.name) } : {}), ...(plan.dependsOn !== undefined ? { dependsOn: [...plan.dependsOn] } : {}) })) } : {}),
    ...(output.unresolvedRequirements !== undefined ? { unresolvedRequirements: output.unresolvedRequirements.slice(0, MAX_NOTE_ITEMS).map((item) => ({ criterionId: item.criterionId, reason: cap(item.reason), ...(item.evidence !== undefined ? { evidence: cap(item.evidence) } : {}) })) } : {}),
    ...(output.compactHandoffRef !== undefined ? { compactHandoffRef: output.compactHandoffRef } : {}),
    ...(output.synthesisNotes !== undefined ? { synthesisNotes: boundedStrings(output.synthesisNotes) } : {}),
    ...(output.observedBudget !== undefined ? { observedBudget: output.observedBudget } : {}),
  };
}

function boundedStrings(items: readonly string[]): string[] {
  const kept = items.slice(0, MAX_NOTE_ITEMS).map((item) => cap(item));
  if (items.length > MAX_NOTE_ITEMS) kept.push(`[omitted ${items.length - MAX_NOTE_ITEMS} item(s)]`);
  return kept;
}

function cap(value: string): string {
  return value.length <= MAX_TEXT ? value : `${value.slice(0, MAX_TEXT - 1)}…`;
}

export function artifactRef(ctx: PipelineContext, absPath: string): string {
  return relative(resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName), absPath).replaceAll('\\', '/');
}

export async function readUnitSourceSlice(ctx: PipelineContext, unit: PlanningDecompositionUnit): Promise<string> {
  const lines = ctx.sourceContent.split(/\r?\n/);
  const source = Buffer.from(ctx.sourceContent, 'utf8');
  const parts: string[] = [];
  for (const slice of unit.sourceSlices) {
    if (typeof slice.byteStart === 'number' && typeof slice.byteEnd === 'number' && slice.byteEnd >= slice.byteStart) {
      parts.push(source.subarray(slice.byteStart, slice.byteEnd).toString('utf8'));
    } else if (slice.startLine && slice.endLine && slice.endLine >= slice.startLine) {
      parts.push(lines.slice(slice.startLine - 1, slice.endLine).join('\n'));
    }
  }
  const text = parts.filter(Boolean).join('\n\n---\n\n');
  return text || source.subarray(0, unit.budgets.maxPromptSourceBytes).toString('utf8');
}

export async function assertPersistedJsonOmitsForbiddenFields(path: string): Promise<void> {
  assertNoForbiddenKeys(JSON.parse(await readFile(path, 'utf8')));
}

async function persistJson(path: string, value: unknown): Promise<void> {
  assertNoForbiddenKeys(value);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function assertNoForbiddenKeys(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN.has(key)) throw new Error(`Forbidden raw field ${path}.${key} cannot be persisted in decomposition artifacts`);
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}
