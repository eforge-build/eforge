import { defineExtensionAction, type Static } from '../../../packages/extension-sdk/src/index.js';
import { projectKanbanBoard } from './kanban.js';
import { buildRecommendationIndex } from './recommendation-index.js';
import { listBacklogEpics, listBacklogItems } from './markdown-store.js';
import { listTraceSidecars, summarizeTrace } from './trace-store.js';
import { toJsonSafeObject } from './json-safe.js';
// --- eforge:region recommendations ---
import { readRecommendationsFromPath, resolveRecommendationsPath, resolveRecommendationsPathForCwd, summarizeRecommendations } from './recommendations-store.js';
// --- eforge:endregion recommendations ---
import {
  BoardActionInputSchema,
  ListBoardOutputSchema,
  MarkdownOutputSchema,
  type BoardActionInput,
} from './schema.js';

export const listBoard = defineExtensionAction({
  id: 'list-board',
  title: 'List eforge-plan board',
  description: 'Read backlog epics, items, kanban lanes, blocked reasons, and trace summaries.',
  inputSchema: BoardActionInputSchema,
  outputSchema: ListBoardOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    // --- eforge:region recommendations ---
    return projectBoardOutput(await buildBoard(ctx.cwd, input, resolveRecommendationsPath(ctx.paths)));
    // --- eforge:endregion recommendations ---
  },
});

export const renderBoardMarkdown = defineExtensionAction({
  id: 'render-board-markdown',
  title: 'Render eforge-plan board',
  description: 'Render the derived kanban board as Markdown for hosts and Console.',
  inputSchema: BoardActionInputSchema,
  outputSchema: MarkdownOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    // --- eforge:region recommendations ---
    return { markdown: renderBoard(await buildBoard(ctx.cwd, input, resolveRecommendationsPath(ctx.paths))) };
    // --- eforge:endregion recommendations ---
  },
});

export async function buildBoard(cwd: string, input: BoardActionInput, recommendationsPath?: string) {
  const resolvedRecommendationsPath = recommendationsPath ?? resolveRecommendationsPathForCwd(cwd);
  const [epics, items, traces, recommendations] = await Promise.all([
    listBacklogEpics(cwd),
    listBacklogItems(cwd),
    listTraceSidecars(cwd),
    // --- eforge:region recommendations ---
    readRecommendationsFromPath(resolvedRecommendationsPath),
    // --- eforge:endregion recommendations ---
  ]);
  const traceSummaries = traces.flatMap((trace) => summarizeTrace(trace) ?? []);
  const recommendationIndex = buildRecommendationIndex(recommendations);
  const board = projectKanbanBoard(items, traceSummaries, {
    epic: input.epic,
    includeArchive: input.includeArchive,
    epics,
    recommendationIndex,
  });
  return {
    epics,
    items,
    lanes: board.lanes,
    blockedReasons: board.items
      .filter((item) => item.unresolvedDependsOn.length > 0)
      .map((item) => ({ itemId: item.id, reasons: item.reasons })),
    traceSummaries,
    // --- eforge:region recommendations ---
    recommendationSummary: summarizeRecommendations(recommendations),
    // --- eforge:endregion recommendations ---
  };
}

export function projectBoardOutput(board: Awaited<ReturnType<typeof buildBoard>>): Static<typeof ListBoardOutputSchema> {
  return toJsonSafeObject(board) as Static<typeof ListBoardOutputSchema>;
}

export function renderBoard(board: Awaited<ReturnType<typeof buildBoard>>): string {
  const lines = ['# eforge-plan board', ''];
  // --- eforge:region recommendations ---
  if (board.recommendationSummary) {
    lines.push('## Recommended Next Work', '');
    if (board.recommendationSummary.recommendedNextItemIds.length === 0) {
      lines.push('_No recommended next items._', '');
    } else {
      for (const itemId of board.recommendationSummary.recommendedNextItemIds) {
        lines.push(`- **${itemId}**`);
      }
      lines.push('');
    }
    if (board.recommendationSummary.safeParallelizableGroups.length > 0) {
      lines.push('### Safe Parallelizable Groups', '');
      for (const group of board.recommendationSummary.safeParallelizableGroups) {
        lines.push(`- **${group.ref}**${group.title ? ` — ${group.title}` : ''}: ${group.itemIds.join(', ')}`);
      }
      lines.push('');
    }
    if (board.recommendationSummary.blockedChainCount > 0) {
      lines.push(`Blocked chains: ${board.recommendationSummary.blockedChainCount}`, '');
    }
    if (board.recommendationSummary.rationaleAndAssumptions.length > 0) {
      lines.push('### Rationale and Assumptions', '');
      for (const entry of board.recommendationSummary.rationaleAndAssumptions) lines.push(`- ${entry}`);
      lines.push('');
    }
  }
  // --- eforge:endregion recommendations ---
  for (const lane of board.lanes) {
    lines.push(`## ${lane.title}`, '');
    if (lane.items.length === 0) lines.push('_No items._', '');
    for (const item of lane.items) {
      lines.push(`- **${item.id}** (${item.status}) ${item.title}${item.reasons.length ? ` — ${item.reasons.join('; ')}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
