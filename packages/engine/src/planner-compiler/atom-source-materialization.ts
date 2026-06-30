import type { PlanningAtomTask } from './atom-planning-contracts.js';
import { utf8ByteLength } from './source-analysis.js';

export interface MaterializePlanningAtomSourceInput { sourceContent: string; task: PlanningAtomTask }
export interface PlanningAtomSourceExcerpt { headingPath: string[]; startLine: number; endLine: number; criterionIds: string[]; byteLength: number; content: string }
export interface PlanningAtomSourceMaterialization { atomId: string; byteLength: number; excerpts: PlanningAtomSourceExcerpt[]; errors: string[] }

export function materializePlanningAtomSource(input: MaterializePlanningAtomSourceInput): PlanningAtomSourceMaterialization {
  const excerpts = input.task.sourceSlices.map((slice) => {
    const content = sliceByBytes(input.sourceContent, slice.byteStart, slice.byteEnd);
    return {
      headingPath: [...slice.headingPath],
      startLine: slice.startLine,
      endLine: slice.endLine,
      criterionIds: [...slice.criteriaIds],
      byteLength: utf8ByteLength(content),
      content,
    };
  });
  const byteLength = excerpts.reduce((sum, excerpt) => sum + excerpt.byteLength, 0);
  const declaredBytes = input.task.sourceSlices.reduce((sum, slice) => sum + slice.byteLength, 0);
  const errors = [
    ...(declaredBytes > input.task.budget.maxPromptSourceBytes ? [`declared atom source budget exceeded:${input.task.atomId}`] : []),
    ...(byteLength > input.task.budget.maxPromptSourceBytes ? [`materialized atom source budget exceeded:${input.task.atomId}`] : []),
  ];
  return { atomId: input.task.atomId, byteLength, excerpts, errors };
}

export function formatPlanningAtomSourceMaterialization(materialization: PlanningAtomSourceMaterialization): string {
  if (materialization.excerpts.length === 0) return 'No source excerpts were associated with this atom.';
  return materialization.excerpts.map((excerpt, index) => [
    `### Excerpt ${index + 1}`,
    `- Lines: ${excerpt.startLine}-${excerpt.endLine}`,
    `- Criteria: ${excerpt.criterionIds.join(', ') || '(none)'}`,
    excerpt.headingPath.length > 0 ? `- Heading path: ${excerpt.headingPath.join(' > ')}` : undefined,
    '',
    '```markdown',
    excerpt.content,
    '```',
  ].filter((line): line is string => line !== undefined).join('\n')).join('\n\n');
}

function sliceByBytes(content: string, start: number, end: number): string {
  const bytes = Buffer.from(content, 'utf8');
  return bytes.subarray(Math.max(0, start), Math.max(0, end)).toString('utf8');
}
