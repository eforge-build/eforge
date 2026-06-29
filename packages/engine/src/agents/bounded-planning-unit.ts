import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import type { BuildStageSpec, CompilePipelineScope, ReviewProfileConfig } from '@eforge-build/client';
import type { ClarificationQuestion, EforgeEvent, PlanningDecompositionLimits, PlanningObservedBudgetPressure, PlanningUnitBudget } from '../events.js';
import { PLANNING_DECOMPOSITION_MAX_SOURCE_SLICES, PLANNING_DECOMPOSITION_MAX_STRING_LENGTH } from '../events.js';
import { runPlanner } from './planner.js';
import { runModulePlanner } from './module-planner.js';
import type { ArchitectureSubmission, PlanSetSubmission } from '../schemas.js';
import { CompileScopeContextError, type CompileContextGuardOptions } from '../compile-resilience/context-guard.js';
import { sha256Hex } from '../compile-resilience/bounded-planning-context.js';
import { evaluatePlanningUnitBudgetPressure, type PlanningDecompositionUnit, type PlanningUnitOutput } from '../compile-resilience/planning-decomposition.js';
import { derivePlannerInspectionBudget, inspectPlannerHandoffArtifact } from '../compile-resilience/planner-inspection.js';

export type BoundedPlanningUnitAgentMode = 'planner' | 'module-planner';

export interface BoundedPlanningUnitInput {
  unit: PlanningDecompositionUnit;
  unitSourceContent: string;
  sourceHash: string;
  upstreamOutputs: PlanningUnitOutput[];
  upstreamCompactHandoffRefs: string[];
  budgets: PlanningUnitBudget;
  artifactDir: string;
  cwd: string;
  planSetName: string;
  pipelineScope: CompilePipelineScope;
  outputDir: string;
  baseBranch?: string;
  defaultBuild?: BuildStageSpec[];
  defaultReview?: ReviewProfileConfig;
  harness: AgentHarness;
  agentMode: BoundedPlanningUnitAgentMode;
  agentOptions: SdkPassthroughConfig & { maxTurns?: number };
  auto?: boolean;
  verbose?: boolean;
  abortController?: AbortController;
  onClarification?: (questions: ClarificationQuestion[]) => Promise<Record<string, string>>;
  emit: (event: EforgeEvent) => void | Promise<void>;
}

export interface BoundedPlanningUnitExecutionResult { output: PlanningUnitOutput; events: EforgeEvent[] }

interface Captures { planSet?: PlanSetSubmission; architecture?: ArchitectureSubmission; modulePlan?: { markdown: string; buildConfigBlock?: string } }

export async function runBoundedPlanningUnit(input: BoundedPlanningUnitInput): Promise<PlanningUnitOutput> {
  const events: EforgeEvent[] = [];
  const captures: Captures = {};
  const observed: Partial<PlanningObservedBudgetPressure> = {
    promptSourceBytes: Buffer.byteLength(input.unitSourceContent, 'utf8'),
    localExplorationToolUses: 0,
  };
  const promptContext = {
    unit: input.unit,
    unitSourceContent: input.unitSourceContent,
    sourceHash: input.sourceHash,
    upstreamOutputs: input.upstreamOutputs,
    upstreamCompactHandoffRefs: input.upstreamCompactHandoffRefs,
    budgets: input.budgets,
    artifactDir: input.artifactDir,
    submitToolName: input.agentMode === 'module-planner' ? 'submit_module_plan' : undefined,
  };
  const recordPrompt = (prompt: string): void => { observed.promptBytes = Buffer.byteLength(prompt, 'utf8'); };

  const sourceBytes = Buffer.byteLength(input.unitSourceContent, 'utf8');
  if (sourceBytes > input.budgets.maxPromptSourceBytes) {
    const err = new CompileScopeContextError({
      source: 'decomposition',
      failureKind: 'context-budget',
      stage: 'planning-decomposition',
      explanation: cap(`bounded unit source bytes ${sourceBytes} exceed maxPromptSourceBytes ${input.budgets.maxPromptSourceBytes}`),
      observed: { promptBytes: observed.promptBytes },
      decompositionEvidence: failureEvidence(input, observed, `bounded unit source bytes ${sourceBytes} exceed maxPromptSourceBytes ${input.budgets.maxPromptSourceBytes}`),
      recovery: { action: 'bounded-decomposition', eligible: true, attempted: false, attempt: 0, maxAttempts: 1, reason: 'bounded unit source slice exceeds source byte budget' },
      artifacts: { orchestrationExists: false, validPlanCount: 0, invalidPlanCount: 0, missingPlanFileCount: 0, missingPlanFiles: [], invalidPlanFiles: [] },
    });
    await emit(input, { timestamp: now(), type: 'planning:decomposition:unit:failed', unitId: input.unit.unitId, reason: cap(err.message), evidence: failureEvidence(input, observed, err) });
    throw err;
  }

  await emit(input, { timestamp: now(), type: 'planning:decomposition:unit:running', unitId: input.unit.unitId });
  await emit(input, { timestamp: now(), type: 'planning:decomposition:unit:progress', unitId: input.unit.unitId, message: 'Constructed bounded planning prompt context', observed: pressure(input, observed) });

  try {
    const contextGuard: CompileContextGuardOptions = { stage: input.agentMode === 'planner' ? 'planner' : 'module-planner', limits: guardLimits(input.budgets) };
    const runnerEvents = input.agentMode === 'planner'
      ? runPlanner(input.unitSourceContent, {
        ...input.agentOptions,
        harness: input.harness,
        cwd: input.cwd,
        name: input.planSetName,
        scope: input.pipelineScope,
        outputDir: input.outputDir,
        baseBranch: input.baseBranch,
        defaultBuild: input.defaultBuild,
        defaultReview: input.defaultReview,
        auto: input.auto,
        verbose: input.verbose,
        abortController: input.abortController,
        onClarification: input.onClarification,
        promptSourceContent: input.unitSourceContent,
        contextGuard,
        onPromptBuilt: recordPrompt,
        boundedUnit: promptContext,
        boundedCapture: { mode: 'capture-only', unitId: input.unit.unitId, artifactDir: input.artifactDir, onPlanSetSubmission: p => { captures.planSet = p; }, onArchitectureSubmission: a => { captures.architecture = a; } },
        plannerInspectionBudget: derivePlannerInspectionBudget({ hardLimits: contextGuard.limits, guardDiagnostics: contextGuard.guardDiagnostics, plannerMaxTurns: input.agentOptions.maxTurns, toolUseCaps: { maxToolUses: input.budgets.maxLocalExplorationToolUses } }),
      })
      : runModulePlanner({
        ...input.agentOptions,
        harness: input.harness,
        cwd: input.cwd,
        planSetName: input.planSetName,
        moduleId: input.unit.unitId,
        moduleDescription: input.unit.title,
        moduleDependsOn: input.unit.dependsOn,
        architectureContent: input.upstreamOutputs.flatMap(o => o.sharedContractNotes ?? []).join('\n') || 'Bounded module architecture context is limited to upstream summaries.',
        sourceContent: input.unitSourceContent,
        promptSourceContent: input.unitSourceContent,
        dependencyPlanContent: input.upstreamOutputs.flatMap(o => o.planSuggestions?.map(p => p.markdown) ?? []).join('\n\n'),
        outputDir: input.outputDir,
        verbose: input.verbose,
        abortController: input.abortController,
        onClarification: input.onClarification,
        contextGuard,
        onPromptBuilt: recordPrompt,
        boundedUnit: promptContext,
        boundedCapture: { mode: 'capture-only', unitId: input.unit.unitId, artifactDir: input.artifactDir, submitToolName: 'submit_module_plan', onModulePlanSubmission: p => { captures.modulePlan = p; } },
      });

    let budgetEmitted = false;
    for await (const event of runnerEvents) {
      if (!budgetEmitted && observed.promptBytes !== undefined) {
        await emit(input, budgetEvent(input, observed));
        budgetEmitted = true;
      }
      events.push(event);
      updateObserved(event, observed);
      if (event.type === 'planning:inspection-summary') {
        await emit(input, { timestamp: now(), type: 'planning:decomposition:unit:progress', unitId: input.unit.unitId, message: 'Compact inspection handoff created', observed: pressure(input, observed) });
        if (event.artifactPath) await emitCompact(input, event.artifactPath, observed);
      } else if (event.type === 'agent:usage') {
        await emit(input, budgetEvent(input, observed));
      } else if (event.type === 'agent:tool_use' && isCaptureTool(event.tool)) {
        await emit(input, { timestamp: now(), type: 'planning:decomposition:unit:progress', unitId: input.unit.unitId, message: `Captured bounded submission via ${event.tool}`, observed: pressure(input, observed) });
      }
      if (shouldForwardAgentEvent(event)) await emit(input, event);
    }

    const output = buildOutput(input, captures, events, observed, 'completed');
    await emit(input, { timestamp: now(), type: 'planning:decomposition:unit:completed', unit: completedUnitSummary(input) });
    return output;
  } catch (err) {
    mergeContextFailureObserved(err, observed);
    const output = buildOutput(input, captures, events, observed, 'failed', err);
    await emit(input, { timestamp: now(), type: 'planning:decomposition:unit:progress', unitId: input.unit.unitId, message: cap(`Bounded planning unit failed: ${err instanceof Error ? err.message : String(err)}`), observed: pressure(input, observed) });
    await emit(input, { timestamp: now(), type: 'planning:decomposition:unit:failed', unitId: input.unit.unitId, reason: cap(err instanceof Error ? err.message : String(err)), evidence: failureEvidence(input, observed, err) });
    if (err instanceof CompileScopeContextError && !hasAgentObservation(observed)) throw err;
    return output;
  }
}

function buildOutput(input: BoundedPlanningUnitInput, captures: Captures, events: EforgeEvent[], observed: Partial<PlanningObservedBudgetPressure>, status: 'completed' | 'failed', err?: unknown): PlanningUnitOutput {
  const compact = [...events].reverse().find((event): event is Extract<EforgeEvent, { type: 'planning:inspection-summary' }> => event.type === 'planning:inspection-summary');
  const planSuggestions = captures.planSet?.plans.map(plan => ({ id: plan.frontmatter.id, name: plan.frontmatter.name, markdown: plan.body, dependsOn: captures.planSet?.orchestration.plans.find(p => p.id === plan.frontmatter.id)?.dependsOn }))
    ?? (captures.modulePlan ? [{ id: input.unit.unitId, markdown: captures.modulePlan.markdown, buildConfigBlock: captures.modulePlan.buildConfigBlock, dependsOn: input.unit.dependsOn }] : []);
  const moduleSuggestions = captures.architecture?.modules.map(module => ({ ...module, architecture: captures.architecture?.architecture })) ?? [];
  return {
    unitId: input.unit.unitId,
    status,
    coveredCriteria: status === 'completed' ? [...input.unit.criteriaIds] : [],
    discoveredFiles: discoveredFiles(events),
    sharedContractNotes: [...input.unit.interfaceConstraints, ...input.unit.sharedFileConstraints, ...input.upstreamOutputs.flatMap(o => o.sharedContractNotes ?? [])],
    moduleSuggestions,
    planSuggestions,
    unresolvedRequirements: status === 'failed' ? (input.unit.criteriaIds.length > 0 ? input.unit.criteriaIds : [input.unit.unitId]).map(criterionId => ({ criterionId, reason: err instanceof Error ? err.message : String(err ?? 'bounded unit failed'), evidence: input.unit.unitId })) : [],
    compactHandoffRef: compact?.artifactPath,
    synthesisNotes: [`bounded ${input.agentMode} capture for source ${input.sourceHash}`, captures.planSet ? 'captured plan-set submission' : captures.architecture ? 'captured architecture submission' : captures.modulePlan ? 'captured module-plan submission' : 'no submission captured'],
    observedBudget: pressure(input, observed),
  };
}

function updateObserved(event: EforgeEvent, observed: Partial<PlanningObservedBudgetPressure>): void {
  if (event.type === 'agent:usage') {
    observed.observedInputTokens = Math.max(observed.observedInputTokens ?? 0, event.usage.input || event.usage.total);
    observed.observedTurns = Math.max(observed.observedTurns ?? 0, event.numTurns);
  } else if (event.type === 'agent:tool_use' && !isCaptureTool(event.tool)) {
    observed.localExplorationToolUses = (observed.localExplorationToolUses ?? 0) + 1;
  }
}

function mergeContextFailureObserved(err: unknown, observed: Partial<PlanningObservedBudgetPressure>): void {
  if (!(err instanceof CompileScopeContextError) || !err.failure.observed) return;
  const failureObserved = err.failure.observed;
  observed.promptBytes = Math.max(observed.promptBytes ?? 0, failureObserved.promptBytes ?? 0);
  observed.observedInputTokens = Math.max(observed.observedInputTokens ?? 0, failureObserved.inputTokens ?? 0);
  observed.observedTurns = Math.max(observed.observedTurns ?? 0, failureObserved.turns ?? 0);
}

function discoveredFiles(events: EforgeEvent[]): string[] {
  const files = new Set<string>();
  for (const event of events) {
    if (event.type !== 'agent:tool_use') continue;
    const input = event.input as Record<string, unknown>;
    const path = typeof input?.file_path === 'string' ? input.file_path : typeof input?.path === 'string' ? input.path : undefined;
    if (path) files.add(path);
  }
  return [...files];
}

function pressure(input: BoundedPlanningUnitInput, observed: Partial<PlanningObservedBudgetPressure>): PlanningObservedBudgetPressure {
  return evaluatePlanningUnitBudgetPressure({ unit: { ...input.unit, budgets: input.budgets }, observed });
}

function budgetEvent(input: BoundedPlanningUnitInput, observed: Partial<PlanningObservedBudgetPressure>): EforgeEvent {
  return { timestamp: now(), type: 'planning:decomposition:budget', limits: limits(input.budgets), unitId: input.unit.unitId, unitBudgets: [{ unitId: input.unit.unitId, budget: input.budgets }], observed: pressure(input, observed) };
}

async function emitCompact(input: BoundedPlanningUnitInput, artifactPath: string, observed: Partial<PlanningObservedBudgetPressure>): Promise<void> {
  const diagnostics = await inspectPlannerHandoffArtifact(artifactPath);
  observed.compactHandoffBytes = diagnostics.byteLength;
  await emit(input, { timestamp: now(), type: 'planning:decomposition:compact-handoff', unitId: input.unit.unitId, artifactPath, byteLength: diagnostics.byteLength, contentHash: diagnostics.contentHash, omittedUnitIds: [] });
  await emit(input, budgetEvent(input, observed));
}

async function emit(input: BoundedPlanningUnitInput, event: EforgeEvent): Promise<void> { await input.emit(event); }
function now(): string { return new Date().toISOString(); }
function guardLimits(budget: PlanningUnitBudget): CompileContextGuardOptions['limits'] { return { maxPromptBytes: budget.maxPromptBytes, maxObservedInputTokens: budget.maxObservedInputTokens, ...(budget.maxObservedTurns ? { maxObservedTurns: budget.maxObservedTurns } : {}) }; }
function limits(budget: PlanningUnitBudget): PlanningDecompositionLimits { return { parallelism: 1, maxDepth: budget.maxRecursiveDepth + 1, maxPromptSourceBytes: budget.maxPromptSourceBytes, maxPromptBytes: budget.maxPromptBytes, maxObservedInputTokens: budget.maxObservedInputTokens, ...(budget.maxObservedTurns ? { maxObservedTurns: budget.maxObservedTurns } : {}), maxCompactHandoffBytes: budget.maxCompactHandoffBytes, maxLocalExplorationToolUses: budget.maxLocalExplorationToolUses, maxCriteriaPerUnit: budget.maxCriteriaPerUnit, maxSubsystemsPerUnit: budget.maxSubsystemsPerUnit, maxSplitAttemptsPerUnit: budget.maxSplitAttemptsPerUnit }; }
function isCaptureTool(tool: string): boolean { return tool.includes('submit_plan_set') || tool.includes('submit_architecture') || tool.includes('submit_module_plan'); }
function shouldForwardAgentEvent(_event: EforgeEvent): boolean { return false; }
function hasAgentObservation(observed: Partial<PlanningObservedBudgetPressure>): boolean { return (observed.observedTurns ?? 0) > 0 || (observed.observedInputTokens ?? 0) > 0 || (observed.localExplorationToolUses ?? 0) > 0; }
function completedUnitSummary(input: BoundedPlanningUnitInput) { return { unitId: cap(input.unit.unitId), parentUnitId: input.unit.parentId ? cap(input.unit.parentId) : undefined, depth: input.unit.depth, sourceSlices: input.unit.sourceSlices.slice(0, PLANNING_DECOMPOSITION_MAX_SOURCE_SLICES), coverage: { totalCriteria: input.unit.criteriaIds.length, coveredCriteria: input.unit.criteriaIds.map(criterionId => ({ criterionId: cap(criterionId), sourceHash: input.sourceHash, coveredByUnitIds: [cap(input.unit.unitId)] })), unresolvedCriteria: [] }, subsystemHints: input.unit.subsystemHints.map(cap), dependencies: input.unit.dependsOn.map(cap), interfaceConstraints: input.unit.interfaceConstraints.map(description => ({ description: cap(description) })), sharedFileConstraints: input.unit.sharedFileConstraints.map(description => ({ description: cap(description) })), budgets: input.budgets, status: 'completed' as const }; }
function failureEvidence(input: BoundedPlanningUnitInput, observed: Partial<PlanningObservedBudgetPressure>, err: unknown) { const message = cap(err instanceof Error ? err.message : String(err)); const criteriaIds = input.unit.criteriaIds.length > 0 ? input.unit.criteriaIds : [input.unit.unitId]; return { unitId: input.unit.unitId, parentUnitId: input.unit.parentId, depth: input.unit.depth, budgets: input.budgets, observed: pressure(input, observed), assignedCriteriaIds: input.unit.criteriaIds.map(id => cap(id)), unresolvedCriteria: criteriaIds.map(criterionId => ({ criterionId: cap(criterionId), reason: message, evidence: cap(input.unit.unitId) })), blockers: [message], splitAttempts: [] }; }
function cap(value: string): string { return value.length <= PLANNING_DECOMPOSITION_MAX_STRING_LENGTH ? value : `${value.slice(0, PLANNING_DECOMPOSITION_MAX_STRING_LENGTH - 1)}…`; }

export { sha256Hex };
