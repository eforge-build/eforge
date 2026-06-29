import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import type { PipelineContext } from '../../pipeline/types.js';
import type { PlanningDecompositionGraph, PlanningDecompositionUnit, PlanningUnitOutput } from '../planning-decomposition.js';

const FORBIDDEN = new Set(['sourceContent', 'rawSource', 'prompt', 'transcript', 'rawTranscript']);

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
  const dir = unitArtifactDir(ctx, output.unitId);
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, 'output.json');
  await persistJson(path, output);
  return path;
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
