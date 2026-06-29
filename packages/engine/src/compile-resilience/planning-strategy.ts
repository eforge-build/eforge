import type { CompilePreflightRisk, CompilePipelineScope } from '../events.js';

export type CompilePlanningStrategy = 'direct' | 'context-managed-decomposition';

export interface SelectCompilePlanningStrategyInput {
  risk?: CompilePreflightRisk;
  selectedScope: CompilePipelineScope;
}

export function selectCompilePlanningStrategy(input: SelectCompilePlanningStrategyInput): CompilePlanningStrategy {
  return isOverflowBoundedDecomposition(input.risk) ? 'context-managed-decomposition' : 'direct';
}

export function isOverflowBoundedDecomposition(risk: CompilePreflightRisk | undefined): boolean {
  return risk?.level === 'overflow-risk' && risk.recommendation.action === 'bounded-decomposition';
}

export function recommendedCompileRecoveryAction(risk: CompilePreflightRisk | undefined): string | undefined {
  return risk?.recommendation.action;
}
