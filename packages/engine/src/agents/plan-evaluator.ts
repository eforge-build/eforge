import { execFile } from 'node:child_process';
import { posix } from 'node:path';
import { promisify } from 'node:util';

import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { getEvaluationSchemaYaml, getEvaluationSubmissionSchemaYaml, type EvaluationSubmission, type EvaluationVerdict } from '../schemas.js';
import {
  applyEvaluationVerdicts,
  assertNoEvaluationDrift,
  commitEvaluationSnapshot,
  createEvaluationTools,
  discardEvaluationCandidateFixes,
  restoreEvaluationSnapshotAfterFailure,
  validateEvaluationPath,
  type EvaluationSnapshot,
} from '../evaluation/index.js';
import { syncArchitectureManifestDependencies } from '../planning-quality/manifest-sync.js';
import type { ModelTracker } from '../model-tracker.js';
import { parseEvaluationBlock } from './common.js';
import { mergeMutationDisallowedTools } from '../harnesses/tool-safety.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';

const exec = promisify(execFile);

/**
 * Evaluator mode: 'plan' for plan review evaluation, and
 * 'planning-quality' for the bounded planner compiler's quality gate.
 */
type EvaluatorMode = 'plan' | 'planning-quality';

/**
 * Options shared by the plan and planning-quality evaluator agents.
 */
interface PlanPhaseEvaluatorOptions extends SdkPassthroughConfig {
  /** Evaluator mode */
  mode: EvaluatorMode;
  /** Harness for running the agent */
  harness: AgentHarness;
  /** The plan set name */
  planSetName: string;
  /** The original source/PRD content for context */
  sourceContent: string;
  /** Working directory */
  cwd: string;
  /** Whether to emit verbose agent-level events */
  verbose?: boolean;
  /** AbortController for cancellation */
  abortController?: AbortController;
  /** Plan output directory (defaults to 'eforge/plans'). */
  outputDir?: string;
  /** Immutable candidate snapshot captured by the engine before evaluation. */
  evaluationSnapshot?: EvaluationSnapshot;
  /** Commit message body for accepted compile evaluator fixes. */
  commitMessage?: string;
  /** Optional model tracker for Models-Used commit trailers. */
  modelTracker?: ModelTracker;
  /** Repository-relative directory prefix that all evaluator verdict paths must stay within. */
  allowedPathPrefix?: string;
  /** Candidate path groups that must receive one all-accept or all-reject verdict. */
  atomicPathGroups?: string[][];
  /** Override max conversation turns (default: evaluation tier default). */
  maxTurns?: number;
  /** Continuation context when retrying after maxTurns exhaustion */
  continuationContext?: {
    attempt: number;
    maxContinuations: number;
  };
  /** Orchestrator-assigned lane id forwarded as the harness.run planId arg. */
  lane?: string;
}

/** Options accepted by the public plan/planning-quality evaluator wrappers. */
type PlanEvaluatorOptions = Omit<PlanPhaseEvaluatorOptions, 'mode'>;


// Mode-specific configuration
const MODE_CONFIG = {
  plan: {
    startEvent: 'planning:evaluate:start' as const,
    completeEvent: 'planning:evaluate:complete' as const,
    promptName: 'plan-evaluator',
    role: 'plan-evaluator' as const,
    promptVars: {
      evaluator_title: 'Plan Fix Evaluator',
      evaluator_context: 'A planner agent generated plan files and committed them. A blind plan reviewer then reviewed the plan files and left fixes as captured candidate changes. You must evaluate each fix and decide whether to accept, reject, or flag for review.',
      strict_improvement_bullet_1: 'It fixes a genuine, objective issue (missing dependency, incorrect file path, coverage gap, contradictory scope)',
      restructuring_principle: 'It does NOT restructure or reorganize plans',
      restructuring_reject: 'The change splits, merges, or reorders plans',
      accept_patterns_table: `| Missing dependency | Plan B uses types from Plan A but doesn't list A in \`depends_on\` |
| Incorrect file path | Plan references \`src/utils/helper.ts\` but file is at \`src/lib/helper.ts\` |
| Missing PRD coverage | Source requires auth but no plan covers it — reviewer adds coverage note |
| Branch name mismatch | YAML frontmatter \`branch\` doesn't match orchestration.yaml |
| Incorrect plan ID reference | \`depends_on\` references a plan ID that doesn't exist |
| Missing verification step | Plan has no way to verify its own implementation |`,
      reject_criteria_extra: '',
    },
  },
  'planning-quality': {
    startEvent: 'planning:evaluate:start' as const,
    completeEvent: 'planning:evaluate:complete' as const,
    promptName: 'plan-evaluator',
    role: 'plan-evaluator' as const,
    // Whole-file deletion (or rename-away) of these artifacts is never a
    // legitimate fix; enforced deterministically by validateProtectedArtifacts.
    protectedArtifacts: ['orchestration.yaml', 'architecture.md', 'acceptance-coverage.md', 'compiler-diagnostics.json'] as const,
    promptVars: {
      evaluator_title: 'Planning Quality Fix Evaluator',
      evaluator_context: 'A bounded planner compiler generated planning artifacts (plan files, orchestration.yaml, architecture.md, acceptance-coverage.md, compiler-diagnostics.json) and committed them. A blind planning quality reviewer then audited coverage, coherence, buildability, traceability, and pipeline sanity — and left fixes as captured candidate changes. You must evaluate each fix and decide whether to accept, reject, or flag for review.',
      strict_improvement_bullet_1: 'It fixes a genuine, objective issue (uncovered acceptance criterion, missing dependency, artifact disagreement, ownership conflict, or redundant plan/pipeline structure)',
      restructuring_principle: 'Typed plan merges, redundant-stage removal, and review-depth reduction are allowed only when the diff preserves all requirements and regenerates the affected artifacts cohesively',
      restructuring_reject: 'Reject splits or reorders, and reject merges that remove requirements, cross independent ownership boundaries, or leave partially regenerated artifacts',
      accept_patterns_table: `| Missing dependency | Plan B uses outputs of Plan A but doesn't list A in \`depends_on\` |
| Coverage gap closed | An acceptance criterion had no plan coverage — fix adds concrete plan content covering it |
| Artifact disagreement | architecture.md contracts or ownership disagree with the plan files — fix aligns them |
| Ownership conflict resolved | Two plans claim the same file — fix declares a dependency to sequence them |
| Review settings corrected | A large risky plan carried lighter review settings than a trivial plan |
| Cohesive plans merged | Two small plans describe one bounded implementation and their regenerated artifacts preserve all criteria, ownership, and dependencies |
| Redundant stage removed | A stage unsupported by normalized work intent is removed without crossing a safety floor |
| Review depth reduced | Review is reduced only to the deterministic floor for a low-risk plan |
| Incorrect file path | Plan references a path that doesn't exist in the repository |`,
      reject_criteria_extra: `
6. **Coverage weakened or deleted** — The change removes or waters down acceptance coverage entries instead of resolving them with plan content
7. **Compiler diagnostics modified** — The change edits or deletes compiler-diagnostics.json; diagnostics record what the compiler did and are never a fix target
8. **PRD semantics changed** — The change alters what the source/PRD requires rather than how the plans satisfy it
9. **Structurally invalid artifacts** — The change would leave orchestration.yaml or a plan file unparseable or structurally invalid`,
    },
  },
} as const;

function mergeDisallowedTools(existing: string[] | undefined): string[] {
  return mergeMutationDisallowedTools(existing);
}

function summarizeEvaluationVerdicts(verdicts: EvaluationVerdict[]) {
  return verdicts.map(v => ({
    file: v.file,
    action: v.action,
    reason: v.reason,
    ...(v.hunk !== undefined && { hunk: v.hunk }),
  }));
}

function normalizePathPrefix(prefix: string): string {
  const normalized = validateEvaluationPath(prefix);
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function isWithinPrefix(file: string, prefix: string): boolean {
  return file === prefix || file.startsWith(`${prefix}/`);
}

function validatePathGuard(
  verdicts: EvaluationVerdict[],
  allowedPathPrefix: string | undefined,
  snapshot?: EvaluationSnapshot,
): void {
  if (!allowedPathPrefix) return;
  const prefix = normalizePathPrefix(allowedPathPrefix);
  const candidates = new Map(snapshot?.files.map(file => [file.path, file]) ?? []);
  for (const verdict of verdicts) {
    const file = validateEvaluationPath(verdict.file);
    const candidate = candidates.get(file);
    const oldPath = candidate?.oldPath ? validateEvaluationPath(candidate.oldPath) : undefined;
    const guardedPaths = oldPath && oldPath !== file
      ? [file, oldPath]
      : [file];
    for (const guardedPath of guardedPaths) {
      if (!isWithinPrefix(guardedPath, prefix)) {
        throw new Error(`Evaluation verdict path is outside the allowed planning artifact directory (${prefix}): ${guardedPath}`);
      }
    }
  }
}

/** Structural simplifications regenerate several files and must be adjudicated as one unit. */
function validateAtomicPathGroups(verdicts: EvaluationVerdict[], groups: string[][] | undefined, snapshot?: EvaluationSnapshot): void {
  if (!groups || !snapshot) return;
  const candidatePaths = new Set(snapshot.files.map((file) => file.path));
  for (const group of groups) {
    const paths = group.filter((path) => candidatePaths.has(path));
    if (paths.length < 2) continue;
    const actions = new Set<string>();
    for (const path of paths) {
      const pathVerdicts = verdicts.filter((verdict) => verdict.file === path);
      if (pathVerdicts.length === 0) throw new Error(`Atomic structural candidate is missing a verdict for: ${path}`);
      for (const verdict of pathVerdicts) actions.add(verdict.action === 'accept' ? 'accept' : 'reject');
    }
    if (actions.size > 1) throw new Error(`Atomic structural candidate requires one verdict across: ${paths.join(', ')}`);
  }
}

/**
 * Deterministic backstop for protected planning artifacts: an accepted verdict
 * must never delete (or rename away) one of the compiler's core artifacts.
 */
function validateProtectedArtifacts(
  verdicts: EvaluationVerdict[],
  allowedPathPrefix: string | undefined,
  protectedArtifacts: readonly string[] | undefined,
  snapshot?: EvaluationSnapshot,
): void {
  if (!protectedArtifacts || protectedArtifacts.length === 0 || !snapshot) return;
  const prefix = allowedPathPrefix ? normalizePathPrefix(allowedPathPrefix) : undefined;
  const protectedPaths = new Set(protectedArtifacts.map((name) => (prefix ? `${prefix}/${name}` : name)));
  const candidates = new Map(snapshot.files.map(file => [file.path, file]));
  for (const verdict of verdicts) {
    if (verdict.action !== 'accept') continue;
    const file = validateEvaluationPath(verdict.file);
    const candidate = candidates.get(file);
    if (!candidate) continue;
    const oldPath = candidate.oldPath ? validateEvaluationPath(candidate.oldPath) : undefined;
    if (candidate.status === 'deleted' && protectedPaths.has(file)) {
      throw new Error(`Evaluation verdict would delete a protected planning artifact: ${file}`);
    }
    if (oldPath !== undefined && oldPath !== file && protectedPaths.has(oldPath)) {
      throw new Error(`Evaluation verdict would rename away a protected planning artifact: ${oldPath}`);
    }
  }
}

async function restoreOriginalEvaluationHead(snapshot: EvaluationSnapshot): Promise<void> {
  await restoreEvaluationSnapshotAfterFailure(snapshot);
  await discardEvaluationCandidateFixes(snapshot);
  await exec('git', ['reset', '--hard', snapshot.originalHead ?? snapshot.baseHead], { cwd: snapshot.cwd });
}

async function restoreIfSnapshotClean(snapshot: EvaluationSnapshot): Promise<void> {
  await assertNoEvaluationDrift(snapshot);
  await restoreOriginalEvaluationHead(snapshot);
}

function planningError(reason: string): EforgeEvent {
  return { timestamp: new Date().toISOString(), type: 'planning:error', reason };
}

/**
 * Internal consolidated evaluator runner for plan and planning-quality evaluation.
 *
 * Yields:
 * - Mode-specific start event at the beginning
 * - `agent:message`, `agent:tool_use`, `agent:tool_result` events (when verbose)
 * - Mode-specific complete event with accepted/rejected counts at the end
 */
async function* runEvaluate(
  options: PlanPhaseEvaluatorOptions,
): AsyncGenerator<EforgeEvent> {
  const { mode, harness, planSetName, sourceContent, cwd, verbose, abortController } = options;
  const outputDir = options.outputDir ?? 'eforge/plans';
  const config = MODE_CONFIG[mode];

  yield { timestamp: new Date().toISOString(), type: config.startEvent };

  let continuationContextText = '';
  if (options.continuationContext) {
    const { attempt, maxContinuations } = options.continuationContext;
    continuationContextText = `## Continuation Context

**This is evaluator continuation attempt ${attempt} of ${maxContinuations}.**

The previous evaluator run was interrupted before a final verdict submission was accepted. The engine is reusing the same immutable evaluation snapshot. Do not assume any partial file application happened; re-inspect the captured diff and submit one complete verdict set covering every candidate file or hunk.`;
  }

  let structuredSubmission: EvaluationSubmission | undefined;
  const customTools = options.evaluationSnapshot
    ? createEvaluationTools(options.evaluationSnapshot, (submission) => {
      if (structuredSubmission) return false;
      structuredSubmission = submission;
    })
    : undefined;

  const prompt = await loadPrompt(config.promptName, {
    plan_set_name: planSetName,
    source_content: sourceContent,
    evaluation_schema: getEvaluationSchemaYaml(),
    evaluation_submission_schema: getEvaluationSubmissionSchemaYaml(),
    outputDir,
    continuation_context: continuationContextText,
    list_files_tool: harness.effectiveCustomToolName('list_evaluation_files'),
    get_diff_tool: harness.effectiveCustomToolName('get_evaluation_diff'),
    submit_verdicts_tool: harness.effectiveCustomToolName('submit_evaluation_verdicts'),
    ...config.promptVars,
  }, options.promptAppend);

  let fullText = '';
  let toolValidationError: string | undefined;
  const submitToolName = harness.effectiveCustomToolName('submit_evaluation_verdicts');
  const disallowedTools = mergeDisallowedTools(options.disallowedTools);
  try {
    for await (const event of harness.run(
      {
        prompt,
        cwd,
        maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.evaluation,
        tools: 'coding',
        customTools,
        disallowedTools,
        abortSignal: abortController?.signal,
        ...pickSdkOptions({ ...options, disallowedTools }),
      },
      config.role,
      options.lane,
    )) {
      if (isAlwaysYieldedAgentEvent(event) || verbose) {
        yield event;
      }
      if (event.type === 'agent:message' && event.content) {
        fullText += event.content;
      }
      if (
        event.type === 'agent:tool_result' &&
        (event.tool === submitToolName || event.tool === 'submit_evaluation_verdicts') &&
        typeof event.output === 'string' &&
        event.output.startsWith('Evaluation submission rejected:')
      ) {
        toolValidationError = event.output;
      }
      if (event.type === 'agent:result' && event.result.resultText && !fullText.includes(event.result.resultText)) {
        fullText += event.result.resultText;
      }
    }
  } catch (err) {
    yield { timestamp: new Date().toISOString(), type: config.completeEvent, accepted: 0, rejected: 0, verdicts: [] };
    throw err;
  }

  const verdicts = structuredSubmission?.verdicts ?? parseEvaluationBlock(fullText);

  if (!options.evaluationSnapshot) {
    const accepted = verdicts.filter((v) => v.action === 'accept').length;
    const rejected = verdicts.filter((v) => v.action === 'reject' || v.action === 'review').length;
    yield { timestamp: new Date().toISOString(), type: config.completeEvent, accepted, rejected, verdicts: summarizeEvaluationVerdicts(verdicts) };
    return;
  }

  if (verdicts.length === 0) {
    try {
      await restoreIfSnapshotClean(options.evaluationSnapshot);
    } catch (err) {
      try {
        await restoreOriginalEvaluationHead(options.evaluationSnapshot);
      } catch {
        // Preserve the deterministic drift error in the emitted planning:error.
      }
      yield planningError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (toolValidationError) {
      yield planningError(toolValidationError.split('\n')[0] ?? toolValidationError);
      return;
    }
    yield { timestamp: new Date().toISOString(), type: config.completeEvent, accepted: 0, rejected: 0, verdicts: [] };
    return;
  }

  const effectivePathPrefix = options.allowedPathPrefix ?? posix.join(outputDir, planSetName);
  try {
    validatePathGuard(verdicts, effectivePathPrefix, options.evaluationSnapshot);
    validateProtectedArtifacts(
      verdicts,
      effectivePathPrefix,
      'protectedArtifacts' in config ? config.protectedArtifacts : undefined,
      options.evaluationSnapshot,
    );
    validateAtomicPathGroups(verdicts, options.atomicPathGroups, options.evaluationSnapshot);
    const application = await applyEvaluationVerdicts(options.evaluationSnapshot, verdicts, { commit: false });
    // Orchestration is the dependency source of truth once fixes can mutate it;
    // re-derive the machine-managed manifest fence before committing so the
    // committed artifacts always pass cohesion validation together.
    const manifestSync = await syncArchitectureManifestDependencies({ cwd, outputDir, planSetName });
    if (manifestSync.changed && manifestSync.relPath) {
      await exec('git', ['add', '--', manifestSync.relPath], { cwd });
    }
    await commitEvaluationSnapshot(
      options.evaluationSnapshot,
      options.commitMessage ?? `plan(${planSetName}): planning artifacts`,
      options.modelTracker,
    );
    yield {
      timestamp: new Date().toISOString(),
      type: config.completeEvent,
      accepted: application.accepted,
      rejected: application.rejected,
      verdicts: summarizeEvaluationVerdicts(verdicts),
    };
  } catch (err) {
    try {
      await restoreOriginalEvaluationHead(options.evaluationSnapshot);
    } catch {
      // Preserve the deterministic application failure as the planning error.
    }
    yield planningError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Evaluate the plan reviewer's captured fixes. The engine owns snapshot
 * preparation, verdict application, cleanup, and committing.
 *
 * Yields:
 * - `planning:evaluate:start` at the beginning
 * - `agent:message`, `agent:tool_use`, `agent:tool_result` events (when verbose)
 * - `planning:evaluate:complete` with accepted/rejected counts at the end
 */
export async function* runPlanEvaluate(
  options: PlanEvaluatorOptions,
): AsyncGenerator<EforgeEvent> {
  yield* runEvaluate({ ...options, mode: 'plan' });
}


/**
 * Options for the planning quality evaluator agent.
 */
type PlanningQualityEvaluatorOptions = PlanEvaluatorOptions;

/**
 * Evaluate the planning quality reviewer's captured fixes. The engine owns
 * snapshot preparation, verdict application, cleanup, and committing. In
 * addition to the path guard, a deterministic protected-artifact guard blocks
 * accepted deletions of orchestration.yaml, architecture.md,
 * acceptance-coverage.md, and compiler-diagnostics.json.
 *
 * Yields:
 * - `planning:evaluate:start` at the beginning
 * - `agent:message`, `agent:tool_use`, `agent:tool_result` events (when verbose)
 * - `planning:evaluate:complete` with accepted/rejected counts at the end
 */
export async function* runPlanningQualityEvaluate(
  options: PlanningQualityEvaluatorOptions,
): AsyncGenerator<EforgeEvent> {
  yield* runEvaluate({ ...options, mode: 'planning-quality' });
}
