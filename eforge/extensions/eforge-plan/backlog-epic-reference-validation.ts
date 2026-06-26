import { userActionError } from './action-errors.js';
import { readCanonicalEpic } from './canonical/backlog-records.js';

export function assertDirectActionEpicReferenceExists(cwd: string, epic: string | null | undefined, actionId: 'capture-item' | 'update-item'): void {
  if (epic === undefined || epic === null || epic.length === 0) return;
  if (readCanonicalEpic(cwd, epic) !== undefined) return;
  throw userActionError(
    `Invalid epic reference "${epic}" for ${actionId}: no canonical epic exists with that id. Use get-epic to inspect a known epic, search-items with includeEpics to discover existing epics, or create/upsert the epic first with upsert-epic before linking backlog items.`,
    { path: 'epic', details: { actionId, epic } },
  );
}
