const MAX_CONTEXT_ITEMS = 25;
const MAX_CONTEXT_EPICS = 10;
const MAX_CONTEXT_STRING = 4000;
export const MAX_SOURCE_TEXT = 60000;
const MAX_REDRAFT_SUMMARY_ITEMS = 10;
const MAX_REDRAFT_SUMMARY_STRING = 1000;
const MAX_SELECTION_IDS = 50;
const MAX_SELECTION_ID_LENGTH = 200;
const SOURCE_TEXT_HARD_CAP_SUFFIX = '…[truncated]';

export function boundedSourceText(userGoal: string, context: Record<string, unknown>, redraft?: Record<string, unknown>): string {
  const metadata: Record<string, unknown> = {};
  const bounded = truncateValue({ ...context }, metadata) as Record<string, unknown>;
  if (Array.isArray(bounded.items) && bounded.items.length > MAX_CONTEXT_ITEMS) {
    metadata.omittedItems = bounded.items.length - MAX_CONTEXT_ITEMS;
    bounded.items = bounded.items.slice(0, MAX_CONTEXT_ITEMS);
  }
  if (Array.isArray(bounded.epics) && bounded.epics.length > MAX_CONTEXT_EPICS) {
    metadata.omittedEpics = bounded.epics.length - MAX_CONTEXT_EPICS;
    bounded.epics = bounded.epics.slice(0, MAX_CONTEXT_EPICS);
  }
  const boundedRedraft = redraft !== undefined ? (truncateValue({ ...redraft }, metadata) as Record<string, unknown>) : undefined;
  let sourceText = JSON.stringify({ userGoal, context: bounded, ...(boundedRedraft !== undefined && { redraft: boundedRedraft }), truncation: metadata }, null, 2);
  if (sourceText.length > MAX_SOURCE_TEXT) {
    metadata.sourceTextTruncated = true;
    const summarizedRedraft = summarizeRedraft(boundedRedraft, metadata);
    const boundedSelection = boundSelection(bounded.selection, metadata);
    sourceText = JSON.stringify({ userGoal, context: { schemaVersion: bounded.schemaVersion, selection: boundedSelection }, ...(summarizedRedraft !== undefined && { redraft: summarizedRedraft }), truncation: metadata }, null, 2);
    if (sourceText.length > MAX_SOURCE_TEXT) {
      sourceText = `${sourceText.slice(0, MAX_SOURCE_TEXT - SOURCE_TEXT_HARD_CAP_SUFFIX.length)}${SOURCE_TEXT_HARD_CAP_SUFFIX}`;
    }
  }
  return sourceText;
}

// Final-pass redraft bound: when the full source text still exceeds the cap, keep
// only the original request, a bounded questions summary, and a bounded subset of
// answers or steering so unbounded redraft answer arrays cannot blow the budget.
function summarizeRedraft(redraft: Record<string, unknown> | undefined, metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  if (redraft === undefined) return undefined;
  metadata.redraftSummarized = true;
  const summary: Record<string, unknown> = {};
  if (typeof redraft.parentTaskId === 'string') summary.parentTaskId = redraft.parentTaskId;
  if (typeof redraft.originalRequest === 'string') summary.originalRequest = boundRedraftString(redraft.originalRequest);
  if (typeof redraft.steering === 'string') summary.steering = boundRedraftString(redraft.steering);
  if (Array.isArray(redraft.previousQuestions)) summary.previousQuestions = boundRedraftArray(redraft.previousQuestions, metadata, 'omittedRedraftQuestions');
  if (Array.isArray(redraft.userAnswers)) summary.userAnswers = boundRedraftArray(redraft.userAnswers, metadata, 'omittedRedraftAnswers');
  return summary;
}

function boundRedraftArray(values: unknown[], metadata: Record<string, unknown>, omittedKey: string): unknown[] {
  if (values.length > MAX_REDRAFT_SUMMARY_ITEMS) metadata[omittedKey] = values.length - MAX_REDRAFT_SUMMARY_ITEMS;
  return values.slice(0, MAX_REDRAFT_SUMMARY_ITEMS).map((value) => (typeof value === 'string' ? boundRedraftString(value) : value));
}

function boundRedraftString(value: string): string {
  return value.length > MAX_REDRAFT_SUMMARY_STRING ? `${value.slice(0, MAX_REDRAFT_SUMMARY_STRING)}…[truncated]` : value;
}

// Final-pass selection bound: the fallback context keeps only schemaVersion and
// selection, but selection itself can carry a large itemIds array or long IDs.
// Cap the number of IDs and truncate each so a wide backlog selection cannot
// produce an oversized prompt.
function boundSelection(selection: unknown, metadata: Record<string, unknown>): unknown {
  if (selection === null || typeof selection !== 'object') return selection;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(selection as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      if (value.length > MAX_SELECTION_IDS) metadata[`omittedSelection_${key}`] = value.length - MAX_SELECTION_IDS;
      result[key] = value.slice(0, MAX_SELECTION_IDS).map((entry) => (typeof entry === 'string' ? boundSelectionId(entry) : entry));
    } else {
      result[key] = typeof value === 'string' ? boundSelectionId(value) : value;
    }
  }
  return result;
}

function boundSelectionId(value: string): string {
  return value.length > MAX_SELECTION_ID_LENGTH ? `${value.slice(0, MAX_SELECTION_ID_LENGTH)}…[truncated]` : value;
}

function truncateValue(value: unknown, metadata: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.length > MAX_CONTEXT_STRING) {
    metadata.truncatedStrings = Number(metadata.truncatedStrings ?? 0) + 1;
    return `${value.slice(0, MAX_CONTEXT_STRING)}…[truncated]`;
  }
  if (Array.isArray(value)) return value.map((entry) => truncateValue(entry, metadata));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, truncateValue(entry, metadata)]));
  return value;
}
