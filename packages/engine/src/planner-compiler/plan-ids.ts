import type { PlanningSynthesizedModulePlan } from './plan-artifact-synthesis.js';

export function derivePlanIds(modules: PlanningSynthesizedModulePlan[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const [index, module] of modules.entries()) ids.set(module.moduleId, safePlanId(module.moduleId, index));
  return ids;
}

export function safePlanId(moduleId: string, index: number): string {
  if (/^[A-Za-z0-9_-]+$/.test(moduleId) && !moduleId.includes('..')) return moduleId;
  const slug = moduleId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'module';
  return `plan-${String(index + 1).padStart(2, '0')}-${slug}`;
}

export function requirePlanId(planIds: Map<string, string>, moduleId: string): string {
  const planId = planIds.get(moduleId);
  if (!planId) throw new Error(`Missing plan id for module dependency:${moduleId}`);
  return planId;
}
