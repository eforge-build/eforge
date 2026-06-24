import { Type } from '@eforge-build/extension-sdk';
import { defineExtensionAction } from '@eforge-build/extension-sdk';
import { toJsonSafeObject } from '../json-safe.js';
import { runPlanningStoreImport } from './run-import.js';
import { PLANNING_STORE_IMPORT_INCLUDES } from './types.js';

const IncludeSchema = Type.Union(PLANNING_STORE_IMPORT_INCLUDES.map((value) => Type.Literal(value)) as never);
const DiagnosticSeveritySchema = Type.Union(['info', 'warning', 'error'].map((value) => Type.Literal(value)) as never);
const DiagnosticCodeSchema = Type.Union(['orphan-ref', 'missing-file', 'duplicate-id', 'invalid-trace-row', 'stale-recommendation-ref', 'unreadable-artifact', 'unsupported-legacy-payload'].map((value) => Type.Literal(value)) as never);
export const ImportPlanningStoreInputSchema = Type.Object({ dryRun: Type.Optional(Type.Boolean()), replaceExisting: Type.Optional(Type.Boolean()), include: Type.Optional(Type.Array(IncludeSchema, { uniqueItems: true })), diagnosticLimit: Type.Optional(Type.Number({ minimum: 0 })) }, { additionalProperties: false });
const DiagnosticSchema = Type.Object({ diagnosticId: Type.String(), severity: DiagnosticSeveritySchema, code: DiagnosticCodeSchema, message: Type.String(), ref: Type.Optional(Type.String()), path: Type.Optional(Type.String()), details: Type.Optional(Type.Unknown()) }, { additionalProperties: false });
export const ImportPlanningStoreOutputSchema = Type.Object({ schemaVersion: Type.Literal(1), dryRun: Type.Boolean(), applied: Type.Boolean(), replacedExisting: Type.Boolean(), storePath: Type.String(), include: Type.Array(IncludeSchema), sourceFingerprint: Type.String(), counts: Type.Record(Type.String(), Type.Number()), diagnosticCount: Type.Number(), diagnostics: Type.Array(DiagnosticSchema), diagnosticsOmitted: Type.Number() }, { additionalProperties: false });
export const importPlanningStoreAction = defineExtensionAction({ id: 'import-planning-store', title: 'Import planning store', description: 'Dry-run-first importer for legacy eforge-plan Markdown, JSON sidecars, session plans, traces, queue, monitor, planning tasks, and recommendations into canonical SQLite.', inputSchema: ImportPlanningStoreInputSchema, outputSchema: ImportPlanningStoreOutputSchema, sideEffects: ['local-read', 'local-write'], async handler(input, ctx) { return toJsonSafeObject(await runPlanningStoreImport(ctx.cwd, input as never)); } });
