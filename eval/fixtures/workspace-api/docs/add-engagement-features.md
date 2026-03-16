# Workspace Engagement Features

## Overview

Add three engagement features to the workspace API: emoji reactions on messages, threaded replies, and channel pins. These features are independent verticals - each has its own data model, store, routes, and tests. They share a common foundation of type definitions, app wiring, and a delete-hook mechanism for cascade cleanup.

The foundation layer modifies existing shared files (`src/types.ts`, `src/app.ts`, `src/store.ts`). Each feature module then builds on that foundation by creating only new files, with no cross-feature dependencies.

## Requirements

### 1. Foundation

Set up shared types, app wiring, and a delete-hook system that the three feature modules will use.

1. Add the following interfaces to `src/types.ts`:
   - `Reaction`: `id` (string), `messageId` (string), `userId` (string), `emoji` (string), `createdAt` (string)
   - `ReactionSummary`: `emoji` (string), `count` (number), `userIds` (string[])
   - `ThreadReply`: `id` (string), `parentMessageId` (string), `channelId` (string), `authorId` (string), `content` (string), `createdAt` (string), `editedAt` (string | null)
   - `ThreadSummary`: `replyCount` (number), `lastReplyAt` (string | null), `participants` (string[])
   - `Pin`: `id` (string), `channelId` (string), `messageId` (string), `pinnedById` (string), `note` (string), `pinnedAt` (string)
2. Add a delete-hook system to `src/store.ts`:
   - Export `registerDeleteHook(entity: 'message' | 'channel' | 'workspace', hook: (id: string) => void): void` - registers a callback invoked when an entity is deleted.
   - Modify `deleteMessage()` to call all registered `'message'` hooks with the message ID before removing it.
   - Modify `deleteChannel()` to call all registered `'channel'` hooks with the channel ID before removing it. The existing message cascade should still work.
   - Modify `deleteWorkspace()` to call all registered `'workspace'` hooks with the workspace ID before removing it. Existing cascades should still work.
   - Export `clearDeleteHooks(): void` for test cleanup.
3. Wire three new routers into `src/app.ts`:
   - `import { reactionsRouter } from './routes/reactions.js'` mounted at `/reactions`
   - `import { threadsRouter } from './routes/threads.js'` mounted at `/threads`
   - `import { pinsRouter } from './routes/pins.js'` mounted at `/pins`
4. Tests in `test/delete-hooks.test.ts`:
   - Registering a hook for `'message'` and deleting a message invokes the hook with the message ID
   - Registering a hook for `'channel'` and deleting a channel invokes the hook with the channel ID
   - Hooks for different entity types do not interfere with each other
   - `clearDeleteHooks()` removes all registered hooks

### 2. Emoji Reactions

Add emoji reactions so users can respond to messages without typing a reply.

1. Create `src/stores/reactions.ts` with:
   - Internal state: an array of `Reaction` objects and a counter for IDs.
   - `addReaction(messageId: string, userId: string, emoji: string): Reaction` - creates a reaction. If the same user has already reacted with the same emoji on the same message, return the existing reaction (no duplicates).
   - `removeReaction(id: string): boolean` - deletes a reaction by ID.
   - `getReactionsByMessage(messageId: string): Reaction[]` - returns all reactions for a message.
   - `getReactionSummary(messageId: string): ReactionSummary[]` - returns reactions grouped by emoji, each with `emoji`, `count`, and `userIds`. Sort by count descending.
   - `removeReactionsByMessage(messageId: string): void` - removes all reactions for a message (used as a delete hook).
   - `clearReactions(): void` - resets all state for tests.
2. At module load time, call `registerDeleteHook('message', removeReactionsByMessage)` to wire cascade cleanup.
3. Create `src/routes/reactions.ts` exporting `reactionsRouter` (a `Router`):
   - `POST /messages/:messageId/reactions` - accepts `{ userId, emoji }`. Returns 400 if `userId` or `emoji` is missing. Returns 404 if the message does not exist (check via `getMessageById`). Returns 201 with the reaction object.
   - `GET /messages/:messageId/reactions` - returns the reaction summary (grouped by emoji). Returns 404 if the message does not exist.
   - `DELETE /messages/:messageId/reactions/:id` - deletes a reaction by ID. Returns 404 if the reaction does not exist.
4. Tests in `test/reactions.test.ts`:
   - Adding a reaction returns the reaction object with correct fields
   - Adding the same user+message+emoji twice returns the existing reaction (same ID)
   - Different users reacting with the same emoji creates separate reactions
   - `getReactionSummary` groups by emoji with correct counts and userIds, sorted by count descending
   - Removing a reaction excludes it from the summary
   - Deleting a message via `deleteMessage()` removes all its reactions (cascade via hook)
   - `POST` returns 404 for non-existent message
   - `POST` returns 400 when emoji or userId is missing

### 3. Threaded Replies

Add message threading so conversations can branch without cluttering the main channel feed.

1. Create `src/stores/threads.ts` with:
   - Internal state: an array of `ThreadReply` objects and a counter for IDs.
   - `createReply(parentMessageId: string, channelId: string, authorId: string, content: string): ThreadReply` - creates a reply associated with a parent message.
   - `getRepliesByParent(parentMessageId: string, options?: { limit?: number; before?: string }): ThreadReply[]` - returns replies sorted by `createdAt` ascending. If `before` is provided, return only replies with `createdAt` strictly less than that value. If `limit` is provided, return at most that many replies (applied after filtering).
   - `getReplyById(id: string): ThreadReply | undefined` - returns a single reply.
   - `updateReply(id: string, updates: { content?: string }): ThreadReply | undefined` - updates reply content and sets `editedAt` to current ISO timestamp.
   - `deleteReply(id: string): boolean` - deletes a reply.
   - `getThreadSummary(parentMessageId: string): ThreadSummary` - returns `{ replyCount, lastReplyAt, participants }` where `participants` is an array of unique `authorId`s across replies. If no replies exist, return `{ replyCount: 0, lastReplyAt: null, participants: [] }`.
   - `getThreadsByChannel(channelId: string): string[]` - returns parent message IDs that have at least one reply in this channel, sorted by the most recent reply's `createdAt` descending.
   - `removeRepliesByParent(parentMessageId: string): void` - removes all replies for a parent (used as a delete hook).
   - `clearReplies(): void` - resets all state for tests.
2. At module load time, call `registerDeleteHook('message', removeRepliesByParent)` to wire cascade cleanup.
3. Create `src/routes/threads.ts` exporting `threadsRouter` (a `Router`):
   - `POST /messages/:messageId/replies` - accepts `{ authorId, content }`. Returns 400 if `authorId` or `content` is missing. Returns 404 if the parent message does not exist. Looks up the parent message's `channelId` and passes it to `createReply`. Returns 201 with the reply object.
   - `GET /messages/:messageId/replies` - returns replies for the message. Supports `?limit=` (number, default 50) and `?before=` (ISO timestamp cursor). Returns 404 if the parent message does not exist.
   - `GET /messages/:messageId/thread-summary` - returns the thread summary. Returns 404 if the parent message does not exist.
   - `GET /channels/:channelId/threads` - returns an array of parent message IDs that have replies in this channel, sorted by most recent reply. Returns 404 if the channel does not exist.
   - `PATCH /replies/:id` - accepts `{ content }`. Returns 404 if the reply does not exist. Returns the updated reply.
   - `DELETE /replies/:id` - deletes a reply. Returns 404 if not found. Returns 204.
4. Tests in `test/threads.test.ts`:
   - Creating a reply associates it with the parent message and channel
   - Replies are returned in chronological order (ascending)
   - Cursor pagination: `?before=` filters out newer replies, `?limit=` caps result count
   - Thread summary returns correct `replyCount`, `lastReplyAt`, and unique `participants`
   - Thread summary for a message with no replies returns zeros/nulls
   - `getThreadsByChannel` returns parent message IDs sorted by most recent reply
   - Editing a reply updates content and sets `editedAt`
   - Deleting a parent message removes all its replies (cascade via hook)
   - `POST` returns 404 for non-existent parent message

### 4. Channel Pins

Add the ability to pin important messages to a channel for easy reference.

1. Create `src/stores/pins.ts` with:
   - Internal state: an array of `Pin` objects, a counter for IDs, and a configurable pin limit (default 50).
   - `pinMessage(channelId: string, messageId: string, pinnedById: string, note?: string): Pin | { error: 'duplicate' } | { error: 'limit_reached'; limit: number }` - creates a pin. If the same message is already pinned in this channel, return `{ error: 'duplicate' }`. If the channel has reached the pin limit, return `{ error: 'limit_reached', limit }`. Otherwise return the new `Pin`.
   - `unpinMessage(channelId: string, messageId: string): boolean` - removes a pin by channel+message. Returns false if not found.
   - `getPinsByChannel(channelId: string): Pin[]` - returns all pins for a channel, sorted by `pinnedAt` descending (newest first).
   - `getPinById(id: string): Pin | undefined` - returns a single pin.
   - `getPinCount(channelId: string): number` - returns the number of pins in a channel.
   - `removePinsByChannel(channelId: string): void` - removes all pins for a channel (used as a delete hook).
   - `removePinsByMessage(messageId: string): void` - removes all pins referencing a message (used as a delete hook).
   - `clearPins(): void` - resets all state for tests.
   - `setPinLimit(limit: number): void` - configures the pin limit (for tests).
2. At module load time, call `registerDeleteHook('channel', removePinsByChannel)` and `registerDeleteHook('message', removePinsByMessage)` to wire cascade cleanup.
3. Create `src/routes/pins.ts` exporting `pinsRouter` (a `Router`):
   - `POST /channels/:channelId/pins` - accepts `{ messageId, pinnedById, note? }`. Returns 400 if `messageId` or `pinnedById` is missing. Returns 404 if the channel does not exist (check via `getChannelById`). Returns 404 if the message does not exist (check via `getMessageById`). Returns 409 if the message is already pinned. Returns 409 with `{ error: "Pin limit reached", limit }` if limit exceeded. Returns 201 with the pin object.
   - `GET /channels/:channelId/pins` - returns pins for the channel, each enriched with `message: { content, authorId }` from the message store. Returns 404 if the channel does not exist.
   - `DELETE /channels/:channelId/pins/:messageId` - unpins a message. Returns 404 if the pin does not exist. Returns 204.
   - `GET /channels/:channelId/pins/count` - returns `{ count: number }`. Returns 404 if the channel does not exist.
4. Tests in `test/pins.test.ts`:
   - Pinning a message returns the pin object with correct fields
   - Pinning the same message twice in the same channel returns 409 (duplicate)
   - Pinning beyond the limit returns 409 with limit info
   - Pins are returned newest-first
   - Pin list includes enriched message content and authorId
   - Unpinning removes the pin
   - `getPinCount` returns the correct count
   - Deleting a message removes all pins referencing it (cascade via hook)
   - Deleting a channel removes all its pins (cascade via hook)
   - `POST` returns 404 for non-existent channel or message

## Non-goals

- No authentication or authorization (all endpoints are public, userId passed in request body - consistent with the existing API)
- No WebSocket or SSE real-time updates for reactions/replies/pins
- No emoji validation (any string is accepted as an emoji)
- No nested threads (replies cannot have their own replies)
- No external dependencies (all in-memory, no new npm packages)

## Technical Constraints

- All new code must be TypeScript with strict mode enabled
- Follow existing patterns: `Router`-based routes, function-based stores with module-level state
- Each feature creates its own store file (`src/stores/`) and route file (`src/routes/`)
- Each feature creates its own test file (`test/`)
- All existing tests must continue to pass after changes
- New features must have test coverage
- Import types from `../types.js` (the foundation adds all interfaces there)
- Import store helpers from `../store.js` for `getMessageById`, `getChannelById`, `registerDeleteHook`
