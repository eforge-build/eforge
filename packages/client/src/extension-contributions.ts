import { Type, type Static } from '@sinclair/typebox';
import { parseWithSchema, safeParseWithSchema, type SafeParseResult } from './schema-utils.js';

export const EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION = 1;

export const ExtensionJsonValueSchema = Type.Recursive((Self) => Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
  Type.Array(Self),
  Type.Record(Type.String(), Self),
]));
export const ExtensionJsonObjectSchema = Type.Record(Type.String(), ExtensionJsonValueSchema);

export const ExtensionActionRequestedByHostSchema = Type.Union([
  Type.Literal('console'),
  Type.Literal('pi'),
  Type.Literal('claude'),
  Type.Literal('mcp'),
  Type.Literal('cli'),
]);

export const ExtensionActionRequestedBySchema = Type.Object({
  host: ExtensionActionRequestedByHostSchema,
  surface: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  commandId: Type.Optional(Type.String()),
  deepLinkId: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const ExtensionActionSideEffectSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('local-read'),
  Type.Literal('local-write'),
  Type.Literal('network'),
  Type.Literal('daemon-state'),
  Type.Literal('build-queue'),
]);

export const ExtensionActionBindingManifestSchema = Type.Object({
  actionId: Type.String(),
  inputDefaults: Type.Optional(ExtensionJsonObjectSchema),
}, { additionalProperties: false });

export const ConsoleContributionRendererIdSchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('markdown'),
  Type.Literal('status-badge'),
  Type.Literal('link'),
  Type.Literal('action-button'),
  Type.Literal('action-form'),
]);

export const ConsoleContributionBlockSchema = Type.Union([
  Type.Object({
    rendererId: Type.Literal('text'),
    title: Type.Optional(Type.String()),
    content: Type.String(),
  }, { additionalProperties: false }),
  Type.Object({
    rendererId: Type.Literal('markdown'),
    title: Type.Optional(Type.String()),
    content: Type.String(),
  }, { additionalProperties: false }),
  Type.Object({
    rendererId: Type.Literal('status-badge'),
    title: Type.Optional(Type.String()),
    content: Type.String(),
    status: Type.String(),
  }, { additionalProperties: false }),
  Type.Object({
    rendererId: Type.Literal('link'),
    title: Type.Optional(Type.String()),
    content: Type.String(),
    href: Type.String(),
  }, { additionalProperties: false }),
  Type.Object({
    rendererId: Type.Literal('action-button'),
    title: Type.Optional(Type.String()),
    content: Type.String(),
    action: ExtensionActionBindingManifestSchema,
  }, { additionalProperties: false }),
  Type.Object({
    rendererId: Type.Literal('action-form'),
    title: Type.Optional(Type.String()),
    content: Type.String(),
    action: ExtensionActionBindingManifestSchema,
  }, { additionalProperties: false }),
]);

const TypeBoxSchemaDocumentSchema = ExtensionJsonObjectSchema;
const TypeBoxObjectWireSchema = Type.Intersect([
  ExtensionJsonObjectSchema,
  Type.Object({ type: Type.Literal('object') }),
]);

export const ExtensionActionManifestEntrySchema = Type.Object({
  id: Type.String(),
  localId: Type.String(),
  extensionName: Type.String(),
  extensionPath: Type.String(),
  title: Type.String(),
  description: Type.Optional(Type.String()),
  inputSchema: TypeBoxObjectWireSchema,
  outputSchema: Type.Optional(TypeBoxSchemaDocumentSchema),
  sideEffects: Type.Optional(Type.Array(ExtensionActionSideEffectSchema)),
}, { additionalProperties: false });

export const ConsoleContributionManifestEntrySchema = Type.Object({
  id: Type.String(),
  localId: Type.String(),
  extensionName: Type.String(),
  extensionPath: Type.String(),
  title: Type.String(),
  description: Type.Optional(Type.String()),
  schemaVersion: Type.Literal(EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION),
  blocks: Type.Array(ConsoleContributionBlockSchema),
}, { additionalProperties: false });

// --- eforge:region plan-01-workstation-contract-runtime ---
export const ConsoleWorkstationManifestEntrySchema = Type.Object({
  id: Type.String(),
  localId: Type.String(),
  extensionName: Type.String(),
  extensionPath: Type.String(),
  title: Type.String(),
  description: Type.Optional(Type.String()),
  schemaVersion: Type.Literal(EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION),
  srcDoc: Type.String(),
  allowedActions: Type.Array(Type.String()),
}, { additionalProperties: false });
// --- eforge:endregion plan-01-workstation-contract-runtime ---

export const IntegrationCommandManifestEntrySchema = Type.Object({
  id: Type.String(),
  localId: Type.String(),
  extensionName: Type.String(),
  extensionPath: Type.String(),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  label: Type.String(),
  inputSchema: Type.Optional(TypeBoxObjectWireSchema),
  action: ExtensionActionBindingManifestSchema,
}, { additionalProperties: false });

export const ExtensionDeepLinkManifestEntrySchema = Type.Object({
  id: Type.String(),
  localId: Type.String(),
  extensionName: Type.String(),
  extensionPath: Type.String(),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  label: Type.String(),
  urlTemplate: Type.Optional(Type.String()),
  action: Type.Optional(ExtensionActionBindingManifestSchema),
}, { additionalProperties: false });

export const ExtensionContributionDiagnosticSchema = Type.Object({
  extensionName: Type.Optional(Type.String()),
  extensionPath: Type.Optional(Type.String()),
  severity: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  message: Type.String(),
  code: Type.String(),
  name: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const ExtensionContributionManifestResponseSchema = Type.Object({
  schemaVersion: Type.Literal(EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION),
  generatedAt: Type.String(),
  actions: Type.Array(ExtensionActionManifestEntrySchema),
  consoleContributions: Type.Array(ConsoleContributionManifestEntrySchema),
  // --- eforge:region plan-01-workstation-contract-runtime ---
  consoleWorkstations: Type.Array(ConsoleWorkstationManifestEntrySchema),
  // --- eforge:endregion plan-01-workstation-contract-runtime ---
  integrationCommands: Type.Array(IntegrationCommandManifestEntrySchema),
  deepLinks: Type.Array(ExtensionDeepLinkManifestEntrySchema),
  diagnostics: Type.Optional(Type.Array(ExtensionContributionDiagnosticSchema)),
}, { additionalProperties: false });

export const ExtensionActionInvokeRequestSchema = Type.Object({
  actionId: Type.String({ minLength: 1, pattern: '\\S' }),
  input: ExtensionJsonObjectSchema,
  requestedBy: ExtensionActionRequestedBySchema,
}, { additionalProperties: false });

export const ExtensionActionInvokeErrorCodeSchema = Type.Union([
  Type.Literal('unknown-action'),
  Type.Literal('invalid-request'),
  Type.Literal('invalid-input'),
  Type.Literal('daemon-unavailable'),
  Type.Literal('handler-error'),
  Type.Literal('timeout'),
  Type.Literal('invalid-output'),
  Type.Literal('output-schema-failed'),
]);

export const ExtensionActionInvokeSuccessResponseSchema = Type.Object({
  ok: Type.Literal(true),
  invocationId: Type.String(),
  output: ExtensionJsonValueSchema,
}, { additionalProperties: false });

export const ExtensionActionInvokeFailureResponseSchema = Type.Object({
  ok: Type.Literal(false),
  invocationId: Type.String(),
  error: Type.Object({
    code: ExtensionActionInvokeErrorCodeSchema,
    message: Type.String(),
    details: Type.Optional(ExtensionJsonValueSchema),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const ExtensionActionInvokeResponseSchema = Type.Union([
  ExtensionActionInvokeSuccessResponseSchema,
  ExtensionActionInvokeFailureResponseSchema,
]);

export type ExtensionJsonValue = Static<typeof ExtensionJsonValueSchema>;
export type ExtensionJsonObject = Static<typeof ExtensionJsonObjectSchema>;
export type ExtensionActionRequestedByHost = Static<typeof ExtensionActionRequestedByHostSchema>;
export type ExtensionActionRequestedBy = Static<typeof ExtensionActionRequestedBySchema>;
export type ExtensionActionSideEffect = Static<typeof ExtensionActionSideEffectSchema>;
export type ExtensionActionBindingManifest = Static<typeof ExtensionActionBindingManifestSchema>;
export type ConsoleContributionRendererId = Static<typeof ConsoleContributionRendererIdSchema>;
export type ConsoleContributionBlock = Static<typeof ConsoleContributionBlockSchema>;
export type ExtensionActionManifestEntry = Static<typeof ExtensionActionManifestEntrySchema>;
export type ConsoleContributionManifestEntry = Static<typeof ConsoleContributionManifestEntrySchema>;
// --- eforge:region plan-01-workstation-contract-runtime ---
export type ConsoleWorkstationManifestEntry = Static<typeof ConsoleWorkstationManifestEntrySchema>;
// --- eforge:endregion plan-01-workstation-contract-runtime ---
export type IntegrationCommandManifestEntry = Static<typeof IntegrationCommandManifestEntrySchema>;
export type ExtensionDeepLinkManifestEntry = Static<typeof ExtensionDeepLinkManifestEntrySchema>;
export type ExtensionContributionDiagnostic = Static<typeof ExtensionContributionDiagnosticSchema>;
export type ExtensionContributionManifestResponse = Static<typeof ExtensionContributionManifestResponseSchema>;
export type ExtensionActionInvokeRequest = Static<typeof ExtensionActionInvokeRequestSchema>;
export type ExtensionActionInvokeErrorCode = Static<typeof ExtensionActionInvokeErrorCodeSchema>;
export type ExtensionActionInvokeSuccessResponse = Static<typeof ExtensionActionInvokeSuccessResponseSchema>;
export type ExtensionActionInvokeFailureResponse = Static<typeof ExtensionActionInvokeFailureResponseSchema>;
export type ExtensionActionInvokeResponse = Static<typeof ExtensionActionInvokeResponseSchema>;

export function safeParseExtensionContributionManifest(value: unknown): SafeParseResult<ExtensionContributionManifestResponse> {
  return safeParseWithSchema(ExtensionContributionManifestResponseSchema, value);
}

export function parseExtensionContributionManifest(value: unknown): ExtensionContributionManifestResponse {
  return parseWithSchema(ExtensionContributionManifestResponseSchema, value);
}

export function safeParseExtensionActionInvokeRequest(value: unknown): SafeParseResult<ExtensionActionInvokeRequest> {
  return safeParseWithSchema(ExtensionActionInvokeRequestSchema, value);
}

export function parseExtensionActionInvokeRequest(value: unknown): ExtensionActionInvokeRequest {
  return parseWithSchema(ExtensionActionInvokeRequestSchema, value);
}

export function safeParseExtensionActionInvokeResponse(value: unknown): SafeParseResult<ExtensionActionInvokeResponse> {
  return safeParseWithSchema(ExtensionActionInvokeResponseSchema, value);
}

export function parseExtensionActionInvokeResponse(value: unknown): ExtensionActionInvokeResponse {
  return parseWithSchema(ExtensionActionInvokeResponseSchema, value);
}
