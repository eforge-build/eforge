/**
 * Built-in compile stages.
 *
 * The compile pipeline is constant: the planner stage runs the bounded
 * planner compiler, then the planning-quality-review-cycle stage
 * (registered in planning-quality-review-cycle.ts) gates the artifacts.
 */

import { registerCompileStage } from '../registry.js';
import { runBoundedPlannerCompilerCompileStage } from '../../planner-compiler/compile-stage-integration.js';

registerCompileStage({
  name: 'planner',
  phase: 'compile',
  description: 'Runs the bounded planner compiler to decompose a PRD into implementation plans with dependency graphs.',
  whenToUse: 'For any task that needs planning and decomposition. The default compile entry point.',
  costHint: 'high',
  conflictsWith: [],
  parallelizable: false,
}, async function* plannerStage(ctx) {
  yield* runBoundedPlannerCompilerCompileStage(ctx);
});
