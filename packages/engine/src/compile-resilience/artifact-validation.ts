import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import type { CompileArtifactSummary, OrchestrationConfig, PlanFile } from '../events.js';
import { MAX_COMPILE_RISK_LIST_ITEMS } from '../events.js';
import { parseExpeditionIndex, parseOrchestrationConfig, parsePlanFile, validatePlanSet } from '../plan.js';
import { COMPILER_DIAGNOSTICS_ARTIFACT } from '../planner-compiler/compiler-diagnostics-contracts.js';
import type { PipelineContext } from '../pipeline/types.js';
import { validateCompilerCohesion } from './compiler-cohesion-validation.js';

export const MAX_COMPILE_ARTIFACT_FAILURE_MESSAGE_BYTES = 4_096;
export const MAX_COMPILE_ARTIFACT_DETAIL_BYTES = 512;

export interface ValidateCompileArtifactsOptions {
  /**
   * 'require' fails validation when compiler-diagnostics.json is absent (bounded
   * planner compiler path). 'auto' runs the compiler cohesion checks only when the
   * artifact exists, so legacy plan sets validate exactly as before.
   */
  compilerArtifacts?: 'require' | 'auto';
}

export type CompileArtifactValidationResult =
  | {
      ok: true;
      skipped: boolean;
      summary: CompileArtifactSummary;
      plans: PlanFile[];
      orchestration?: OrchestrationConfig;
      warnings: string[];
    }
  | {
      ok: false;
      skipped: false;
      summary: CompileArtifactSummary;
      message: string;
      details: string[];
      warnings: string[];
    };

export type ExpeditionModuleInputValidationResult =
  | { ok: true; moduleCount: number }
  | {
      ok: false;
      message: string;
      missingModuleFiles: string[];
      emptyModuleFiles: string[];
      invalidModuleIds: string[];
      moduleCount: number;
    };

// --- eforge:region compile-artifact-validation ---
export async function validateCompileArtifacts(
  ctx: PipelineContext,
  options?: ValidateCompileArtifactsOptions,
): Promise<CompileArtifactValidationResult> {
  const planDir = resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName);
  const orchPath = resolve(planDir, 'orchestration.yaml');
  const orchestrationExists = existsSync(orchPath);

  if (ctx.skipped === true) {
    return skippedCompileResult(ctx, orchestrationExists, orchPath);
  }

  if (!orchestrationExists) {
    const summary = emptyArtifactSummary(false);
    return failure(summary, [`Missing orchestration.yaml at ${rel(ctx, orchPath)}`], []);
  }

  let orchConfig: OrchestrationConfig;
  const warnings: string[] = [];
  try {
    orchConfig = await parseOrchestrationConfig(orchPath);
    warnings.push(...(orchConfig.warnings ?? []));
  } catch (err) {
    return failure(emptyArtifactSummary(true), [`Failed to parse orchestration.yaml: ${errorMessage(err)}`], warnings);
  }

  const summary: CompileArtifactSummary = emptyArtifactSummary(true);
  const details: string[] = [];
  const plans: PlanFile[] = [];

  if (!stablePipelineEquals(orchConfig.pipeline, ctx.pipeline)) {
    details.push('orchestration.pipeline does not match the effective compile pipeline');
  }

  const planSetValidation = await validatePlanSet(orchPath);
  if (!planSetValidation.valid) {
    details.push(...planSetValidation.errors.map((error) => `validatePlanSet: ${error}`));
  }

  if (orchConfig.plans.length === 0) {
    details.push('orchestration.yaml has no plans');
  }

  for (const planEntry of orchConfig.plans) {
    const planPath = resolve(planDir, `${planEntry.id}.md`);
    const planRel = rel(ctx, planPath);
    if (!existsSync(planPath)) {
      summary.missingPlanFileCount += 1;
      pushBounded(summary.missingPlanFiles, planRel);
      continue;
    }

    try {
      const plan = await parsePlanFile(planPath, ctx.config.agents?.tiers);
      const planWarnings = plan.warnings?.map((warning) => `[${planEntry.id}] ${warning}`) ?? [];
      warnings.push(...planWarnings);
      const invalidReasons = planMismatchReasons(planEntry, plan);
      if (invalidReasons.length > 0) {
        summary.invalidPlanCount += 1;
        pushBounded(summary.invalidPlanFiles, planRel);
        details.push(`${planRel}: ${invalidReasons.join('; ')}`);
      } else {
        summary.validPlanCount += 1;
        plans.push(plan);
      }
    } catch (err) {
      summary.invalidPlanCount += 1;
      pushBounded(summary.invalidPlanFiles, planRel);
      details.push(`${planRel}: ${errorMessage(err)}`);
    }
  }

  const diagnosticsPath = resolve(planDir, COMPILER_DIAGNOSTICS_ARTIFACT);
  const diagnosticsExists = existsSync(diagnosticsPath);
  if ((options?.compilerArtifacts ?? 'auto') === 'require' && !diagnosticsExists) {
    details.push(`missing ${COMPILER_DIAGNOSTICS_ARTIFACT} at ${rel(ctx, diagnosticsPath)}`);
  } else if (diagnosticsExists && summary.missingPlanFileCount === 0 && summary.invalidPlanCount === 0) {
    const cohesion = await validateCompilerCohesion({ planDir, rel: (path) => rel(ctx, path), orchestration: orchConfig, plans });
    details.push(...cohesion.details);
    warnings.push(...cohesion.warnings);
  }

  if (summary.missingPlanFileCount > 0 || summary.invalidPlanCount > 0 || details.length > 0) {
    return failure(summary, details, warnings);
  }

  return { ok: true, skipped: false, summary, plans, orchestration: orchConfig, warnings };
}

export async function validateExpeditionModuleInputs(
  ctx: PipelineContext,
): Promise<ExpeditionModuleInputValidationResult> {
  if (ctx.expeditionModules.length === 0) return { ok: true, moduleCount: 0 };

  const planDir = resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName);
  const indexPath = resolve(planDir, 'index.yaml');
  const modulesDir = resolve(planDir, 'modules');
  const missingModuleFiles: string[] = [];
  const emptyModuleFiles: string[] = [];
  const invalidModuleIds: string[] = [];

  let index;
  try {
    index = await parseExpeditionIndex(indexPath);
  } catch (err) {
    return expeditionFailure({
      details: [`Invalid expedition index.yaml: ${errorMessage(err)}`],
      missingModuleFiles,
      emptyModuleFiles,
      invalidModuleIds,
      moduleCount: ctx.expeditionModules.length,
    });
  }

  const ctxIds = new Set(ctx.expeditionModules.map((mod) => mod.id));
  const indexIds = new Set(Object.keys(index.modules));
  for (const id of [...ctxIds].sort()) {
    if (!indexIds.has(id)) pushBounded(invalidModuleIds, `missing from index.yaml: ${id}`);
  }
  for (const id of [...indexIds].sort()) {
    if (!ctxIds.has(id)) pushBounded(invalidModuleIds, `unexpected in index.yaml: ${id}`);
  }

  for (const id of [...indexIds].sort()) {
    const modulePath = resolve(modulesDir, `${id}.md`);
    const moduleRel = rel(ctx, modulePath);
    if (!existsSync(modulePath)) {
      pushBounded(missingModuleFiles, moduleRel);
      continue;
    }
    const content = await readFile(modulePath, 'utf-8');
    if (content.trim().length === 0) pushBounded(emptyModuleFiles, moduleRel);
  }

  if (missingModuleFiles.length > 0 || emptyModuleFiles.length > 0 || invalidModuleIds.length > 0) {
    return expeditionFailure({
      details: [
        ...missingModuleFiles.map((path) => `missing expedition module: ${path}`),
        ...emptyModuleFiles.map((path) => `empty expedition module: ${path}`),
        ...invalidModuleIds.map((id) => `invalid expedition module id: ${id}`),
      ],
      missingModuleFiles,
      emptyModuleFiles,
      invalidModuleIds,
      moduleCount: indexIds.size,
    });
  }

  return { ok: true, moduleCount: indexIds.size };
}
// --- eforge:endregion compile-artifact-validation ---

// --- eforge:region compile-artifact-validation-helpers ---
async function skippedCompileResult(ctx: PipelineContext, orchestrationExists: boolean, orchPath: string): Promise<CompileArtifactValidationResult> {
  if (!orchestrationExists) {
    return { ok: true, skipped: true, summary: emptyArtifactSummary(false), plans: [], warnings: [] };
  }
  try {
    const orch = await parseOrchestrationConfig(orchPath);
    const summary = emptyArtifactSummary(true);
    for (const plan of orch.plans) {
      const planPath = resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName, `${plan.id}.md`);
      if (existsSync(planPath)) summary.validPlanCount += 1;
      else summary.missingPlanFileCount += 1;
    }
    return { ok: true, skipped: true, summary, plans: [], orchestration: orch, warnings: orch.warnings ?? [] };
  } catch {
    return { ok: true, skipped: true, summary: emptyArtifactSummary(true), plans: [], warnings: [] };
  }
}

function planMismatchReasons(planEntry: OrchestrationConfig['plans'][number], plan: PlanFile): string[] {
  const reasons: string[] = [];
  if (plan.id !== planEntry.id) reasons.push(`frontmatter id '${plan.id}' does not match orchestration id '${planEntry.id}'`);
  if (plan.branch !== planEntry.branch) reasons.push(`frontmatter branch '${plan.branch}' does not match orchestration branch '${planEntry.branch}'`);
  if (plan.body.trim().length === 0) reasons.push('empty plan body');
  return reasons;
}

function stablePipelineEquals(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function failure(summary: CompileArtifactSummary, details: string[], warnings: string[]): CompileArtifactValidationResult {
  const boundedDetails = details.map((detail) => truncateUtf8(detail, MAX_COMPILE_ARTIFACT_DETAIL_BYTES));
  return {
    ok: false,
    skipped: false,
    summary,
    message: formatCompileArtifactFailure(summary, boundedDetails),
    details: boundedDetails,
    warnings,
  };
}

function formatCompileArtifactFailure(summary: CompileArtifactSummary, details: string[]): string {
  const lines = [
    'Compile artifact validation failed.',
    `orchestrationExists=${summary.orchestrationExists}`,
    `validPlanCount=${summary.validPlanCount}`,
    `invalidPlanCount=${summary.invalidPlanCount}`,
    `missingPlanFileCount=${summary.missingPlanFileCount}`,
    ...summary.missingPlanFiles.map((path) => `missing plan file: ${path}`),
    ...summary.invalidPlanFiles.map((path) => `invalid plan file: ${path}`),
    ...details,
  ];
  return truncateUtf8(lines.join('\n'), MAX_COMPILE_ARTIFACT_FAILURE_MESSAGE_BYTES);
}

function expeditionFailure(input: {
  details: string[];
  missingModuleFiles: string[];
  emptyModuleFiles: string[];
  invalidModuleIds: string[];
  moduleCount: number;
}): ExpeditionModuleInputValidationResult {
  const message = truncateUtf8(['Expedition module input validation failed.', ...input.details].join('\n'), MAX_COMPILE_ARTIFACT_FAILURE_MESSAGE_BYTES);
  return { ok: false, message, missingModuleFiles: input.missingModuleFiles, emptyModuleFiles: input.emptyModuleFiles, invalidModuleIds: input.invalidModuleIds, moduleCount: input.moduleCount };
}

function emptyArtifactSummary(orchestrationExists: boolean): CompileArtifactSummary {
  return {
    orchestrationExists,
    validPlanCount: 0,
    invalidPlanCount: 0,
    missingPlanFileCount: 0,
    missingPlanFiles: [],
    invalidPlanFiles: [],
  };
}

function pushBounded(items: string[], item: string): void {
  if (items.length < MAX_COMPILE_RISK_LIST_ITEMS) items.push(truncateUtf8(item, MAX_COMPILE_ARTIFACT_DETAIL_BYTES));
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;
  let output = '';
  for (const char of value) {
    const next = `${output}${char}`;
    if (encoder.encode(`${next}…`).length > maxBytes) return `${output}…`;
    output = next;
  }
  return output;
}

function rel(ctx: PipelineContext, path: string): string {
  return relative(ctx.cwd, path) || path;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
// --- eforge:endregion compile-artifact-validation-helpers ---
