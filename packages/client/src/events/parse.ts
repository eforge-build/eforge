import { validateDecompositionRawFieldsForEvent, validateEforgeEventSemanticFields, validateReviewIssueMetadataBoundsForEvent } from '../event-validation.js';
import { formatSchemaError, safeParseWithSchema } from '../schema-utils.js';
import type { SafeParseResult } from '../schema-utils.js';
import { EforgeEventSchema, type EforgeEvent } from './root.js';
import { DaemonStreamSnapshotSchema, SessionStreamSnapshotSchema, type DaemonStreamSnapshot, type SessionStreamSnapshot } from './snapshots.js';

/** Safely parses an unknown value as an `EforgeEvent`. */
export function safeParseEforgeEvent(value: unknown): SafeParseResult<EforgeEvent> {
  const metadataBoundsError = validateReviewIssueMetadataBoundsForEvent(value);
  if (metadataBoundsError) return { success: false, error: metadataBoundsError };

  const decompositionRawFieldError = validateDecompositionRawFieldsForEvent(value);
  if (decompositionRawFieldError) return { success: false, error: decompositionRawFieldError };

  const result = safeParseWithSchema(EforgeEventSchema, value);
  if (!result.success) return result;

  const semanticError = validateEforgeEventSemanticFields(result.data);
  return semanticError ? { success: false, error: semanticError } : result;
}

/** Parses an unknown value as an `EforgeEvent`, throwing on failure. */
export function parseEforgeEvent(value: unknown): EforgeEvent {
  const result = safeParseEforgeEvent(value);
  if (result.success) return result.data;
  throw new Error(formatSchemaError(result.error));
}

/** Safely parses an unknown value as a `DaemonStreamSnapshot`. */
export function safeParseDaemonStreamSnapshot(value: unknown): SafeParseResult<DaemonStreamSnapshot> {
  return safeParseWithSchema(DaemonStreamSnapshotSchema, value);
}

/** Safely parses an unknown value as a `SessionStreamSnapshot`. */
export function safeParseSessionStreamSnapshot(value: unknown): SafeParseResult<SessionStreamSnapshot> {
  return safeParseWithSchema(SessionStreamSnapshotSchema, value);
}
