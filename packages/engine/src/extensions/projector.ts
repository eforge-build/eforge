import type { ReviewerPerspectiveDetail, ReviewerPerspectiveApplicabilitySummary } from '@eforge-build/client';
import type { NativeExtensionCandidate, NativeExtensionDiagnostic, NativeExtensionRegistry } from './types.js';

export interface NativeExtensionRegistryProjection {
  extensions: Array<{
    name: string;
    path: string;
    entrypoint: string;
    scope: string;
    source: string;
    strategy: string;
    registrations: Record<string, number>;
    // --- eforge:region plan-03-observability-docs-examples ---
    reviewerPerspectiveDetails?: ReviewerPerspectiveDetail[];
    // --- eforge:endregion plan-03-observability-docs-examples ---
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
  };
}

// --- eforge:region plan-03-observability-docs-examples ---
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
// --- eforge:endregion plan-03-observability-docs-examples ---

export function projectExtensionRegistry(registry: NativeExtensionRegistry): NativeExtensionRegistryProjection {
  return {
    extensions: registry.extensions.map((extension) => {
      // --- eforge:region plan-03-observability-docs-examples ---
      const reviewerPerspectiveDetails = buildReviewerPerspectiveDetails(registry, extension.name, extension.path);
      // --- eforge:endregion plan-03-observability-docs-examples ---
      return {
        name: extension.name,
        path: extension.path,
        entrypoint: extension.entrypoint,
        scope: extension.scope,
        source: extension.source,
        strategy: extension.strategy,
        registrations: { ...extension.registrations },
        // --- eforge:region plan-03-observability-docs-examples ---
        ...(reviewerPerspectiveDetails !== undefined && { reviewerPerspectiveDetails }),
        // --- eforge:endregion plan-03-observability-docs-examples ---
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
  };
}
