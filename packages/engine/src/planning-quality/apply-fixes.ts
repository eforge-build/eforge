/**
 * Engine-applied fix mechanism for the planning quality reviewer.
 *
 * Plan/orchestration fixes delegate to applyPlanReviewFixes and architecture
 * fixes to applyArchitectureReviewFixes so all serialization stays in plan.ts;
 * acceptance-coverage.md replacements are written directly. Fixes remain
 * unstaged (same contract as the delegated apply functions).
 */
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PlanningDecompositionLimits } from '@eforge-build/client';

import { applyArchitectureReviewFixes, applyPlanReviewFixes } from '../plan.js';
import type { ArchitectureReviewSubmission, PlanReviewSubmission } from '../schemas.js';
import type { PlanningQualityReviewSubmission, PlanningQualityStructuralFix } from './schemas.js';
import { applyStructuralPlanningQualityFixes } from './structural-transforms.js';

type PlanningQualityReviewFix = PlanningQualityReviewSubmission['fixes'][number];

interface ApplyPlanningQualityReviewFixesOptions {
  cwd: string;
  outputDir: string;
  planSetName: string;
  fixes: PlanningQualityReviewSubmission['fixes'];
  limits?: PlanningDecompositionLimits;
}

function isPlanFix(fix: PlanningQualityReviewFix): fix is PlanReviewSubmission['fixes'][number] {
  return fix.kind === 'replace_orchestration' || fix.kind === 'replace_plan_file' || fix.kind === 'replace_plan_body';
}

function isArchitectureFix(fix: PlanningQualityReviewFix): fix is ArchitectureReviewSubmission['fixes'][number] {
  return fix.kind === 'replace_architecture';
}

function isStructuralFix(fix: PlanningQualityReviewFix): fix is PlanningQualityStructuralFix {
  return fix.kind === 'merge_plans' || fix.kind === 'remove_redundant_stage' || fix.kind === 'reduce_review_depth';
}

/**
 * Apply fixes emitted by the planning quality reviewer to compiler planning
 * artifacts. compiler-diagnostics.json has no fix variant by design — the
 * reviewer cannot modify diagnostics. Returns the repository-relative atomic
 * path group for structural fixes and does NOT run git add.
 */
export async function applyPlanningQualityReviewFixes(options: ApplyPlanningQualityReviewFixesOptions): Promise<string[]> {
  const { cwd, outputDir, planSetName, fixes } = options;
  if (fixes.length === 0) return [];

  const structuralFixes = fixes.filter(isStructuralFix);
  if (structuralFixes.length > 0) {
    if (structuralFixes.length !== fixes.length) throw new Error('Structural planning fixes cannot be mixed with whole-file replacement fixes');
    if (!options.limits) throw new Error('Structural planning fixes require decomposition limits');
    return applyStructuralPlanningQualityFixes({ cwd, outputDir, planSetName, fixes: structuralFixes, limits: options.limits });
  }

  const planFixes = fixes.filter(isPlanFix);
  const architectureFixes = fixes.filter(isArchitectureFix);
  const coverageFixes = fixes.filter((fix) => fix.kind === 'replace_acceptance_coverage');

  const errors: Error[] = [];

  if (planFixes.length > 0) {
    try {
      await applyPlanReviewFixes({ cwd, outputDir, planSetName, fixes: planFixes });
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }

  if (architectureFixes.length > 0) {
    try {
      await applyArchitectureReviewFixes({ cwd, outputDir, planSetName, fixes: architectureFixes });
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }

  for (const fix of coverageFixes) {
    if (fix.kind !== 'replace_acceptance_coverage') continue;
    try {
      await writeFile(resolve(cwd, outputDir, planSetName, 'acceptance-coverage.md'), fix.content, 'utf-8');
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }

  if (errors.length > 0) {
    const messages = errors.map((e, i) => `  Fix group ${i + 1}: ${e.message}`).join('\n');
    throw new Error(`applyPlanningQualityReviewFixes encountered ${errors.length} error(s):\n${messages}`);
  }
  return [];
}
