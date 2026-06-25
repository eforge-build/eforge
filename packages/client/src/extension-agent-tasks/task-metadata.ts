import { Type, type Static } from '@sinclair/typebox';
import {
  EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES,
  EXTENSION_AGENT_TASK_ACTIVITY_MESSAGE_MAX_LENGTH,
} from './constants.js';
export {
  EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES,
  EXTENSION_AGENT_TASK_ACTIVITY_MESSAGE_MAX_LENGTH,
} from './constants.js';
const EXTENSION_AGENT_TASK_ACTIVITY_TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' as const;
const EXTENSION_AGENT_TASK_ACTIVITY_TIMESTAMP_RE = new RegExp(EXTENSION_AGENT_TASK_ACTIVITY_TIMESTAMP_PATTERN);

export const ExtensionAgentTaskBacklogCurationItemProgressSchema = Type.Object({
  itemId: Type.String({ minLength: 1, maxLength: 240 }),
  title: Type.Optional(Type.String({ maxLength: 300 })),
  status: Type.Union([Type.Literal('pending'), Type.Literal('running'), Type.Literal('cache-hit'), Type.Literal('completed'), Type.Literal('failed'), Type.Literal('cancelled')]),
  outcome: Type.Optional(Type.String({ maxLength: 80 })),
  verdict: Type.Optional(Type.String({ maxLength: 80 })),
  summary: Type.Optional(Type.String({ maxLength: 500 })),
  startedAt: Type.Optional(Type.String({ maxLength: 120 })),
  completedAt: Type.Optional(Type.String({ maxLength: 120 })),
}, { additionalProperties: false });

export const ExtensionAgentTaskBacklogCurationProgressSchema = Type.Object({
  total: Type.Integer({ minimum: 0 }),
  cacheHits: Type.Integer({ minimum: 0 }),
  misses: Type.Integer({ minimum: 0 }),
  running: Type.Integer({ minimum: 0 }),
  completed: Type.Integer({ minimum: 0 }),
  remaining: Type.Integer({ minimum: 0 }),
  items: Type.Array(ExtensionAgentTaskBacklogCurationItemProgressSchema, { maxItems: 1_000 }),
}, { additionalProperties: false });

export const ExtensionAgentTaskActivityEntrySchema = Type.Object({
  timestamp: Type.String({ minLength: 1, pattern: EXTENSION_AGENT_TASK_ACTIVITY_TIMESTAMP_PATTERN }),
  message: Type.String({ minLength: 1, maxLength: EXTENSION_AGENT_TASK_ACTIVITY_MESSAGE_MAX_LENGTH, pattern: '\\S' }),
}, { additionalProperties: false });

export type ExtensionAgentTaskBacklogCurationItemProgress = Static<typeof ExtensionAgentTaskBacklogCurationItemProgressSchema>;
export type ExtensionAgentTaskBacklogCurationProgress = Static<typeof ExtensionAgentTaskBacklogCurationProgressSchema>;
export type ExtensionAgentTaskActivityEntry = Static<typeof ExtensionAgentTaskActivityEntrySchema>;

export function extensionAgentTaskActivityTimestampError(record: { metadata?: { activityLog?: readonly ExtensionAgentTaskActivityEntry[] } }, pathPrefix = '') {
  const entries = record.metadata?.activityLog;
  const invalidIndex = entries?.findIndex((entry) => !isCanonicalExtensionAgentTaskActivityTimestamp(entry.timestamp)) ?? -1;
  if (invalidIndex < 0) return undefined;
  const path = `${pathPrefix}/metadata/activityLog/${invalidIndex}/timestamp`;
  const message = 'Expected canonical ISO timestamp with millisecond precision';
  return { message: `${path}: ${message}`, errors: [{ path, message }] };
}

function isCanonicalExtensionAgentTaskActivityTimestamp(timestamp: string): boolean {
  if (!EXTENSION_AGENT_TASK_ACTIVITY_TIMESTAMP_RE.test(timestamp)) return false;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === timestamp;
}
