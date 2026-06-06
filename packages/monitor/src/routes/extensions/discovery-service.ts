import type { ExtensionDiagnostic, ExtensionEntry, ExtensionListResponse, ExtensionRegistrationSummary } from '@eforge-build/client';

export const EMPTY_EXTENSION_REGISTRATIONS: ExtensionRegistrationSummary = {
  eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0,
  prdEnrichers: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0,
  actions: 0, consoleContributions: 0, consoleWorkstations: 0, integrationCommands: 0, deepLinks: 0,
};

export function normalizeExtensionDiagnostic(diagnostic: unknown): ExtensionDiagnostic {
  const d = diagnostic as ExtensionDiagnostic;
  const result: ExtensionDiagnostic = { severity: d.severity, code: d.code, message: d.message };
  if (d.name !== undefined) result.name = d.name;
  if (d.path !== undefined) result.path = d.path;
  if (d.scope !== undefined) result.scope = d.scope;
  if (d.source !== undefined) result.source = d.source;
  if (d.currentHash !== undefined) result.currentHash = d.currentHash;
  if (d.trustedHash !== undefined) result.trustedHash = d.trustedHash;
  return result;
}

export function extensionEntryEnabled(status: ExtensionEntry['status'], globalEnabled: boolean): boolean {
  return globalEnabled && status !== 'shadowed' && status !== 'excluded';
}

export function selectExtensionByName(extensions: ExtensionEntry[], name: string): ExtensionEntry | undefined {
  const matches = extensions.filter((entry) => entry.name === name);
  return matches.find((entry) => entry.status === 'loaded') ?? matches.find((entry) => entry.status !== 'shadowed') ?? matches[0];
}

function candidateKey(candidate: any): string {
  return `${candidate.name}\0${candidate.path}`;
}

function addFilteredCandidates(filteredCandidates: any[], allCandidates: any[]): any[] {
  const existing = new Set(filteredCandidates.map(candidateKey));
  const excluded = allCandidates
    .filter((candidate) => !existing.has(candidateKey(candidate)))
    .map((candidate) => ({ ...candidate, status: 'excluded' }));
  return [...filteredCandidates, ...excluded];
}

function candidateToEntry(candidate: any, enabled: boolean, registrations?: ExtensionRegistrationSummary): ExtensionEntry {
  return {
    name: candidate.name,
    path: candidate.path,
    ...(candidate.entrypoint !== undefined && { entrypoint: candidate.entrypoint }),
    scope: candidate.scope as ExtensionEntry['scope'],
    source: candidate.source,
    status: candidate.status,
    enabled,
    trust: candidate.trust,
    ...(candidate.trustState !== undefined && { trustState: candidate.trustState as ExtensionEntry['trustState'] }),
    ...(candidate.currentHash !== undefined && { currentHash: candidate.currentHash }),
    ...(candidate.trustedHash !== undefined && { trustedHash: candidate.trustedHash }),
    ...(candidate.trustedAt !== undefined && { trustedAt: candidate.trustedAt }),
    ...(candidate.trustedBy !== undefined && { trustedBy: candidate.trustedBy }),
    ...(candidate.trustStorePath !== undefined && { trustStorePath: candidate.trustStorePath }),
    ...(candidate.format !== undefined && { format: candidate.format }),
    ...(candidate.layout !== undefined && { layout: candidate.layout }),
    shadows: candidate.shadows.map((shadow: any) => ({
      name: shadow.name, path: shadow.path,
      ...(shadow.entrypoint !== undefined && { entrypoint: shadow.entrypoint }),
      scope: shadow.scope,
      ...(shadow.format !== undefined && { format: shadow.format }),
      ...(shadow.layout !== undefined && { layout: shadow.layout }),
    })),
    registrations: registrations ?? { ...EMPTY_EXTENSION_REGISTRATIONS },
    diagnostics: candidate.diagnostics.map(normalizeExtensionDiagnostic),
    ...(candidate.packageProvenance !== undefined && { package: { ...candidate.packageProvenance } }),
    ...(candidate.installProvenance !== undefined && { install: { ...candidate.installProvenance } }),
  };
}

export async function loadExtensionResponse(cwd: string | undefined, opts: { path?: string; discoverOnly?: boolean } = {}): Promise<ExtensionListResponse> {
  if (!cwd) throw new Error('Working directory not configured');
  const { loadConfig, getConfigDir, getConventionalConfigDir } = await import('@eforge-build/engine/config');
  const { loadNativeExtensions, discoverNativeExtensions, projectExtensionRegistry } = await import('@eforge-build/engine/extensions/index');
  const { config, warnings } = await loadConfig(cwd);
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
  const configDir = await getConfigDir(cwd) ?? getConventionalConfigDir(cwd);
  const extensionConfig = opts.path ? {
    enabled: true,
    trustProjectExtensions: config.extensions.trustProjectExtensions,
    include: ['__eforge_no_auto_extensions__'],
    paths: [opts.path],
  } : config.extensions;
  if (opts.discoverOnly || (!opts.path && !config.extensions.enabled)) {
    const discoveryConfig = opts.path ? extensionConfig : { ...config.extensions, enabled: true };
    const discovery = await discoverNativeExtensions({ cwd, configDir, config: discoveryConfig });
    const allDiscovery = opts.path ? discovery : await discoverNativeExtensions({ cwd, configDir, config: { ...discoveryConfig, include: undefined, exclude: undefined } });
    const candidates = addFilteredCandidates(discovery.candidates, allDiscovery.candidates);
    const extensions = candidates.map((candidate: any) => candidateToEntry(candidate, opts.discoverOnly ? extensionEntryEnabled(candidate.status, extensionConfig.enabled) : false));
    extensions.sort((a: ExtensionEntry, b: ExtensionEntry) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
    return { extensions, diagnostics: discovery.diagnostics.map(normalizeExtensionDiagnostic), totals: { ...EMPTY_EXTENSION_REGISTRATIONS } };
  }
  const loadResult = await loadNativeExtensions({ cwd, configDir, config: extensionConfig });
  const projection = projectExtensionRegistry(loadResult.registry);
  const loadedByKey = new Map(projection.extensions.map((extension: any) => [`${extension.name}\0${extension.path}`, extension]));
  const allDiscovery = opts.path ? undefined : await discoverNativeExtensions({ cwd, configDir, config: { ...extensionConfig, include: undefined, exclude: undefined } });
  const candidates = allDiscovery ? addFilteredCandidates(loadResult.candidates, allDiscovery.candidates) : loadResult.candidates;
  const extensions: ExtensionEntry[] = candidates.map((candidate: any) => {
    const loaded = loadedByKey.get(`${candidate.name}\0${candidate.path}`) as any;
    return { ...candidateToEntry(candidate, extensionEntryEnabled(candidate.status, extensionConfig.enabled), loaded?.registrations),
      ...(loaded?.strategy !== undefined && { strategy: loaded.strategy }),
      ...(loaded?.reviewerPerspectiveDetails !== undefined && { reviewerPerspectiveDetails: loaded.reviewerPerspectiveDetails }),
      ...(loaded?.validationProviderDetails !== undefined && { validationProviderDetails: loaded.validationProviderDetails }),
      ...(loaded?.actionDetails !== undefined && { actionDetails: loaded.actionDetails }),
      ...(loaded?.consoleContributionDetails !== undefined && { consoleContributionDetails: loaded.consoleContributionDetails }),
      ...(loaded?.consoleWorkstationDetails !== undefined && { consoleWorkstationDetails: loaded.consoleWorkstationDetails }),
      ...(loaded?.integrationCommandDetails !== undefined && { integrationCommandDetails: loaded.integrationCommandDetails }),
      ...(loaded?.deepLinkDetails !== undefined && { deepLinkDetails: loaded.deepLinkDetails }),
    };
  });
  extensions.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return { extensions, diagnostics: loadResult.diagnostics.map(normalizeExtensionDiagnostic), totals: projection.totals as ExtensionRegistrationSummary };
}
