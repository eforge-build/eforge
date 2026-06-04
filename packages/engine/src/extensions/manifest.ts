import type {
  ConsoleContributionBlock,
  ConsoleContributionDetail,
  ConsoleContributionManifestEntry,
  ExtensionActionBindingManifest,
  ExtensionActionDetail,
  ExtensionActionManifestEntry,
  ExtensionContributionManifestResponse,
  ExtensionDeepLinkDetail,
  ExtensionDeepLinkManifestEntry,
  IntegrationCommandDetail,
  IntegrationCommandManifestEntry,
} from '@eforge-build/client';
import { EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION } from '@eforge-build/client';

import { jsonSafeClone } from './contribution-validation.js';
import { resolveExtensionContributionId } from './ids.js';
import type {
  ConsoleContributionBlockSpec,
  ConsoleContributionRegistration,
  DeepLinkRegistration,
  ExtensionActionBindingSpec,
  ActionRegistration,
  IntegrationCommandRegistration,
  NativeExtensionDiagnostic,
  NativeExtensionRegistry,
} from './types.js';

// --- eforge:region plan-02-engine-registry-runtime ---
export function buildExtensionContributionManifest(registry: NativeExtensionRegistry): ExtensionContributionManifestResponse {
  const manifest = {
    schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION as 1,
    generatedAt: new Date().toISOString(),
    actions: registry.actions.map(buildActionManifestEntry).sort(sortById),
    consoleContributions: registry.consoleContributions.map(buildConsoleContributionManifestEntry).sort(sortById),
    integrationCommands: registry.integrationCommands.map(buildIntegrationCommandManifestEntry).sort(sortById),
    deepLinks: registry.deepLinks.map(buildDeepLinkManifestEntry).sort(sortById),
    diagnostics: registry.diagnostics.map((diagnostic) => projectDiagnostic(diagnostic, registry)),
  };
  return manifest;
}

export function buildActionManifestEntry(reg: ActionRegistration): ExtensionActionManifestEntry {
  return omitUndefined({
    id: reg.id,
    localId: reg.localId,
    extensionName: reg.extensionName,
    extensionPath: reg.extensionPath,
    title: reg.value.title,
    description: reg.value.description,
    inputSchema: cloneSchema(reg.value.inputSchema),
    outputSchema: reg.value.outputSchema === undefined ? undefined : cloneSchema(reg.value.outputSchema),
    sideEffects: reg.value.sideEffects === undefined ? undefined : [...reg.value.sideEffects],
  }) as ExtensionActionManifestEntry;
}

export function buildConsoleContributionManifestEntry(reg: ConsoleContributionRegistration): ConsoleContributionManifestEntry {
  return omitUndefined({
    id: reg.id,
    localId: reg.localId,
    extensionName: reg.extensionName,
    extensionPath: reg.extensionPath,
    title: reg.value.title,
    description: reg.value.description,
    schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION as 1,
    blocks: reg.value.blocks.map((block) => projectBlock(block, reg.extensionName)),
  }) as ConsoleContributionManifestEntry;
}

export function buildIntegrationCommandManifestEntry(reg: IntegrationCommandRegistration): IntegrationCommandManifestEntry {
  return omitUndefined({
    id: reg.id,
    localId: reg.localId,
    extensionName: reg.extensionName,
    extensionPath: reg.extensionPath,
    label: reg.value.label,
    description: reg.value.description,
    inputSchema: reg.value.inputSchema === undefined ? undefined : cloneSchema(reg.value.inputSchema),
    action: projectBinding(reg.value.action, reg.extensionName),
  }) as IntegrationCommandManifestEntry;
}

export function buildDeepLinkManifestEntry(reg: DeepLinkRegistration): ExtensionDeepLinkManifestEntry {
  return omitUndefined({
    id: reg.id,
    localId: reg.localId,
    extensionName: reg.extensionName,
    extensionPath: reg.extensionPath,
    label: reg.value.label,
    description: reg.value.description,
    urlTemplate: reg.value.urlTemplate,
    action: reg.value.action === undefined ? undefined : projectBinding(reg.value.action, reg.extensionName),
  }) as ExtensionDeepLinkManifestEntry;
}

export function buildActionDetails(registry: NativeExtensionRegistry, extensionName: string, extensionPath: string): ExtensionActionDetail[] | undefined {
  const details = registry.actions.filter((reg) => belongsTo(reg, extensionName, extensionPath)).map(buildActionManifestEntry);
  return details.length > 0 ? details : undefined;
}

export function buildConsoleContributionDetails(registry: NativeExtensionRegistry, extensionName: string, extensionPath: string): ConsoleContributionDetail[] | undefined {
  const details = registry.consoleContributions.filter((reg) => belongsTo(reg, extensionName, extensionPath)).map(buildConsoleContributionManifestEntry);
  return details.length > 0 ? details : undefined;
}

export function buildIntegrationCommandDetails(registry: NativeExtensionRegistry, extensionName: string, extensionPath: string): IntegrationCommandDetail[] | undefined {
  const details = registry.integrationCommands.filter((reg) => belongsTo(reg, extensionName, extensionPath)).map(buildIntegrationCommandManifestEntry);
  return details.length > 0 ? details : undefined;
}

export function buildDeepLinkDetails(registry: NativeExtensionRegistry, extensionName: string, extensionPath: string): ExtensionDeepLinkDetail[] | undefined {
  const details = registry.deepLinks.filter((reg) => belongsTo(reg, extensionName, extensionPath)).map(buildDeepLinkManifestEntry);
  return details.length > 0 ? details : undefined;
}

export function cloneSchema<T extends Record<string, unknown>>(schema: T): T {
  return jsonSafeClone(schema);
}

function projectBlock(block: ConsoleContributionBlockSpec, extensionName: string): ConsoleContributionBlock {
  const base = { ...block } as Record<string, unknown>;
  if ('action' in block) base.action = projectBinding(block.action, extensionName);
  return omitUndefined(jsonSafeClone(base)) as ConsoleContributionBlock;
}

function projectBinding(binding: ExtensionActionBindingSpec, extensionName: string): ExtensionActionBindingManifest {
  return omitUndefined({
    actionId: resolveExtensionContributionId(extensionName, binding.actionId),
    inputDefaults: binding.inputDefaults === undefined ? undefined : jsonSafeClone(binding.inputDefaults),
  }) as ExtensionActionBindingManifest;
}

function projectDiagnostic(diagnostic: NativeExtensionDiagnostic, registry: NativeExtensionRegistry) {
  const provenance = findDiagnosticProvenance(diagnostic, registry);
  return omitUndefined({
    extensionName: diagnostic.extensionName ?? provenance?.extensionName,
    extensionPath: diagnostic.path ?? provenance?.extensionPath,
    severity: diagnostic.severity,
    message: diagnostic.message,
    code: diagnostic.code,
    name: diagnostic.name,
  }) as ExtensionContributionManifestResponse['diagnostics'] extends Array<infer T> | undefined ? T : never;
}

function findDiagnosticProvenance(diagnostic: NativeExtensionDiagnostic, registry: NativeExtensionRegistry): { extensionName: string; extensionPath: string } | undefined {
  if (diagnostic.path === undefined) return undefined;
  const extension = registry.extensions.find((entry) => entry.path === diagnostic.path);
  if (extension !== undefined) return { extensionName: extension.name, extensionPath: extension.path };
  const candidate = registry.candidates.find((entry) => entry.path === diagnostic.path);
  if (candidate !== undefined) return { extensionName: candidate.name, extensionPath: candidate.path };
  return undefined;
}

function belongsTo(reg: { extensionName: string; extensionPath: string }, extensionName: string, extensionPath: string): boolean {
  return reg.extensionName === extensionName && reg.extensionPath === extensionPath;
}

function sortById<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}
// --- eforge:endregion plan-02-engine-registry-runtime ---
