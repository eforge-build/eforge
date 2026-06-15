import { Type, type Static } from '@sinclair/typebox';
import { API_ROUTES, buildPath } from './routes.js';
import { parseWithSchema, safeParseWithSchema, type SafeParseResult } from './schema-utils.js';

export const EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION = 1;
export const CONSOLE_WORKSTATION_BROWSER_SDK_VERSION = 1;
const ROUTE_SEGMENT_URL_PATTERN = '[^/?#]+';

export const CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN = '^sha256-[a-f0-9]{64}-path-[a-f0-9]{64}$';
export const CONSOLE_WORKSTATION_BUNDLE_SHA256_PATTERN = '^[a-f0-9]{64}$';
export const CONSOLE_WORKSTATION_FRAME_URL_PATTERN = routePatternToRegexPattern(
  API_ROUTES.extensionWorkstationFrame,
  {},
  '(?:\\?[^#]*)?',
);
export const CONSOLE_WORKSTATION_BUNDLE_ASSET_URL_PATTERN = routePatternToRegexPattern(
  API_ROUTES.extensionWorkstationAsset,
  { assetId: CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN.slice(1, -1) },
);
const CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_HASH_PATTERN = /^sha256-([a-f0-9]{64})-path-[a-f0-9]{64}$/;

function routePatternToRegexPattern(
  pattern: string,
  paramPatterns: Partial<Record<string, string>> = {},
  suffix = '',
): string {
  const escapedPattern = escapeRegex(pattern);
  const urlPattern = escapedPattern.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, param: string) => (
    paramPatterns[param] ?? ROUTE_SEGMENT_URL_PATTERN
  ));
  return `^${urlPattern}${suffix}$`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

export const ExtensionActionOutputProfileSchema = Type.Union([
  Type.Literal('agent-compact'),
  Type.Literal('agent-paginated'),
  Type.Literal('markdown'),
  Type.Literal('ui-rich'),
  Type.Literal('debug-rich'),
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
  outputProfile: Type.Optional(ExtensionActionOutputProfileSchema),
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

export const ConsoleWorkstationFrameBundleAssetRefSchema = Type.Object({
  id: Type.String({ pattern: CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN }),
  url: Type.String({ pattern: CONSOLE_WORKSTATION_BUNDLE_ASSET_URL_PATTERN }),
  relativePath: Type.String(),
  sha256: Type.String({ pattern: CONSOLE_WORKSTATION_BUNDLE_SHA256_PATTERN }),
}, { additionalProperties: false });

export const ConsoleWorkstationFrameBundleManifestSchema = Type.Object({
  browserSdkVersion: Type.Literal(CONSOLE_WORKSTATION_BROWSER_SDK_VERSION),
  frameUrl: Type.String({ pattern: CONSOLE_WORKSTATION_FRAME_URL_PATTERN }),
  entrypoint: ConsoleWorkstationFrameBundleAssetRefSchema,
  styles: Type.Array(ConsoleWorkstationFrameBundleAssetRefSchema),
  assets: Type.Array(ConsoleWorkstationFrameBundleAssetRefSchema),
}, { additionalProperties: false });

export const ConsoleWorkstationSrcDocManifestEntrySchema = Type.Object({
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

export const ConsoleWorkstationFrameBundleManifestEntrySchema = Type.Object({
  id: Type.String(),
  localId: Type.String(),
  extensionName: Type.String(),
  extensionPath: Type.String(),
  title: Type.String(),
  description: Type.Optional(Type.String()),
  schemaVersion: Type.Literal(EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION),
  frameBundle: ConsoleWorkstationFrameBundleManifestSchema,
  allowedActions: Type.Array(Type.String()),
}, { additionalProperties: false });

export const ConsoleWorkstationManifestEntrySchema = Type.Union([
  ConsoleWorkstationSrcDocManifestEntrySchema,
  ConsoleWorkstationFrameBundleManifestEntrySchema,
]);

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
  consoleWorkstations: Type.Array(ConsoleWorkstationManifestEntrySchema),
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

export const ExtensionActionValidationErrorSchema = Type.Object({
  path: Type.String(),
  message: Type.String(),
}, { additionalProperties: ExtensionJsonValueSchema });

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
export type ExtensionActionOutputProfile = Static<typeof ExtensionActionOutputProfileSchema>;
export type ExtensionActionBindingManifest = Static<typeof ExtensionActionBindingManifestSchema>;
export type ConsoleContributionRendererId = Static<typeof ConsoleContributionRendererIdSchema>;
export type ConsoleContributionBlock = Static<typeof ConsoleContributionBlockSchema>;
export type ExtensionActionManifestEntry = Static<typeof ExtensionActionManifestEntrySchema>;
export type ConsoleContributionManifestEntry = Static<typeof ConsoleContributionManifestEntrySchema>;
export type ConsoleWorkstationFrameBundleAssetRef = Static<typeof ConsoleWorkstationFrameBundleAssetRefSchema>;
export type ConsoleWorkstationFrameBundleManifest = Static<typeof ConsoleWorkstationFrameBundleManifestSchema>;
export type ConsoleWorkstationSrcDocManifestEntry = Static<typeof ConsoleWorkstationSrcDocManifestEntrySchema>;
export type ConsoleWorkstationFrameBundleManifestEntry = Static<typeof ConsoleWorkstationFrameBundleManifestEntrySchema>;
export type ConsoleWorkstationManifestEntry = Static<typeof ConsoleWorkstationManifestEntrySchema>;
export type IntegrationCommandManifestEntry = Static<typeof IntegrationCommandManifestEntrySchema>;
export type ExtensionDeepLinkManifestEntry = Static<typeof ExtensionDeepLinkManifestEntrySchema>;
export type ExtensionContributionDiagnostic = Static<typeof ExtensionContributionDiagnosticSchema>;
export type ExtensionContributionManifestResponse = Static<typeof ExtensionContributionManifestResponseSchema>;
export type ExtensionActionInvokeRequest = Static<typeof ExtensionActionInvokeRequestSchema>;
export type ExtensionActionInvokeErrorCode = Static<typeof ExtensionActionInvokeErrorCodeSchema>;
export type ExtensionActionValidationError = Static<typeof ExtensionActionValidationErrorSchema>;
export type ExtensionActionInvokeSuccessResponse = Static<typeof ExtensionActionInvokeSuccessResponseSchema>;
export type ExtensionActionInvokeFailureResponse = Static<typeof ExtensionActionInvokeFailureResponseSchema>;
export type ExtensionActionInvokeResponse = Static<typeof ExtensionActionInvokeResponseSchema>;

function validateFrameBundleRoutes(manifest: ExtensionContributionManifestResponse): SafeParseResult<ExtensionContributionManifestResponse> {
  const errors = manifest.consoleWorkstations.flatMap((workstation, workstationIndex) => {
    if (!('frameBundle' in workstation)) return [];
    const expectedFrameUrl = buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: workstation.id });
    const expectedFramePrefix = `${expectedFrameUrl}?`;
    const frameErrors = workstation.frameBundle.frameUrl === expectedFrameUrl || workstation.frameBundle.frameUrl.startsWith(expectedFramePrefix)
      ? []
      : [{
        path: `/consoleWorkstations/${workstationIndex}/frameBundle/frameUrl`,
        message: 'must use the workstation id as the frame route parameter',
      }];
    const assets = [workstation.frameBundle.entrypoint, ...workstation.frameBundle.styles, ...workstation.frameBundle.assets];
    const assetErrors = assets.flatMap((asset, assetIndex) => {
      const expectedAssetUrl = buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId: workstation.id, assetId: asset.id });
      const idHash = CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_HASH_PATTERN.exec(asset.id)?.[1];
      return [
        ...(asset.url === expectedAssetUrl ? [] : [{
          path: `/consoleWorkstations/${workstationIndex}/frameBundle/assets/${assetIndex}/url`,
          message: 'must use the workstation id and asset id as route parameters',
        }]),
        ...(idHash === asset.sha256 ? [] : [{
          path: `/consoleWorkstations/${workstationIndex}/frameBundle/assets/${assetIndex}/sha256`,
          message: 'must match the sha256 component of the asset id',
        }]),
      ];
    });
    return [...frameErrors, ...assetErrors];
  });

  if (errors.length === 0) return { success: true, data: manifest };
  return {
    success: false,
    error: {
      errors,
      message: errors.map((error) => `${error.path}: ${error.message}`).join('\n'),
    },
  };
}

export function safeParseExtensionContributionManifest(value: unknown): SafeParseResult<ExtensionContributionManifestResponse> {
  const result = safeParseWithSchema(ExtensionContributionManifestResponseSchema, value);
  if (!result.success) return result;
  return validateFrameBundleRoutes(result.data);
}

export function parseExtensionContributionManifest(value: unknown): ExtensionContributionManifestResponse {
  const result = safeParseExtensionContributionManifest(value);
  if (result.success) return result.data;
  throw new Error(result.error.message);
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
