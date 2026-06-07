import { defineExtensionAction, type Static } from '../../../packages/extension-sdk/src/index.js';
import { projectKanbanBoard } from './kanban.js';
import { listBacklogEpics, listBacklogItems } from './markdown-store.js';
import { listTraceSidecars, summarizeTrace } from './trace-store.js';
import { toJsonSafeObject } from './json-safe.js';
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
    return projectBoardOutput(await buildBoard(ctx.cwd, input));
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
    return { markdown: renderBoard(await buildBoard(ctx.cwd, input)) };
  },
});

export async function buildBoard(cwd: string, input: BoardActionInput) {
  const [epics, items, traces] = await Promise.all([listBacklogEpics(cwd), listBacklogItems(cwd), listTraceSidecars(cwd)]);
  const traceSummaries = traces.flatMap((trace) => summarizeTrace(trace) ?? []);
  const board = projectKanbanBoard(items, traceSummaries, { epic: input.epic, includeArchive: input.includeArchive });
  return {
    epics,
    items,
    lanes: board.lanes,
    blockedReasons: board.items
      .filter((item) => item.unresolvedDependsOn.length > 0)
      .map((item) => ({ itemId: item.id, reasons: item.reasons })),
    traceSummaries,
  };
}

export function projectBoardOutput(board: Awaited<ReturnType<typeof buildBoard>>): Static<typeof ListBoardOutputSchema> {
  return toJsonSafeObject(board) as Static<typeof ListBoardOutputSchema>;
}

export function renderBoard(board: Awaited<ReturnType<typeof buildBoard>>): string {
  const lines = ['# eforge-plan board', ''];
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
