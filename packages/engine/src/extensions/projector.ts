import type { ConsoleContributionDetail, ExtensionActionDetail, ExtensionDeepLinkDetail, IntegrationCommandDetail, ReviewerPerspectiveDetail, ReviewerPerspectiveApplicabilitySummary, ValidationProviderDetail } from '@eforge-build/client';
import { buildActionDetails, buildConsoleContributionDetails, buildDeepLinkDetails, buildIntegrationCommandDetails } from './manifest.js';
import type { NativeExtensionCandidate, NativeExtensionDiagnostic, NativeExtensionInstallProvenance, NativeExtensionPackageProvenance, NativeExtensionRegistry } from './types.js';

export interface NativeExtensionRegistryProjection {
  extensions: Array<{
    name: string;
    path: string;
    entrypoint: string;
    scope: string;
    source: string;
    strategy: string;
    registrations: Record<string, number>;
    reviewerPerspectiveDetails?: ReviewerPerspectiveDetail[];
    validationProviderDetails?: ValidationProviderDetail[];
    actionDetails?: ExtensionActionDetail[];
    consoleContributionDetails?: ConsoleContributionDetail[];
    integrationCommandDetails?: IntegrationCommandDetail[];
    deepLinkDetails?: ExtensionDeepLinkDetail[];
    packageProvenance?: NativeExtensionPackageProvenance;
    installProvenance?: NativeExtensionInstallProvenance;
  }>;
  candidates: Array<{
    name: string;
    path: string;
    entrypoint?: string;
    scope: string;
    source: string;
    trust: string;
    trustState?: string;
    currentHash?: string;
    trustedHash?: string;
    trustedAt?: string;
    trustedBy?: string;
    trustStorePath?: string;
    status: string;
    shadows: Array<{ name: string; path: string; scope: string; entrypoint?: string }>;
    packageProvenance?: NativeExtensionPackageProvenance;
    installProvenance?: NativeExtensionInstallProvenance;
  }>;
  diagnostics: NativeExtensionDiagnostic[];
  totals: {
    eventHooks: number;
    agentRunHooks: number;
    policyGates: number;
    profileRouters: number;
    inputSources: number;
    reviewerPerspectives: number;
    validationProviders: number;
    tools: number;
    prdEnrichers: number;
    actions: number;
    consoleContributions: number;
    integrationCommands: number;
    deepLinks: number;
  };
}

function buildApplicabilitySummary(appliesTo: {
  fileGlobs?: string[];
  paths?: string[];
  extensions?: string[];
  categories?: string[];
  minChangedFiles?: number;
  minChangedLines?: number;
  fn?: unknown;
} | undefined): ReviewerPerspectiveApplicabilitySummary | undefined {
  if (!appliesTo) return undefined;
  const summary: ReviewerPerspectiveApplicabilitySummary = {};
  if (appliesTo.fileGlobs?.length) summary.fileGlobs = [...appliesTo.fileGlobs];
  if (appliesTo.paths?.length) summary.paths = [...appliesTo.paths];
  if (appliesTo.extensions?.length) summary.extensions = [...appliesTo.extensions];
  if (appliesTo.categories?.length) summary.categories = [...appliesTo.categories] as ReviewerPerspectiveApplicabilitySummary['categories'];
  if (appliesTo.minChangedFiles !== undefined) summary.minChangedFiles = appliesTo.minChangedFiles;
  if (appliesTo.minChangedLines !== undefined) summary.minChangedLines = appliesTo.minChangedLines;
  if (typeof appliesTo.fn === 'function') summary.hasFn = true;
  if (Object.keys(summary).length === 0) return undefined;
  return summary;
}

function buildReviewerPerspectiveDetails(
  registry: NativeExtensionRegistry,
  extensionName: string,
  extensionPath: string,
): ReviewerPerspectiveDetail[] | undefined {
  const details = registry.reviewerPerspectives
    .filter((reg) => reg.extensionName === extensionName && reg.extensionPath === extensionPath)
    .map((reg): ReviewerPerspectiveDetail => ({
      key: reg.value.key,
      label: reg.value.label,
      description: reg.value.description,
      extensionName: reg.extensionName,
      extensionPath: reg.extensionPath,
      ...(reg.value.appliesTo !== undefined && {
        applicability: buildApplicabilitySummary(reg.value.appliesTo),
      }),
    }));
  return details.length > 0 ? details : undefined;
}

function buildValidationProviderDetails(
  registry: NativeExtensionRegistry,
  extensionName: string,
  extensionPath: string,
): ValidationProviderDetail[] | undefined {
  const details = registry.validationProviders
    .filter((reg) => reg.extensionName === extensionName && reg.extensionPath === extensionPath)
    .map((reg): ValidationProviderDetail => {
      const kind: 'function' | 'commands' = reg.value.commands ? 'commands' : 'function';
      return {
        name: reg.value.name,
        description: reg.value.description,
        kind,
        ...(kind === 'commands' && reg.value.commands !== undefined
          ? { commandCount: reg.value.commands.length }
          : {}),
        extensionName: reg.extensionName,
        extensionPath: reg.extensionPath,
      };
    });
  return details.length > 0 ? details : undefined;
}

export function projectExtensionRegistry(registry: NativeExtensionRegistry): NativeExtensionRegistryProjection {
  return {
    extensions: registry.extensions.map((extension) => {
      const reviewerPerspectiveDetails = buildReviewerPerspectiveDetails(registry, extension.name, extension.path);
      const validationProviderDetails = buildValidationProviderDetails(registry, extension.name, extension.path);
      const actionDetails = buildActionDetails(registry, extension.name, extension.path);
      const consoleContributionDetails = buildConsoleContributionDetails(registry, extension.name, extension.path);
      const integrationCommandDetails = buildIntegrationCommandDetails(registry, extension.name, extension.path);
      const deepLinkDetails = buildDeepLinkDetails(registry, extension.name, extension.path);
      return {
        name: extension.name,
        path: extension.path,
        entrypoint: extension.entrypoint,
        scope: extension.scope,
        source: extension.source,
        strategy: extension.strategy,
        registrations: { ...extension.registrations },
        ...(reviewerPerspectiveDetails !== undefined && { reviewerPerspectiveDetails }),
        ...(validationProviderDetails !== undefined && { validationProviderDetails }),
        ...(actionDetails !== undefined && { actionDetails }),
        ...(consoleContributionDetails !== undefined && { consoleContributionDetails }),
        ...(integrationCommandDetails !== undefined && { integrationCommandDetails }),
        ...(deepLinkDetails !== undefined && { deepLinkDetails }),
        ...(extension.packageProvenance !== undefined && { packageProvenance: { ...extension.packageProvenance } }),
        ...(extension.installProvenance !== undefined && { installProvenance: { ...extension.installProvenance } }),
      };
    }),
    candidates: registry.candidates.map(projectExtensionCandidate),
    diagnostics: registry.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    totals: {
      eventHooks: registry.eventHooks.length,
      agentRunHooks: registry.agentRunHooks.length,
      policyGates: registry.policyGates.length,
      profileRouters: registry.profileRouters.length,
      inputSources: registry.inputSources.length,
      reviewerPerspectives: registry.reviewerPerspectives.length,
      validationProviders: registry.validationProviders.length,
      tools: registry.tools.length,
      prdEnrichers: registry.prdEnrichers.length,
      actions: registry.actions.length,
      consoleContributions: registry.consoleContributions.length,
      integrationCommands: registry.integrationCommands.length,
      deepLinks: registry.deepLinks.length,
    },
  };
}

function projectExtensionCandidate(candidate: NativeExtensionCandidate): NativeExtensionRegistryProjection['candidates'][number] {
  return {
    name: candidate.name,
    path: candidate.path,
    entrypoint: candidate.entrypoint,
    scope: candidate.scope,
    source: candidate.source,
    trust: candidate.trust,
    ...(candidate.trustState !== undefined && { trustState: candidate.trustState }),
    ...(candidate.currentHash !== undefined && { currentHash: candidate.currentHash }),
    ...(candidate.trustedHash !== undefined && { trustedHash: candidate.trustedHash }),
    ...(candidate.trustedAt !== undefined && { trustedAt: candidate.trustedAt }),
    ...(candidate.trustedBy !== undefined && { trustedBy: candidate.trustedBy }),
    ...(candidate.trustStorePath !== undefined && { trustStorePath: candidate.trustStorePath }),
    status: candidate.status,
    shadows: candidate.shadows.map((shadow) => ({
      name: shadow.name,
      path: shadow.path,
      scope: shadow.scope,
      entrypoint: shadow.entrypoint,
    })),
    ...(candidate.packageProvenance !== undefined && { packageProvenance: { ...candidate.packageProvenance } }),
    ...(candidate.installProvenance !== undefined && { installProvenance: { ...candidate.installProvenance } }),
  };
}
