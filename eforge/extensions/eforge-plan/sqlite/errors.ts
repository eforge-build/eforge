export type EforgePlanStoreErrorCode =
  | 'readonly-store'
  | 'schema-mismatch'
  | 'missing-fts5'
  | 'invalid-json-column'
  | 'migration-checksum-mismatch'
  | 'store-closed'
  | 'invalid-input'
  | 'open-failed';

export class EforgePlanStoreError extends Error {
  readonly code: EforgePlanStoreErrorCode;
  readonly cause?: unknown;

  constructor(code: EforgePlanStoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'EforgePlanStoreError';
    this.code = code;
    this.cause = options?.cause;
  }
}
