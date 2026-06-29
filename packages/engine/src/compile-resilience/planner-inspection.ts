import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type {
  CompileContextGuardDiagnostics,
  EforgeEvent,
  PlannerInspectionBudgetDiagnostics as PlannerInspectionSummaryBudgetDiagnostics,
  PlannerInspectionSummary,
} from '../events.js';
import {
  MAX_PLANNER_INSPECTION_IMPLEMENTATION_AREAS,
  MAX_PLANNER_INSPECTION_IMPORTANT_FINDINGS,
  MAX_PLANNER_INSPECTION_OBSERVED_FACTS,
  MAX_PLANNER_INSPECTION_RELEVANT_FILES,
  MAX_PLANNER_INSPECTION_SOURCE_CONTEXT_LENGTH,
  MAX_PLANNER_INSPECTION_UNRESOLVED_QUESTIONS,
} from '../events.js';
import {
  resolveCompileContextGuardLimits,
  createPlannerContextObservationState,
  observePlannerContextUsage,
  setPlannerContextPromptBytes,
  type CompileContextGuardLimits,
  type PlannerContextObservation,
  type PlannerFamilyStage,
} from './context-guard.js';
export { compactPlannerInspectionHandoffToBudget, plannerInspectionHandoffByteLength } from './planner-inspection-compaction.js';

// --- eforge:region planner-inspection-contracts ---
export const PLANNER_INSPECTION_HANDOFF_ARTIFACT = 'planner-inspection-handoff.json';

const DEFAULT_PLANNER_MAX_TURNS = 80;
const SOFT_INPUT_TOKEN_RATIO = 0.72;
const SOFT_TURN_RATIO = 0.75;
const MAX_TEXT_BYTES = 2_000;
const MAX_FACTS = MAX_PLANNER_INSPECTION_OBSERVED_FACTS;
const MAX_FINDINGS = MAX_PLANNER_INSPECTION_IMPORTANT_FINDINGS;
const MAX_FILES = MAX_PLANNER_INSPECTION_RELEVANT_FILES;
const MAX_AREAS = MAX_PLANNER_INSPECTION_IMPLEMENTATION_AREAS;
const MAX_QUESTIONS = MAX_PLANNER_INSPECTION_UNRESOLVED_QUESTIONS;
const MAX_SOURCE_CONTEXT_BYTES = MAX_PLANNER_INSPECTION_SOURCE_CONTEXT_LENGTH;
const MAX_TOOL_SNIPPET_BYTES = 1_200;
const MAX_IDENTIFIER_BYTES = 300;
const MAX_PATH_BYTES = 500;
const MAX_CAVEAT_BYTES = 1_000;
const MAX_TOOL_SUMMARY_BYTES = 700;
const MAX_PATH_SCAN_CHARS = 4_000;
const ELLIPSIS_BYTES = Buffer.byteLength('…', 'utf8');
const PATH_PATTERN = /(?:^|[\s"'`(])((?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@-]+(?:\.[A-Za-z0-9_.-]+)?)/g;

export interface PlannerInspectionToolUseCaps {
  maxToolUses: number;
  maxToolResults: number;
  maxRelevantFiles: number;
  maxObservedFacts: number;
  maxImportantFindings: number;
  maxImplementationAreas: number;
  maxUnresolvedQuestions: number;
}

export interface PlannerInspectionBudget {
  hardLimits: CompileContextGuardLimits;
  softInputTokenThreshold: number;
  inspectionTurnBudget: number;
  toolUseCaps: PlannerInspectionToolUseCaps;
  diagnostics: PlannerInspectionBudgetDiagnostics;
}

export type PlannerInspectionHandoff = PlannerInspectionSummary;
export type PlannerInspectionIdentifiers = PlannerInspectionHandoff['source'];
export type PlannerInspectionSourceContext = PlannerInspectionHandoff['sourceBuildContext'];
export type PlannerInspectionOmittedCounts = PlannerInspectionHandoff['omittedCounts'];
export type PlannerInspectionBudgetDiagnostics = Omit<PlannerInspectionSummaryBudgetDiagnostics, 'observed' | 'toolUseCount' | 'toolResultCount'>;

export interface PlannerInspectionObserver {
  observe(event: EforgeEvent): PlannerInspectionObservationStatus;
  shouldHandoff(): boolean;
  setPrompt(prompt: string): PlannerContextObservation;
  buildHandoff(input: Omit<BuildPlannerInspectionHandoffInput, 'events' | 'budget'>): PlannerInspectionHandoff;
  readonly observed: PlannerContextObservation;
  readonly events: readonly EforgeEvent[];
}

export interface PlannerInspectionObservationStatus {
  shouldHandoff: boolean;
  reason?: 'soft-input-tokens' | 'inspection-turns' | 'tool-use-cap';
  observed: PlannerContextObservation;
}

export interface BuildPlannerInspectionHandoffInput {
  events: readonly EforgeEvent[];
  budget: PlannerInspectionBudget;
  source: PlannerInspectionIdentifiers;
  sourceBuildContext?: PlannerInspectionSourceContext;
  stage?: PlannerFamilyStage;
  incompleteReason?: string;
  prompt?: string;
}
// --- eforge:endregion planner-inspection-contracts ---

// --- eforge:region planner-inspection-budget-observer ---
export function reservePlannerSynthesisToolBudget(maxToolUses: number | undefined): number | undefined {
  return maxToolUses === undefined || maxToolUses <= 1 ? maxToolUses : maxToolUses - 1;
}

export function derivePlannerInspectionBudget(input: {
  hardLimits?: Partial<CompileContextGuardLimits>;
  guardDiagnostics?: CompileContextGuardDiagnostics;
  plannerMaxTurns?: number;
  toolUseCaps?: Partial<PlannerInspectionToolUseCaps>;
} = {}): PlannerInspectionBudget {
  const hardLimits = resolveCompileContextGuardLimits({ ...(input.guardDiagnostics?.limits ?? {}), ...(input.hardLimits ?? {}) });
  const plannerMaxTurns = positiveInteger(input.plannerMaxTurns) ?? DEFAULT_PLANNER_MAX_TURNS;
  const softInputTokenThreshold = lowerThanHard(Math.floor(hardLimits.maxObservedInputTokens * SOFT_INPUT_TOKEN_RATIO), hardLimits.maxObservedInputTokens);
  const hardTurnLimit = positiveInteger(hardLimits.maxObservedTurns);
  const ratioTurns = lowerThanHard(Math.floor(plannerMaxTurns * SOFT_TURN_RATIO), plannerMaxTurns);
  const inspectionTurnBudget = hardTurnLimit === undefined ? ratioTurns : Math.min(ratioTurns, hardTurnLimit);
  const toolUseCaps = { ...defaultToolUseCaps(), ...(input.toolUseCaps ?? {}) };
  return {
    hardLimits,
    softInputTokenThreshold,
    inspectionTurnBudget,
    toolUseCaps,
    diagnostics: {
      maxObservedInputTokens: hardLimits.maxObservedInputTokens,
      softInputTokenThreshold,
      plannerMaxTurns,
      inspectionTurnBudget,
      softInputTokenRatio: SOFT_INPUT_TOKEN_RATIO,
      softTurnRatio: SOFT_TURN_RATIO,
      ...(input.guardDiagnostics ? { guardDiagnostics: input.guardDiagnostics } : {}),
    },
  };
}

export function createPlannerInspectionObserver(input: {
  budget?: PlannerInspectionBudget;
  stage?: PlannerFamilyStage;
} = {}): PlannerInspectionObserver {
  const budget = input.budget ?? derivePlannerInspectionBudget();
  const stage = input.stage ?? 'planner';
  const state = createPlannerContextObservationState();
  const events: EforgeEvent[] = [];
  let handoffReason: PlannerInspectionObservationStatus['reason'];
  let toolUseCount = 0;

  return {
    observe(event: EforgeEvent): PlannerInspectionObservationStatus {
      events.push(event);
      observePlannerContextUsage(state, event, stage);
      if (event.type === 'agent:tool_use' && event.agent === stage) toolUseCount++;
      handoffReason = handoffReason ?? inspectionReason(state.observed, budget, toolUseCount);
      return { shouldHandoff: handoffReason !== undefined, ...(handoffReason ? { reason: handoffReason } : {}), observed: { ...state.observed } };
    },
    shouldHandoff(): boolean {
      return handoffReason !== undefined;
    },
    setPrompt(prompt: string): PlannerContextObservation {
      return { ...setPlannerContextPromptBytes(state, prompt) };
    },
    buildHandoff(input: Omit<BuildPlannerInspectionHandoffInput, 'events' | 'budget'>): PlannerInspectionHandoff {
      return buildPlannerInspectionHandoff({ ...input, events, budget, incompleteReason: input.incompleteReason ?? handoffReason });
    },
    get observed(): PlannerContextObservation {
      return { ...state.observed };
    },
    get events(): readonly EforgeEvent[] {
      return events;
    },
  };
}
// --- eforge:endregion planner-inspection-budget-observer ---

// --- eforge:region planner-inspection-handoff-formatting ---
export function buildPlannerInspectionHandoff(input: BuildPlannerInspectionHandoffInput): PlannerInspectionHandoff {
  const stage = input.stage ?? 'planner';
  const evidence = extractEvidence(input.events, stage, input.budget.toolUseCaps);
  const observed = createPlannerContextObservationState();
  if (input.prompt !== undefined) setPlannerContextPromptBytes(observed, input.prompt);
  for (const event of input.events) observePlannerContextUsage(observed, event, stage);
  const sourceContextCap = capSourceContext(input.sourceBuildContext ?? {});
  const sourceCap = capSourceIdentifiers(input.source);
  const sourceBuildContext = sourceContextCap.context;
  const omittedCounts: PlannerInspectionOmittedCounts = { ...evidence.omittedCounts, ...sourceContextCap.omittedCounts, ...sourceCap.omittedCounts };
  const caveats = buildCaveats(input, evidence, omittedCounts);

  return {
    kind: 'planner-inspection-handoff',
    version: 1,
    source: sourceCap.source,
    relevantFiles: evidence.relevantFiles,
    observedFacts: evidence.observedFacts,
    importantFindings: evidence.importantFindings,
    inferredImplementationAreas: evidence.inferredImplementationAreas,
    unresolvedQuestions: evidence.unresolvedQuestions,
    sourceBuildContext,
    budgetDiagnostics: {
      ...input.budget.diagnostics,
      observed: observed.observed,
      toolUseCount: evidence.toolUseCount,
      toolResultCount: evidence.toolResultCount,
    },
    caveats,
    omittedCounts,
  } satisfies PlannerInspectionHandoff;
}

export function formatPlannerInspectionHandoffMarkdown(handoff: PlannerInspectionHandoff): string {
  const lines = [
    '# Planner Inspection Handoff',
    '',
    'Use this compact deterministic handoff to resume synthesis. It intentionally excludes raw full transcripts and oversized tool-result bodies.',
    '',
    '## Source and build identifiers',
    formatMap(handoff.source),
    '',
    '## Source/build context',
    formatMap(handoff.sourceBuildContext),
    '',
    '## Relevant files',
    formatList(handoff.relevantFiles),
    '',
    '## Observed facts',
    formatList(handoff.observedFacts),
    '',
    '## Important findings',
    formatList(handoff.importantFindings),
    '',
    '## Inferred implementation areas',
    formatList(handoff.inferredImplementationAreas),
    '',
    '## Unresolved questions',
    formatList(handoff.unresolvedQuestions),
    '',
    '## Budget diagnostics',
    formatMap(handoff.budgetDiagnostics),
    '',
    '## Incomplete-inspection caveats',
    formatList(handoff.caveats),
    '',
    '## Omitted-count diagnostics',
    formatMap(handoff.omittedCounts),
  ];
  return `${lines.join('\n')}\n`;
}

export async function writePlannerInspectionHandoffArtifact(input: {
  cwd: string;
  outputDir: string;
  planSetName: string;
  handoff: PlannerInspectionHandoff;
  fileName?: string;
  artifactDir?: string;
}): Promise<string> {
  const planSetName = safeRelativePathComponent(input.planSetName, 'planSetName');
  const fileName = safeRelativePathComponent(input.fileName ?? PLANNER_INSPECTION_HANDOFF_ARTIFACT, 'fileName');
  const dir = input.artifactDir ? resolve(input.cwd, input.artifactDir) : resolve(input.cwd, input.outputDir, planSetName);
  await mkdir(dir, { recursive: true });
  const artifactPath = resolve(dir, fileName);
  if (!isInsideDirectory(artifactPath, dir)) throw new Error(`Planner inspection artifact path escapes output directory: ${fileName}`);
  await writeFile(artifactPath, `${JSON.stringify(input.handoff, null, 2)}\n`, 'utf8');
  return artifactPath;
}

export async function inspectPlannerHandoffArtifact(path: string): Promise<{ artifactPath: string; byteLength: number; contentHash: string }> {
  const info = await stat(path);
  const contentHash = createHash('sha256').update(await readFile(path)).digest('hex');
  return { artifactPath: path, byteLength: info.size, contentHash };
}

// --- eforge:endregion planner-inspection-handoff-formatting ---

// --- eforge:region planner-inspection-evidence-helpers ---
type PlannerInspectionOmittedCountKey = keyof PlannerInspectionOmittedCounts;

interface Evidence {
  relevantFiles: string[];
  observedFacts: string[];
  importantFindings: string[];
  inferredImplementationAreas: string[];
  unresolvedQuestions: string[];
  toolUseCount: number;
  toolResultCount: number;
  omittedCounts: PlannerInspectionOmittedCounts;
}

function extractEvidence(events: readonly EforgeEvent[], stage: PlannerFamilyStage, caps: PlannerInspectionToolUseCaps): Evidence {
  const files = new Set<string>();
  const facts: string[] = [];
  const findings: string[] = [];
  const questions: string[] = [];
  const toolUseIndex = new Map<string, { tool: string; input: unknown }>();
  const omittedCounts: PlannerInspectionOmittedCounts = {};
  let toolUseCount = 0;
  let toolResultCount = 0;

  for (const event of events) {
    if (!('agent' in event) || event.agent !== stage) continue;
    if (event.type === 'agent:tool_use') {
      toolUseCount++;
      if (toolUseCount <= caps.maxToolUses) {
        toolUseIndex.set(event.toolUseId, { tool: event.tool, input: event.input });
        addCappedPaths(files, event.input, omittedCounts);
        const summary = summarizeToolUse(event.tool, event.input);
        if (summary) facts.push(capCountedText(summary, MAX_TOOL_SUMMARY_BYTES, 'toolUseSummaryBytes', omittedCounts));
      }
    } else if (event.type === 'agent:tool_result') {
      toolResultCount++;
      if (toolResultCount <= caps.maxToolResults) {
        const use = toolUseIndex.get(event.toolUseId);
        addCappedPaths(files, event.output, omittedCounts);
        const snippetCap = capText(event.output, MAX_TOOL_SNIPPET_BYTES);
        incrementOmitted(omittedCounts, 'toolResultSnippetBytes', snippetCap.omittedBytes);
        const snippet = sanitizeToolResultSnippet(snippetCap.text);
        if (snippet.trim()) findings.push(capCountedText(`[${use?.tool ?? event.tool}] ${snippet}`, MAX_TOOL_SNIPPET_BYTES, 'importantFindingBytes', omittedCounts));
      }
    } else if (event.type === 'agent:message') {
      const messageCap = capText(event.content, MAX_TEXT_BYTES);
      incrementOmitted(omittedCounts, 'messageBytes', messageCap.omittedBytes);
      const snippet = messageCap.text;
      if (snippet.trim()) facts.push(snippet);
      if (/[?]|\b(?:unknown|unclear|unresolved|todo)\b/i.test(event.content)) questions.push(snippet);
    }
  }

  const relevantFiles = capArray([...files], Math.min(caps.maxRelevantFiles, MAX_FILES), 'relevantFiles', omittedCounts);
  const observedFacts = capArray(dedupe(facts), Math.min(caps.maxObservedFacts, MAX_FACTS), 'observedFacts', omittedCounts);
  const importantFindings = capArray(dedupe(findings), Math.min(caps.maxImportantFindings, MAX_FINDINGS), 'importantFindings', omittedCounts);
  const unresolvedQuestions = capArray(dedupe(questions), Math.min(caps.maxUnresolvedQuestions, MAX_QUESTIONS), 'unresolvedQuestions', omittedCounts);
  const inferredImplementationAreas = capArray(capCountedStrings(inferAreas(relevantFiles), MAX_PATH_BYTES, 'inferredImplementationAreaBytes', omittedCounts), Math.min(caps.maxImplementationAreas, MAX_AREAS), 'inferredImplementationAreas', omittedCounts);
  if (toolUseCount > caps.maxToolUses) omittedCounts.toolUses = toolUseCount - caps.maxToolUses;
  if (toolResultCount > caps.maxToolResults) omittedCounts.toolResults = toolResultCount - caps.maxToolResults;
  return { relevantFiles, observedFacts, importantFindings, inferredImplementationAreas, unresolvedQuestions, toolUseCount, toolResultCount, omittedCounts };
}

function buildCaveats(input: BuildPlannerInspectionHandoffInput, evidence: Evidence, omittedCounts: PlannerInspectionOmittedCounts): string[] {
  const caveats = [
    `Inspection is incomplete; resume synthesis from compact evidence rather than assuming the full codebase was inspected.`,
    `Soft budget reason: ${input.incompleteReason ?? 'manual handoff'}.`,
  ];
  if (Object.values(omittedCounts).some((count) => Number(count) > 0)) caveats.push('Some evidence was omitted by deterministic caps; inspect omitted-count diagnostics before relying on absence of evidence.');
  if (evidence.toolUseCount === 0) caveats.push('No tool-use evidence was observed for the planner stage.');
  return capCountedStrings(caveats, MAX_CAVEAT_BYTES, 'caveatBytes', omittedCounts);
}

function inspectionReason(observed: PlannerContextObservation, budget: PlannerInspectionBudget, toolUseCount: number): PlannerInspectionObservationStatus['reason'] | undefined {
  if (observed.inputTokens >= budget.softInputTokenThreshold) return 'soft-input-tokens';
  if (observed.turns >= budget.inspectionTurnBudget) return 'inspection-turns';
  if (toolUseCount >= budget.toolUseCaps.maxToolUses) return 'tool-use-cap';
  return undefined;
}

function capSourceIdentifiers(source: PlannerInspectionIdentifiers): { source: PlannerInspectionIdentifiers; omittedCounts: PlannerInspectionOmittedCounts } {
  const omittedCounts: PlannerInspectionOmittedCounts = {};
  return {
    source: {
      ...(source.sourceId ? { sourceId: capCountedText(source.sourceId, MAX_IDENTIFIER_BYTES, 'sourceIdBytes', omittedCounts) } : {}),
      ...(source.sourceName ? { sourceName: capCountedText(source.sourceName, MAX_IDENTIFIER_BYTES, 'sourceNameBytes', omittedCounts) } : {}),
      ...(source.sourcePath ? { sourcePath: capCountedText(source.sourcePath, MAX_PATH_BYTES, 'sourcePathBytes', omittedCounts) } : {}),
      ...(source.buildId ? { buildId: capCountedText(source.buildId, MAX_IDENTIFIER_BYTES, 'buildIdBytes', omittedCounts) } : {}),
      ...(source.planSetName ? { planSetName: capCountedText(source.planSetName, MAX_IDENTIFIER_BYTES, 'planSetNameBytes', omittedCounts) } : {}),
      ...(source.runId ? { runId: capCountedText(source.runId, MAX_IDENTIFIER_BYTES, 'runIdBytes', omittedCounts) } : {}),
    },
    omittedCounts,
  };
}

function capSourceContext(context: PlannerInspectionSourceContext): { context: PlannerInspectionSourceContext; omittedCounts: PlannerInspectionOmittedCounts } {
  const omittedCounts: PlannerInspectionOmittedCounts = {};
  const sourceSummary = context.sourceSummary ? capText(context.sourceSummary, MAX_SOURCE_CONTEXT_BYTES) : undefined;
  const buildGoal = context.buildGoal ? capText(context.buildGoal, MAX_SOURCE_CONTEXT_BYTES) : undefined;
  const promptSourceSnippet = context.promptSourceSnippet ? capText(context.promptSourceSnippet, MAX_SOURCE_CONTEXT_BYTES) : undefined;
  incrementOmitted(omittedCounts, 'sourceSummaryBytes', sourceSummary?.omittedBytes ?? 0);
  incrementOmitted(omittedCounts, 'buildGoalBytes', buildGoal?.omittedBytes ?? 0);
  incrementOmitted(omittedCounts, 'promptSourceSnippetBytes', promptSourceSnippet?.omittedBytes ?? 0);
  return {
    context: {
      ...(sourceSummary ? { sourceSummary: sourceSummary.text } : {}),
      ...(buildGoal ? { buildGoal: buildGoal.text } : {}),
      ...(promptSourceSnippet ? { promptSourceSnippet: promptSourceSnippet.text } : {}),
    },
    omittedCounts,
  };
}

function addCappedPaths(files: Set<string>, value: unknown, omittedCounts: PlannerInspectionOmittedCounts): void {
  for (const path of extractPaths(value)) files.add(capCountedText(path, MAX_PATH_BYTES, 'relevantFileBytes', omittedCounts));
}

function capCountedStrings(items: readonly string[], maxBytes: number, key: PlannerInspectionOmittedCountKey, omittedCounts: PlannerInspectionOmittedCounts): string[] {
  return items.map((item) => capCountedText(item, maxBytes, key, omittedCounts));
}

function capCountedText(text: string, maxBytes: number, key: PlannerInspectionOmittedCountKey, omittedCounts: PlannerInspectionOmittedCounts): string {
  const capped = capText(text, maxBytes);
  incrementOmitted(omittedCounts, key, capped.omittedBytes);
  return capped.text;
}

function summarizeToolUse(tool: string, input: unknown): string | undefined {
  const obj = asRecord(input);
  if (tool === 'Read') return `Read ${firstString(obj.file_path, obj.path) ?? 'a file'}`;
  if (tool === 'Grep') return `Searched for ${firstString(obj.pattern) ?? 'a pattern'}${obj.path ? ` in ${String(obj.path)}` : ''}`;
  if (tool === 'Glob') return `Globbed ${firstString(obj.pattern) ?? 'files'}`;
  if (tool === 'Bash') return `Ran command: ${capText(firstString(obj.command) ?? '', 300).text}`;
  return `${tool} called`;
}

function extractPaths(value: unknown): string[] {
  const paths = new Set<string>();
  if (typeof value === 'string') {
    const text = capPathScanText(value);
    for (const match of text.matchAll(PATH_PATTERN)) paths.add(cleanPath(match[1]));
    return [...paths].filter(Boolean);
  }
  const obj = asRecord(value);
  for (const key of ['file_path', 'filepath', 'path', 'file']) {
    const raw = obj[key];
    const text = typeof raw === 'string' ? capPathScanText(raw) : undefined;
    if (text && looksLikePath(text)) paths.add(cleanPath(text));
  }
  const files = obj.files;
  if (Array.isArray(files)) {
    for (const file of files) {
      const text = typeof file === 'string' ? capPathScanText(file) : undefined;
      if (text && looksLikePath(text)) paths.add(cleanPath(text));
    }
  }
  const command = firstString(obj.command);
  if (command) for (const path of extractPaths(command)) paths.add(path);
  return [...paths].filter(Boolean);
}

function capPathScanText(text: string): string {
  return text.length > MAX_PATH_SCAN_CHARS ? text.slice(0, MAX_PATH_SCAN_CHARS) : text;
}

function inferAreas(files: readonly string[]): string[] {
  const areas = new Set<string>();
  for (const file of files) {
    const parts = file.split('/').filter(Boolean);
    if (parts.length >= 2) areas.add(parts.slice(0, -1).join('/'));
    else if (parts[0]) areas.add(parts[0]);
  }
  return [...areas];
}

function defaultToolUseCaps(): PlannerInspectionToolUseCaps {
  return {
    maxToolUses: 80,
    maxToolResults: 60,
    maxRelevantFiles: MAX_FILES,
    maxObservedFacts: MAX_FACTS,
    maxImportantFindings: MAX_FINDINGS,
    maxImplementationAreas: MAX_AREAS,
    maxUnresolvedQuestions: MAX_QUESTIONS,
  };
}

function lowerThanHard(value: number, hard: number): number {
  if (hard <= 1) return 0;
  return Math.max(1, Math.min(value, hard - 1));
}

function safeRelativePathComponent(value: string, label: string): string {
  if (!value.trim()) throw new Error(`Planner inspection ${label} must not be empty`);
  if (isAbsolute(value) || value.includes('/') || value.includes('\\') || value.split(/[\\/]+/).includes('..')) {
    throw new Error(`Planner inspection ${label} must be a safe relative path component`);
  }
  return value;
}

function isInsideDirectory(child: string, parent: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath.length > 0 && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function capArray<T>(items: readonly T[], max: number, key: PlannerInspectionOmittedCountKey, omittedCounts: PlannerInspectionOmittedCounts): T[] {
  const cap = Math.max(0, Math.floor(max));
  if (items.length > cap) omittedCounts[key] = items.length - cap;
  return items.slice(0, cap);
}

function incrementOmitted(omittedCounts: PlannerInspectionOmittedCounts, key: PlannerInspectionOmittedCountKey, count: number): void {
  if (count > 0) omittedCounts[key] = (omittedCounts[key] ?? 0) + count;
}

function sanitizeToolResultSnippet(text: string): string {
  return text.replace(/RAW-TRANSCRIPT-SHOULD-NOT-APPEAR\S*/g, '[raw transcript omitted]');
}

function capText(text: string, maxBytes: number): { text: string; omittedBytes: number } {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= maxBytes) return { text, omittedBytes: 0 };
  let end = Math.max(0, maxBytes - ELLIPSIS_BYTES);
  while (Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes - ELLIPSIS_BYTES) end--;
  return { text: `${text.slice(0, end)}…`, omittedBytes: bytes - Buffer.byteLength(text.slice(0, end), 'utf8') };
}

function formatList(items: readonly string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- none captured';
}

function formatMap(value: unknown): string {
  const entries = Object.entries(flatten(value));
  return entries.length ? entries.map(([key, val]) => `- ${key}: ${String(val)}`).join('\n') : '- none';
}

function flatten(value: unknown, prefix = ''): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, val] of Object.entries(asRecord(value))) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (val === undefined) continue;
    if (val === null || ['string', 'number', 'boolean'].includes(typeof val)) out[name] = val as string | number | boolean;
    else Object.assign(out, flatten(val, name));
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function looksLikePath(value: string): boolean {
  return value.includes('/') || /\.[A-Za-z0-9]+$/.test(value);
}

function cleanPath(path: string): string {
  return path.trim().replace(/^['"`]+|['"`),:;]+$/g, '');
}

function dedupe(items: readonly string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
// --- eforge:endregion planner-inspection-evidence-helpers ---
