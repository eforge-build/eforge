import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { PlanningUnitBudget } from '../events.js';
import type { PlanningDecompositionUnit, PlanningUnitOutput } from './planning-decomposition.js';

const FORBIDDEN_UPSTREAM_FIELDS = new Set(['rawSource', 'sourceContent', 'prompt', 'transcript', 'rawTranscript']);

export interface BoundedPlanningPromptContext {
  unit: PlanningDecompositionUnit;
  unitSourceContent: string;
  sourceHash: string;
  upstreamOutputs: PlanningUnitOutput[];
  upstreamCompactHandoffRefs: string[];
  budgets: PlanningUnitBudget;
  artifactDir: string;
  submitToolName?: string;
}

export interface BoundedHandoffInclusion {
  ref: string;
  markdown?: string;
  byteLength: number;
  omittedBytes: number;
}

export function formatBoundedPlanningPromptContext(context: BoundedPlanningPromptContext): string {
  assertNoForbiddenUpstreamFields(context.upstreamOutputs);
  const unit = context.unit;
  const lines = [
    '## Bounded Planning Unit Context',
    '',
    'This is a bounded planning-unit run. Full root source and full root transcript are unavailable by design. Full prior tool results are unavailable by design.',
    context.submitToolName ? `Use the capture-only submission tool \`${context.submitToolName}\`; do not write root planning artifacts.` : 'Use the injected capture-only submission tools; do not write root planning artifacts.',
    '',
    '### Unit identity',
    `- Unit ID: ${unit.unitId}`,
    `- Parent ID: ${unit.parentId ?? 'none'}`,
    `- Depth: ${unit.depth}`,
    `- Source hash: ${context.sourceHash}`,
    `- Artifact directory: ${context.artifactDir}`,
    `- Dependencies: ${formatInlineList(unit.dependsOn)}`,
    '',
    '### Criteria coverage',
    `- Covered criteria IDs: ${formatInlineList(unit.criteriaIds)}`,
    `- Unresolved criteria IDs: ${formatInlineList(unresolvedCriteriaIds(context.upstreamOutputs, unit.unitId))}`,
    '',
    '### Subsystem hints',
    formatBulletList(unit.subsystemHints),
    '',
    '### Interface constraints',
    formatBulletList(unit.interfaceConstraints),
    '',
    '### Shared-file constraints',
    formatBulletList(unit.sharedFileConstraints),
    '',
    '### Source slices',
    ...unit.sourceSlices.map((slice) => `- ${slice.kind} ${slice.path ?? slice.headingPath?.join(' > ') ?? slice.sourceHash}: criteria=${formatInlineList(slice.criteriaIds)} bytes=${slice.byteLength}`),
    '',
    '### Unit source slice',
    'The bounded unit source is provided in the prompt Source section.',
    '',
    '### Unit budgets and local exploration limits',
    formatBudget(context.budgets),
    '',
    '### Upstream compact handoff references',
    formatBulletList(context.upstreamCompactHandoffRefs),
    '',
    '### Upstream bounded output summaries',
    formatUpstreamOutputs(context.upstreamOutputs),
  ];
  return `${lines.join('\n')}\n`;
}

export async function formatBoundedHandoffContext(refs: readonly string[], maxBytes: number): Promise<{ markdown: string; inclusions: BoundedHandoffInclusion[]; byteLength: number }> {
  const inclusions: BoundedHandoffInclusion[] = [];
  let remaining = Math.max(0, maxBytes);
  const sections: string[] = [];
  for (const ref of refs) {
    let markdown: string | undefined;
    let byteLength = 0;
    let omittedBytes = 0;
    try {
      const text = await readFile(ref, 'utf8');
      const capped = capUtf8(text, remaining);
      markdown = capped.text;
      byteLength = Buffer.byteLength(markdown, 'utf8');
      omittedBytes = capped.omittedBytes;
      remaining = Math.max(0, remaining - byteLength);
    } catch {
      markdown = undefined;
    }
    inclusions.push({ ref, markdown, byteLength, omittedBytes });
    sections.push(`#### ${ref}\n${markdown ? `\n${markdown}` : '\n(reference only; content unavailable)'}`);
  }
  const markdown = sections.join('\n\n');
  return { markdown, inclusions, byteLength: Buffer.byteLength(markdown, 'utf8') };
}

export function assertBoundedPromptWithinBudget(prompt: string, unitSourceContent: string, budgets: PlanningUnitBudget): void {
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  const sourceBytes = Buffer.byteLength(unitSourceContent, 'utf8');
  if (sourceBytes > budgets.maxPromptSourceBytes) throw new Error(`bounded unit source bytes ${sourceBytes} exceed maxPromptSourceBytes ${budgets.maxPromptSourceBytes}`);
  if (promptBytes > budgets.maxPromptBytes) throw new Error(`bounded unit prompt bytes ${promptBytes} exceed maxPromptBytes ${budgets.maxPromptBytes}`);
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function capUtf8(text: string, maxBytes: number): { text: string; omittedBytes: number } {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= maxBytes) return { text, omittedBytes: 0 };
  const ellipsisBytes = Buffer.byteLength('…', 'utf8');
  if (maxBytes <= 0) return { text: '', omittedBytes: bytes };
  if (maxBytes < ellipsisBytes) return { text: '', omittedBytes: bytes };
  let end = Math.max(0, maxBytes - ellipsisBytes);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes - ellipsisBytes) end--;
  const capped = `${text.slice(0, end)}…`;
  return { text: capped, omittedBytes: bytes - Buffer.byteLength(capped, 'utf8') };
}

export function assertNoForbiddenUpstreamFields(value: unknown, path = 'upstreamOutputs'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenUpstreamFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_UPSTREAM_FIELDS.has(key)) throw new Error(`Forbidden raw upstream field ${path}.${key} cannot be included in bounded prompts`);
    assertNoForbiddenUpstreamFields(child, `${path}.${key}`);
  }
}

function formatBudget(budget: PlanningUnitBudget): string {
  return Object.entries(budget).map(([key, value]) => `- ${key}: ${value}`).join('\n');
}

function formatUpstreamOutputs(outputs: PlanningUnitOutput[]): string {
  if (outputs.length === 0) return '- none';
  return outputs.map((output) => {
    const record = output as PlanningUnitOutput & Record<string, unknown>;
    return [
      `- Unit ${output.unitId}`,
      record.status ? `  - Status: ${String(record.status)}` : undefined,
      Array.isArray(record.coveredCriteria) ? `  - Covered criteria: ${formatInlineList(record.coveredCriteria as string[])}` : undefined,
      Array.isArray(record.sharedContractNotes) ? `  - Shared contract notes: ${formatInlineList(record.sharedContractNotes as string[])}` : undefined,
      Array.isArray(record.unresolvedRequirements) ? `  - Unresolved requirements: ${formatInlineList((record.unresolvedRequirements as Array<{ criterionId?: string; reason?: string }>).map(item => item.criterionId ?? item.reason ?? 'unresolved'))}` : undefined,
      typeof record.compactHandoffRef === 'string' ? `  - Compact handoff: ${record.compactHandoffRef}` : undefined,
    ].filter(Boolean).join('\n');
  }).join('\n');
}

function unresolvedCriteriaIds(outputs: PlanningUnitOutput[], _unitId: string): string[] {
  const ids = new Set<string>();
  for (const output of outputs as Array<PlanningUnitOutput & Record<string, unknown>>) {
    const unresolved = output.unresolvedRequirements;
    if (!Array.isArray(unresolved)) continue;
    for (const item of unresolved as Array<{ criterionId?: string }>) if (item.criterionId) ids.add(item.criterionId);
  }
  return [...ids];
}

function formatInlineList(items: readonly string[] | undefined): string {
  return items && items.length > 0 ? items.join(', ') : 'none';
}

function formatBulletList(items: readonly string[] | undefined): string {
  return items && items.length > 0 ? items.map(item => `- ${item}`).join('\n') : '- none';
}
