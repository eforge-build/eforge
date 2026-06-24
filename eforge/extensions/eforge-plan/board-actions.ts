import { CONTRIBUTION_OUTPUT_PROFILES, defineExtensionAction, type Static } from '@eforge-build/extension-sdk';
import { projectKanbanBoard } from './kanban.js';
import { buildRecommendationIndex } from './recommendation-index.js';
import { listBacklogEpics, listBacklogItems } from './markdown-store.js';
import { listTraceSidecars } from './trace-store.js';
import { summarizeProjectTraces } from './trace-activity.js';
import { toJsonSafeObject } from './json-safe.js';
import { aggregateLifecycleLinks, projectEpicProgress } from './lifecycle-projection.js';
// --- eforge:region plan-04-projections-lifecycle ---
import { buildBoardDebugProjection, renderBoardProjection } from './projections/index.js';
// --- eforge:endregion plan-04-projections-lifecycle ---
// --- eforge:region recommendations ---
import { readRecommendationsFromPath, resolveRecommendationsPath, resolveRecommendationsPathForCwd, summarizeRecommendations } from './recommendations-store.js';
import { readDerivedRecommendationStatus } from './recommendation-status.js';
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
  description: 'Read compatibility/debug rich backlog epics, items, kanban lanes, blocked reasons, recommendation status/summary, and lifecycle summaries for hosts that explicitly need the full board payload.',
  inputSchema: BoardActionInputSchema,
  outputSchema: ListBoardOutputSchema,
  outputProfile: CONTRIBUTION_OUTPUT_PROFILES.debugRich,
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
  description: 'Render the derived kanban board as Markdown for hosts and Console, including recommendation freshness notes when available.',
  inputSchema: BoardActionInputSchema,
  outputSchema: MarkdownOutputSchema,
  outputProfile: CONTRIBUTION_OUTPUT_PROFILES.markdown,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    // --- eforge:region recommendations ---
    return { markdown: renderBoard(await buildBoard(ctx.cwd, input, resolveRecommendationsPath(ctx.paths))) };
    // --- eforge:endregion recommendations ---
  },
});

export async function buildBoard(cwd: string, input: BoardActionInput, recommendationsPath?: string): Promise<any> {
  // --- eforge:region plan-04-projections-lifecycle ---
  return buildBoardDebugProjection(cwd, input);
  // --- eforge:endregion plan-04-projections-lifecycle ---
  const resolvedRecommendationsPath = recommendationsPath ?? resolveRecommendationsPathForCwd(cwd);
  const [epics, items, traces, recommendations, recommendationStatus] = await Promise.all([
    listBacklogEpics(cwd),
    listBacklogItems(cwd),
    listTraceSidecars(cwd),
    // --- eforge:region recommendations ---
    readRecommendationsFromPath(resolvedRecommendationsPath),
    readDerivedRecommendationStatus(cwd, resolvedRecommendationsPath),
    // --- eforge:endregion recommendations ---
  ]);
  const traceSummaries = await summarizeProjectTraces(cwd, traces);
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
    lifecycleLinks: aggregateLifecycleLinks(traceSummaries),
    epicProgress: projectEpicProgress({ epics, items, traceSummaries }),
    // --- eforge:region recommendations ---
    recommendationSummary: summarizeRecommendations(recommendations),
    recommendationStatus,
    // --- eforge:endregion recommendations ---
  };
}

export function projectBoardOutput(board: Awaited<ReturnType<typeof buildBoard>>): Static<typeof ListBoardOutputSchema> {
  return toJsonSafeObject(board) as Static<typeof ListBoardOutputSchema>;
}

export function renderBoard(board: Awaited<ReturnType<typeof buildBoard>>): string {
  // --- eforge:region plan-04-projections-lifecycle ---
  return renderBoardProjection(board);
  // --- eforge:endregion plan-04-projections-lifecycle ---
}
