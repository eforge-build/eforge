import { createHash } from 'node:crypto';

import {
  MAX_COMPILE_RISK_LIST_ITEMS,
  type CompilePipelineScope,
  type CompilePreflightRisk,
  type CompileRecoveryAction,
} from '@eforge-build/client';

import { extractExpectedAcceptanceCriteria } from '../validation/acceptance-criteria.js';

// --- eforge:region plan-02-preflight-compaction ---
export const DEFAULT_MAX_PROMPT_SOURCE_BYTES = 80_000;
export const MODERATE_SOURCE_BYTES = 40_000;
export const LARGE_SOURCE_BYTES = 120_000;
export const GENERATED_INVENTORY_MIN_BYTES = 4_000;
export const MACHINE_READABLE_SECTION_MIN_BYTES = 2_000;
export const LARGE_CODE_FENCE_MIN_BYTES = 8_000;
export const GENERATED_OMITTED_BYTES_RISK = 20_000;
export const ELEVATED_RISK_SCORE = 40;
export const OVERFLOW_RISK_SCORE = 80;
export const MANY_ACCEPTANCE_CRITERIA = 35;
export const OVERFLOW_ACCEPTANCE_CRITERIA = 70;
const MAX_EVENT_STRING_LENGTH = 2_000;
const MAX_SUMMARY_FRAGMENT_LENGTH = 240;
const MAX_PRESERVED_SUMMARY_LENGTH = 1_000;

export interface CompilePreflightOptions {
  selectedProfile?: string | null;
  requestedPipelineScope?: CompilePipelineScope | null;
  fullContentRequiredPaths?: string[];
  fullContentRequiredHeadings?: string[];
  maxPromptSourceBytes?: number;
}

export interface CompilePromptSourceBundle {
  originalBytes: number;
  promptSource: string;
  promptSourceBytes: number;
  sourceHash: string;
  compactions: Array<{
    kind: 'generated-inventory' | 'machine-readable-sidecar' | 'large-code-fence';
    heading?: string;
    path?: string;
    pathReferences?: string[];
    originalBytes: number;
    contentHash: string;
    itemCount?: number;
    preservedSummary: string;
  }>;
  analysis: {
    acceptanceCriteriaCount: number;
    subsystemBreadth: CompilePreflightRisk['subsystemBreadth'];
    detectedBlocks: Array<CompilePromptSourceBundle['compactions'][number] & { omittedBytes: number }>;
  };
}

type CompactionKind = CompilePromptSourceBundle['compactions'][number]['kind'];
type DetectedBlock = CompilePromptSourceBundle['compactions'][number] & { omittedBytes: number };

export function buildCompilePromptSourceBundle(
  strippedSource: string,
  options: CompilePreflightOptions = {},
): CompilePromptSourceBundle {
  const allowedHeadings = new Set((options.fullContentRequiredHeadings ?? []).map(normalizeHeading));
  const allowedPaths = new Set((options.fullContentRequiredPaths ?? []).map(normalizePath));
  const replacements = detectBlocks(strippedSource).filter((block) => block.originalBytes >= thresholdFor(block.kind));
  let promptSource = '';
  let cursor = 0;
  const compactions: CompilePromptSourceBundle['compactions'] = [];
  const detected: DetectedBlock[] = [];

  for (const block of replacements) {
    if (block.start < cursor) continue;
    const allow = block.headings.some((candidate) => allowedHeadings.has(normalizeHeading(candidate)))
      || block.pathReferences.some((path) => allowedPaths.has(normalizePath(path)));
    promptSource += strippedSource.slice(cursor, block.start);
    const base = toCompaction(block);
    detected.push({ ...base, omittedBytes: allow ? 0 : block.originalBytes });
    if (allow) {
      promptSource += strippedSource.slice(block.start, block.end);
    } else {
      compactions.push(base);
      promptSource += formatReplacement(base);
    }
    cursor = block.end;
  }
  promptSource += strippedSource.slice(cursor);

  const bundle: CompilePromptSourceBundle = {
    originalBytes: byteLength(strippedSource),
    promptSource,
    promptSourceBytes: byteLength(promptSource),
    sourceHash: sha256(strippedSource),
    compactions,
    analysis: {
      acceptanceCriteriaCount: extractExpectedAcceptanceCriteria(strippedSource).length,
      subsystemBreadth: deriveSubsystemBreadth(strippedSource),
      detectedBlocks: detected,
    },
  };
  return bundle;
}

export function estimateCompilePreflightRisk(
  bundle: CompilePromptSourceBundle,
  options: CompilePreflightOptions = {},
): CompilePreflightRisk {
  const maxPromptBytes = options.maxPromptSourceBytes ?? DEFAULT_MAX_PROMPT_SOURCE_BYTES;
  const detected = bundle.analysis?.detectedBlocks ?? bundle.compactions.map((c) => ({ ...c, omittedBytes: c.originalBytes }));
  const acCount = bundle.analysis?.acceptanceCriteriaCount ?? extractExpectedAcceptanceCriteria(bundle.promptSource).length;
  const breadth = bundle.analysis?.subsystemBreadth ?? deriveSubsystemBreadth(bundle.promptSource);
  const reasons: string[] = [];
  let score = 0;

  if (bundle.originalBytes > MODERATE_SOURCE_BYTES) add(20, 'source-bytes:moderate');
  if (bundle.originalBytes > LARGE_SOURCE_BYTES) add(25, 'source-bytes:large');
  if (bundle.promptSourceBytes > maxPromptBytes) add(60, 'prompt-source-bytes:over-budget');
  if (acCount >= MANY_ACCEPTANCE_CRITERIA) add(20, 'acceptance-criteria:many');
  if (acCount > OVERFLOW_ACCEPTANCE_CRITERIA) add(60, 'acceptance-criteria:overflow');
  if (detected.length > 0) add(20, 'generated-inventory:detected');
  const omittedBytes = detected.reduce((sum, b) => sum + b.omittedBytes, 0);
  if (omittedBytes > GENERATED_OMITTED_BYTES_RISK) add(20, 'generated-inventory:large-omission');
  if (breadth.count >= 4) add(20, 'subsystem-breadth:wide');
  if (breadth.count >= 6) add(20, 'subsystem-breadth:very-wide');
  const selectedProfile = options.selectedProfile ?? undefined;
  if (selectedProfile?.toLowerCase() === 'errand' && (bundle.originalBytes > MODERATE_SOURCE_BYTES || acCount >= MANY_ACCEPTANCE_CRITERIA || breadth.count >= 4)) {
    add(15, 'selected-profile:errand-scale-conflict');
  }

  const level = score >= OVERFLOW_RISK_SCORE || bundle.promptSourceBytes > maxPromptBytes || (acCount > OVERFLOW_ACCEPTANCE_CRITERIA && bundle.originalBytes > MODERATE_SOURCE_BYTES)
    ? 'overflow-risk'
    : score >= ELEVATED_RISK_SCORE ? 'elevated' : 'normal';
  const pipelineScope = options.requestedPipelineScope ?? undefined;

  return {
    level,
    sourceBytes: bundle.originalBytes,
    promptSourceBytes: bundle.promptSourceBytes,
    acceptanceCriteriaCount: acCount,
    score,
    generatedInventory: {
      detected: detected.length > 0,
      contentHashes: bounded(unique(detected.map((b) => b.contentHash))),
      pathReferences: boundedStrings(unique(detected.flatMap((b) => b.pathReferences ?? (b.path ? [b.path] : [])))),
      headings: boundedStrings(unique(detected.map((b) => b.heading).filter(isString))),
      blockCount: detected.length,
      sidecarCount: unique(detected.flatMap((b) => b.pathReferences ?? (b.path ? [b.path] : [])).filter(isMachinePath)).length,
      omittedBytes,
    },
    subsystemBreadth: breadth,
    ...(selectedProfile !== undefined && { selectedProfile }),
    ...(pipelineScope !== undefined && { pipelineScope }),
    reasons: bounded(reasons),
    recommendation: recommendation(level, pipelineScope, breadth.count, bundle.promptSourceBytes > maxPromptBytes),
  };

  function add(points: number, reason: string): void {
    score += points;
    reasons.push(reason);
  }
}

export function formatCompilePreflightPromptAppend(input: {
  risk?: CompilePreflightRisk;
  bundle?: CompilePromptSourceBundle;
}): string | undefined {
  const risk = input.risk;
  const bundle = input.bundle;
  if (!risk || (risk.level === 'normal' && (!bundle || bundle.compactions.length === 0))) return undefined;
  const lines = [
    '## Compile Preflight Advisory',
    '',
    `- Risk level: ${risk.level}`,
    `- Score: ${risk.score}`,
    `- Source bytes: ${risk.sourceBytes}`,
    `- Prompt source bytes: ${risk.promptSourceBytes}`,
    `- Acceptance criteria count: ${risk.acceptanceCriteriaCount}`,
    `- Recovery recommendation: ${risk.recommendation.action} (${risk.recommendation.reason})`,
  ];
  if (risk.reasons.length > 0) lines.push(`- Reasons: ${risk.reasons.join(', ')}`);
  if (risk.generatedInventory.blockCount > 0) {
    lines.push(`- Generated inventory blocks: ${risk.generatedInventory.blockCount}; omitted bytes: ${risk.generatedInventory.omittedBytes}`);
    if (risk.generatedInventory.contentHashes.length > 0) lines.push(`- Content hashes: ${risk.generatedInventory.contentHashes.join(', ')}`);
  }
  if (risk.subsystemBreadth.count > 0) lines.push(`- Likely subsystems: ${risk.subsystemBreadth.subsystems.join(', ')} (count ${risk.subsystemBreadth.count})`);
  lines.push('', 'Use the compacted source summaries as references. Do not ask for omitted generated inventory unless explicitly needed.');
  return lines.join('\n').slice(0, 4096);
}
// --- eforge:endregion plan-02-preflight-compaction ---

interface Block {
  start: number;
  end: number;
  kind: CompactionKind;
  heading?: string;
  path?: string;
  pathReferences: string[];
  headings: string[];
  body: string;
  originalBytes: number;
}

function detectBlocks(source: string): Block[] {
  const lines = source.split(/(?<=\n)/);
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length; }
  const blocks: Block[] = [];
  const headingStack: Array<{ depth: number; text: string }> = [];
  let heading = '';
  let sectionHeading = '';
  let sectionStart = 0;
  let sectionDepth = 0;
  let sectionHint = false;
  let sectionGenerated = false;
  let inFence: { startLine: number; info: string; heading: string; headings: string[]; generatedContext: boolean } | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*\n?$/);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      if (sectionHint && depth <= sectionDepth) pushSection(i);
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].depth >= depth) headingStack.pop();
      heading = headingMatch[2].trim();
      headingStack.push({ depth, text: heading });
      if (!sectionHint || depth <= sectionDepth) {
        sectionHeading = heading;
        sectionStart = i;
        sectionDepth = depth;
        sectionGenerated = hasGeneratedHint(heading);
        sectionHint = sectionGenerated;
      }
    }
    const fenceMatch = line.match(/^```\s*([^\n`]*)/);
    if (fenceMatch && !inFence) {
      const headings = headingStack.map((entry) => entry.text);
      inFence = { startLine: i, info: fenceMatch[1].trim(), heading, headings, generatedContext: sectionHint || headings.some(hasGeneratedHint) };
    } else if (line.startsWith('```') && inFence) {
      const body = lines.slice(inFence.startLine, i + 1).join('');
      const pathReferences = extractPaths(`${inFence.info} ${inFence.headings.join(' ')} ${body}`);
      const path = pathReferences[0];
      const machine = isMachinePath(inFence.info) || pathReferences.length > 0;
      if (machine || hasGeneratedHint(inFence.info) || inFence.generatedContext) {
        blocks.push({
          start: starts[inFence.startLine],
          end: starts[i] + line.length,
          kind: inFence.generatedContext ? 'generated-inventory' : machine ? 'machine-readable-sidecar' : 'large-code-fence',
          heading: inFence.heading || undefined,
          path,
          pathReferences,
          headings: inFence.headings,
          body,
          originalBytes: byteLength(body),
        });
      }
      inFence = undefined;
    }
    if (/eforge:(?!acceptance-criteria-inventory)|generated by|do not edit/i.test(line)) {
      sectionHint = true;
      sectionGenerated = true;
    }
  }
  if (sectionHint) pushSection(lines.length);
  return blocks.sort((a, b) => a.start - b.start);

  function pushSection(endLine: number): void {
    const body = lines.slice(sectionStart + 1, endLine).join('');
    const pathReferences = extractPaths(body);
    const path = pathReferences[0];
    const headings = headingStack.filter((entry) => entry.depth <= sectionDepth).map((entry) => entry.text);
    blocks.push({ start: starts[sectionStart] + lines[sectionStart].length, end: endLine < starts.length ? starts[endLine] : source.length, kind: sectionGenerated ? 'generated-inventory' : path ? 'machine-readable-sidecar' : 'generated-inventory', heading: sectionHeading, path, pathReferences, headings, body, originalBytes: byteLength(body) });
  }
}

function toCompaction(block: Block): CompilePromptSourceBundle['compactions'][number] {
  return { kind: block.kind, ...(block.heading && { heading: truncateString(block.heading, MAX_EVENT_STRING_LENGTH) }), ...(block.path && { path: truncateString(block.path, MAX_EVENT_STRING_LENGTH) }), ...(block.pathReferences.length > 0 && { pathReferences: boundedStrings(block.pathReferences) }), originalBytes: block.originalBytes, contentHash: sha256(block.body), itemCount: estimateItemCount(block.body), preservedSummary: summarize(block.body) };
}

function formatReplacement(c: CompilePromptSourceBundle['compactions'][number]): string {
  return [`\n> [eforge compile preflight compaction]`, `> kind: ${c.kind}`, c.heading ? `> heading: ${c.heading}` : undefined, c.path ? `> path: ${c.path}` : undefined, `> originalBytes: ${c.originalBytes}`, `> sha256: ${c.contentHash}`, c.itemCount !== undefined ? `> estimatedItems: ${c.itemCount}` : undefined, `> summary: ${c.preservedSummary}`, ''].filter(isString).join('\n');
}

function thresholdFor(kind: CompactionKind): number {
  if (kind === 'generated-inventory') return GENERATED_INVENTORY_MIN_BYTES;
  if (kind === 'machine-readable-sidecar') return MACHINE_READABLE_SECTION_MIN_BYTES;
  return LARGE_CODE_FENCE_MIN_BYTES;
}

function recommendation(level: CompilePreflightRisk['level'], scope: CompilePipelineScope | undefined, breadth: number, overBudget: boolean): { action: CompileRecoveryAction; eligible: boolean; reason: string } {
  if (level === 'normal') return { action: 'none', eligible: false, reason: 'preflight risk is normal' };
  if (level === 'overflow-risk' && scope !== 'expedition' && breadth >= 4) return { action: 'retry-as-expedition', eligible: true, reason: 'overflow risk with broad subsystem evidence' };
  if (level === 'overflow-risk' && (scope === 'expedition' || overBudget)) return { action: 'bounded-decomposition', eligible: true, reason: 'overflow risk remains after compaction' };
  if (level === 'overflow-risk') return { action: 'manual-reduce-scope', eligible: true, reason: 'overflow risk without clear independent subsystems' };
  return { action: 'none', eligible: false, reason: 'risk is advisory only' };
}

function deriveSubsystemBreadth(source: string): CompilePreflightRisk['subsystemBreadth'] {
  const evidence = new Map<string, string>();
  const patterns: Array<[RegExp, string]> = [
    [/packages\/engine\b|(?:^|[#\s-])engine\b/gi, 'engine'], [/packages\/client\b|(?:^|[#\s-])client\b/gi, 'client'], [/packages\/monitor\b|(?:^|[#\s-])monitor\b/gi, 'monitor'], [/packages\/console-ui\b|\bconsole\b/gi, 'console'], [/packages\/eforge\b|\bcli\b/gi, 'cli'], [/eforge-plugin\b|\bplugin\b/gi, 'plugin'], [/packages\/pi-eforge\b|\bpi\b/gi, 'pi'], [/packages\/input\b|(?:^|[#\s-])input\b/gi, 'input'], [/packages\/scopes\b|(?:^|[#\s-])scopes\b/gi, 'scopes'], [/\bweb\//gi, 'web'], [/\bdocs\//gi, 'docs'], [/\btest\//gi, 'test'], [/\bscripts\//gi, 'scripts'],
  ];
  for (const [re, slug] of patterns) {
    const match = source.match(re)?.[0];
    if (match && !evidence.has(slug)) evidence.set(slug, match);
  }
  const subsystems = [...evidence.keys()].sort();
  return { count: subsystems.length, subsystems: boundedStrings(subsystems), evidence: boundedStrings(subsystems.map((s) => `${s}:${evidence.get(s)}`)) };
}

function summarize(body: string): string {
  const keys = boundedStrings(unique([...body.matchAll(/"([A-Za-z0-9_-]{2,80})"\s*:/g)].map((m) => m[1])), 6, MAX_SUMMARY_FRAGMENT_LENGTH);
  const headings = boundedStrings(unique([...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim())), 4, MAX_SUMMARY_FRAGMENT_LENGTH);
  const summary = [...headings.map((h) => `heading:${h}`), ...keys.map((k) => `key:${k}`)].join('; ') || `${estimateItemCount(body)} structured items`;
  return truncateString(summary, MAX_PRESERVED_SUMMARY_LENGTH);
}

function estimateItemCount(body: string): number {
  return Math.max((body.match(/^\s*[-*+]\s+/gm) ?? []).length, (body.match(/^\s*[{[]/gm) ?? []).length, (body.match(/"[^"]+"\s*:/g) ?? []).length);
}
function extractPaths(text: string): string[] { return unique([...text.matchAll(/[\w./-]+\.(?:jsonl?|ndjson|ya?ml|toml|csv|tsv|lock)\b/gi)].map((match) => normalizePath(match[0]))); }
function hasGeneratedHint(text: string): boolean { return /generated|inventory|sidecar|machine-readable|extracted|catalog|index|file list|dependency graph|schema dump/i.test(text); }
function isMachinePath(text: string): boolean { return /(?:^|[\s./-])(?:jsonl?|ndjson|ya?ml|toml|csv|tsv|lock)\b|\.(?:jsonl?|ndjson|ya?ml|toml|csv|tsv|lock)\b/i.test(text); }
function normalizeHeading(text: string): string { return text.trim().replace(/^#+\s*/, '').toLowerCase(); }
function normalizePath(text: string): string { return text.trim().replace(/^\.\//, '').toLowerCase(); }
function byteLength(text: string): number { return Buffer.byteLength(text, 'utf8'); }
function sha256(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function bounded<T>(items: T[], max = MAX_COMPILE_RISK_LIST_ITEMS): T[] { return items.slice(0, max); }
function boundedStrings(items: string[], max = MAX_COMPILE_RISK_LIST_ITEMS, maxLength = MAX_EVENT_STRING_LENGTH): string[] { return bounded(items.map((item) => truncateString(item, maxLength)), max); }
function truncateString(text: string, maxLength: number): string { return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`; }
function unique<T>(items: T[]): T[] { return [...new Set(items)]; }
function isString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
