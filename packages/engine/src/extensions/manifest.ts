import type {
  ConsoleContributionBlock,
  ConsoleContributionDetail,
  ConsoleContributionManifestEntry,
  ConsoleWorkstationDetail,
  ConsoleWorkstationManifestEntry,
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
import { applyContributionAvailability } from './dependency-resolution.js';
import { resolveExtensionContributionId } from './ids.js';
import { buildConsoleWorkstationFrameBundleManifest, ConsoleWorkstationAssetCatalogError } from './workstation-assets.js';
import type {
  ConsoleContributionBlockSpec,
  ConsoleContributionRegistration,
  ConsoleWorkstationRegistration,
  DeepLinkRegistration,
  ExtensionActionBindingSpec,
  ActionRegistration,
  IntegrationCommandRegistration,
  NativeExtensionDiagnostic,
  NativeExtensionRegistry,
} from './types.js';

export function buildExtensionContributionManifest(registry: NativeExtensionRegistry): ExtensionContributionManifestResponse {
  applyContributionAvailability(registry);
  const projectionDiagnostics: NativeExtensionDiagnostic[] = [];
  const manifest = {
    schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION as 1,
    generatedAt: new Date().toISOString(),
    actions: registry.actions.map(buildActionManifestEntry).sort(sortById),
    consoleContributions: registry.consoleContributions.map(buildConsoleContributionManifestEntry).sort(sortById),
    consoleWorkstations: collectConsoleWorkstationManifestEntries(registry, projectionDiagnostics).sort(sortById),
    integrationCommands: registry.integrationCommands.map(buildIntegrationCommandManifestEntry).sort(sortById),
    deepLinks: registry.deepLinks.map(buildDeepLinkManifestEntry).sort(sortById),
    diagnostics: [...registry.diagnostics, ...projectionDiagnostics].map((diagnostic) => projectDiagnostic(diagnostic, registry)),
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
    outputProfile: reg.value.outputProfile,
    sideEffects: reg.value.sideEffects === undefined ? undefined : [...reg.value.sideEffects],
    requirements: projectRequirements(reg.requirements ?? reg.value.requirements),
    availability: projectAvailability(reg.availability),
  }) as unknown as ExtensionActionManifestEntry;
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
    requirements: projectRequirements(reg.requirements ?? reg.value.requirements),
    availability: projectAvailability(reg.availability),
    blocks: reg.value.blocks.map((block) => projectBlock(block, reg.extensionName)),
  }) as ConsoleContributionManifestEntry;
}

export function buildConsoleWorkstationManifestEntry(reg: ConsoleWorkstationRegistration, registry: NativeExtensionRegistry): ConsoleWorkstationManifestEntry {
  const base = {
    id: reg.id,
    localId: reg.localId,
    extensionName: reg.extensionName,
    extensionPath: reg.extensionPath,
    title: reg.value.title,
    description: reg.value.description,
    schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION as 1,
    requirements: projectRequirements(reg.requirements ?? reg.value.requirements),
    availability: projectAvailability(reg.availability),
    subviews: projectWorkstationSubviews(reg.value.subviews),
    allowedActions: projectAllowedActions(reg, registry),
  };
  if (reg.value.frameBundle !== undefined) {
    return omitUndefined({ ...base, frameBundle: buildConsoleWorkstationFrameBundleManifest(reg) }) as ConsoleWorkstationManifestEntry;
  }
  return omitUndefined({ ...base, srcDoc: reg.value.srcDoc }) as ConsoleWorkstationManifestEntry;
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
    requirements: projectRequirements(reg.requirements ?? reg.value.requirements),
    availability: projectAvailability(reg.availability),
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
    requirements: projectRequirements(reg.requirements ?? reg.value.requirements),
    availability: projectAvailability(reg.availability),
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

export function buildConsoleWorkstationDetails(registry: NativeExtensionRegistry, extensionName: string, extensionPath: string): ConsoleWorkstationDetail[] | undefined {
  const diagnostics: NativeExtensionDiagnostic[] = [];
  const details = collectConsoleWorkstationManifestEntries({ ...registry, consoleWorkstations: registry.consoleWorkstations.filter((reg) => belongsTo(reg, extensionName, extensionPath)) }, diagnostics);
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

function projectRequirements(requirements: unknown): unknown {
  return requirements === undefined ? undefined : jsonSafeClone(requirements);
}

function projectAvailability(availability: unknown): unknown {
  return availability === undefined ? undefined : jsonSafeClone(availability);
}

function projectWorkstationSubviews(subviews: unknown): unknown {
  return subviews === undefined ? undefined : jsonSafeClone(subviews);
}

function projectBlock(block: ConsoleContributionBlockSpec, extensionName: string): ConsoleContributionBlock {
  const base = { ...block } as Record<string, unknown>;
  if ('action' in block) base.action = projectBinding(block.action, extensionName);
  return omitUndefined(jsonSafeClone(base)) as ConsoleContributionBlock;
}

function collectConsoleWorkstationManifestEntries(registry: NativeExtensionRegistry, diagnostics: NativeExtensionDiagnostic[]): ConsoleWorkstationManifestEntry[] {
  return registry.consoleWorkstations.flatMap((reg) => {
    try {
      return [buildConsoleWorkstationManifestEntry(reg, registry)];
    } catch (err) {
      if (err instanceof ConsoleWorkstationAssetCatalogError) {
        diagnostics.push({
          severity: 'error',
          code: 'extension:invalid-workstation-bundle',
          name: reg.id,
          path: reg.extensionPath,
          extensionName: reg.extensionName,
          message: `registerConsoleWorkstation frameBundle is invalid: ${err.message}`,
        });
        return [];
      }
      throw err;
    }
  });
}

function projectAllowedActions(reg: ConsoleWorkstationRegistration, registry: NativeExtensionRegistry): string[] {
  const localActionIds = reg.value.allowedActions ?? registry.actions.filter((action) => belongsTo(action, reg.extensionName, reg.extensionPath)).map((action) => action.localId);
  return [...new Set(localActionIds.map((actionId) => resolveExtensionContributionId(reg.extensionName, actionId)))].sort();
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
    dependencyName: diagnostic.dependencyName,
    providerName: diagnostic.providerName,
    capabilityName: diagnostic.capabilityName,
    requiredVersion: diagnostic.requiredVersion,
    actualVersion: diagnostic.actualVersion,
    dependencyKind: diagnostic.dependencyKind,
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
