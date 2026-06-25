import type {
  ExtensionAvailabilityDiagnostic,
  ExtensionCapabilityAvailability,
  ExtensionDependencyAvailability,
  ExtensionDependencyLookupContext,
} from '@eforge-build/extension-sdk';

import type {
  ActionRegistration,
  AgentTaskRegistration,
  ConsoleContributionRegistration,
  ConsoleWorkstationRegistration,
  DeepLinkRegistration,
  IntegrationCommandRegistration,
  NativeExtensionCandidate,
  NativeExtensionContributionAvailability,
  NativeExtensionDependencyDeclaration,
  NativeExtensionDiagnostic,
  NativeExtensionRegistry,
  NativeExtensionResolvedDependency,
  NativeExtensionResolvedDependencyState,
} from './types.js';
import { resolveExtensionContributionId } from './ids.js';

// --- eforge:region dependency-resolution-versions ---
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
const CONSTRAINT_RE = /^(?<op>[<>]=?|=)?(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

export function isValidVersionConstraintSyntax(value: string): boolean {
  return value.split(',').map((part) => part.trim()).every((part) => CONSTRAINT_RE.test(part));
}

export function versionSatisfies(version: string | undefined, constraint: string | undefined): boolean {
  if (constraint === undefined) return true;
  if (version === undefined || !SEMVER_RE.test(version) || !isValidVersionConstraintSyntax(constraint)) return false;
  return constraint.split(',').map((part) => part.trim()).every((part) => satisfiesComparator(version, part));
}

function satisfiesComparator(version: string, comparator: string): boolean {
  const match = CONSTRAINT_RE.exec(comparator);
  if (!match?.groups) return false;
  const op = match.groups.op ?? '=';
  if (op === '=') return normalizeSemver(version) === normalizeSemver(match.groups.version);
  const comparison = compareSemver(version, match.groups.version);
  switch (op) {
    case '>': return comparison > 0;
    case '>=': return comparison >= 0;
    case '<': return comparison < 0;
    case '<=': return comparison <= 0;
    default: return false;
  }
}

function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (const index of [0, 1, 2] as const) {
    if (left.core[index] !== right.core[index]) return left.core[index] - right.core[index];
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function parseSemver(value: string): { core: [number, number, number]; prerelease: string[] } {
  const match = SEMVER_RE.exec(value);
  if (!match) return { core: [0, 0, 0], prerelease: [] };
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4]?.split('.') ?? [] };
}

function normalizeSemver(value: string): string {
  const match = SEMVER_RE.exec(value);
  if (!match) return value;
  const core = `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
  return `${core}${match[4] ? `-${match[4]}` : ''}${match[5] ? `+${match[5]}` : ''}`;
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const comparison = comparePrereleaseIdentifier(left, right);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function comparePrereleaseIdentifier(a: string, b: string): number {
  const leftNumeric = /^\d+$/.test(a);
  const rightNumeric = /^\d+$/.test(b);
  if (leftNumeric && rightNumeric) return Number(a) - Number(b);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
// --- eforge:endregion dependency-resolution-versions ---

// --- eforge:region dependency-resolution-graph ---
export function resolveExtensionDependencyGraph(candidates: NativeExtensionCandidate[]): {
  orderedCandidates: NativeExtensionCandidate[];
  diagnostics: NativeExtensionDiagnostic[];
} {
  const diagnostics: NativeExtensionDiagnostic[] = [];
  for (const candidate of candidates) {
    const state = resolveCandidateDependencies(candidate, candidates, false);
    candidate.resolvedDependencies = state;
    const candidateDiagnostics = [...state.required, ...state.optional].flatMap((entry) => entry.diagnostics);
    candidate.diagnostics.push(...candidateDiagnostics);
    diagnostics.push(...candidateDiagnostics);
    if (candidate.status === 'pending' && state.required.some((entry) => !entry.available)) {
      candidate.status = 'skipped';
    }
  }
  return { orderedCandidates: orderCandidatesByDependencies(candidates), diagnostics };
}

function resolveCandidateDependencies(
  candidate: NativeExtensionCandidate,
  candidates: NativeExtensionCandidate[],
  runtime: boolean,
): NativeExtensionResolvedDependencyState {
  const required = (candidate.dependencies?.required ?? []).map((dependency) => resolveDependency(candidate, dependency, 'required', candidates, runtime));
  const optional = (candidate.dependencies?.optional ?? []).map((dependency) => resolveDependency(candidate, dependency, 'optional', candidates, runtime));
  const diagnostics = [...required, ...optional].flatMap((entry) => entry.diagnostics);
  return { available: required.every((entry) => entry.available), required, optional, diagnostics };
}

function orderCandidatesByDependencies(candidates: NativeExtensionCandidate[]): NativeExtensionCandidate[] {
  const key = (candidate: NativeExtensionCandidate) => `${candidate.name}\0${candidate.path}`;
  const originalIndex = new Map(candidates.map((candidate, index) => [key(candidate), index]));
  const incoming = new Map(candidates.map((candidate) => [key(candidate), new Set<string>()]));
  const outgoing = new Map(candidates.map((candidate) => [key(candidate), new Set<string>()]));
  const byKey = new Map(candidates.map((candidate) => [key(candidate), candidate]));

  for (const candidate of candidates) {
    for (const entry of [...(candidate.resolvedDependencies?.required ?? []), ...(candidate.resolvedDependencies?.optional ?? [])]) {
      if (!entry.providerPath) continue;
      const providerKey = `${entry.providerName ?? entry.name}\0${entry.providerPath}`;
      if (!incoming.has(providerKey)) continue;
      incoming.get(key(candidate))?.add(providerKey);
      outgoing.get(providerKey)?.add(key(candidate));
    }
  }

  const ready = [...incoming.entries()]
    .filter(([, deps]) => deps.size === 0)
    .map(([candidateKey]) => candidateKey)
    .sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0));
  const ordered: NativeExtensionCandidate[] = [];
  const emitted = new Set<string>();

  while (ready.length > 0) {
    const candidateKey = ready.shift()!;
    if (emitted.has(candidateKey)) continue;
    emitted.add(candidateKey);
    const candidate = byKey.get(candidateKey);
    if (candidate) ordered.push(candidate);
    for (const dependentKey of outgoing.get(candidateKey) ?? []) {
      incoming.get(dependentKey)?.delete(candidateKey);
      if (incoming.get(dependentKey)?.size === 0) {
        ready.push(dependentKey);
        ready.sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0));
      }
    }
  }

  for (const candidate of candidates) if (!emitted.has(key(candidate))) ordered.push(candidate);
  return ordered;
}
// --- eforge:endregion dependency-resolution-graph ---

// --- eforge:region dependency-resolution-runtime ---
export function finalizeCandidateDependencyAvailability(
  candidate: NativeExtensionCandidate,
  registry: NativeExtensionRegistry,
  options: { requiredOnly?: boolean } = {},
): NativeExtensionDiagnostic[] {
  if (candidate.resolvedDependencies === undefined) return [];
  const candidates = registry.candidates.length > 0 ? registry.candidates : [candidate];
  const refreshed = resolveCandidateDependencies(candidate, candidates, true);
  if (options.requiredOnly) {
    refreshed.optional = candidate.resolvedDependencies.optional;
    refreshed.diagnostics = refreshed.required.flatMap((entry) => entry.diagnostics);
  }
  refreshed.available = refreshed.required.every((entry) => entry.available);
  const previousKeys = new Set(candidate.resolvedDependencies.diagnostics.map(diagnosticKey));
  candidate.resolvedDependencies = refreshed;
  return refreshed.diagnostics.filter((diagnostic) => !previousKeys.has(diagnosticKey(diagnostic)));
}

export function finalizeRegistryDependencyAvailability(registry: NativeExtensionRegistry): NativeExtensionDiagnostic[] {
  const diagnostics: NativeExtensionDiagnostic[] = [];
  for (const candidate of registry.candidates) {
    const next = finalizeCandidateDependencyAvailability(candidate, registry);
    candidate.diagnostics.push(...next);
    diagnostics.push(...next);
  }
  registry.diagnostics.push(...diagnostics);
  for (const extension of registry.extensions) {
    const candidate = findCandidate(registry.candidates, extension.name, extension.path);
    if (candidate?.resolvedDependencies !== undefined) extension.resolvedDependencies = candidate.resolvedDependencies;
  }
  applyContributionAvailability(registry);
  return diagnostics;
}

export function applyContributionAvailability(registry: NativeExtensionRegistry): void {
  for (const registration of contributionRegistrations(registry)) {
    registration.availability = evaluateContributionAvailability(registry, registration);
  }
}

export function isContributionAvailable(registration: { availability?: NativeExtensionContributionAvailability }): boolean {
  return registration.availability?.available !== false;
}
// --- eforge:endregion dependency-resolution-runtime ---

// --- eforge:region dependency-resolution-lookups ---
export function buildExtensionLookupContext(
  registry: NativeExtensionRegistry,
  extension: { extensionName: string; extensionPath: string },
): ExtensionDependencyLookupContext {
  const owner = findCandidate(registry.candidates, extension.extensionName, extension.extensionPath);
  const declared = owner?.resolvedDependencies;
  const dependencyList = [...(declared?.required ?? []), ...(declared?.optional ?? [])].map(projectDependencyAvailability);
  const capabilityList = buildCapabilityAvailabilityList(registry);

  const dependencies = Object.freeze({
    get(name: string): ExtensionDependencyAvailability {
      return freezeClone(dependencyList.find((entry) => entry.name === name || entry.providerName === name) ?? lookupDependencyByName(registry, name));
    },
    has(name: string): boolean {
      return dependencies.get(name).available;
    },
    list(): ExtensionDependencyAvailability[] {
      return freezeClone(dependencyList);
    },
  });

  const capabilities = Object.freeze({
    get(name: string, version?: string): ExtensionCapabilityAvailability {
      return freezeClone(lookupCapability(registry, name, version, capabilityList));
    },
    has(name: string, version?: string): boolean {
      return capabilities.get(name, version).available;
    },
    list(): ExtensionCapabilityAvailability[] {
      return freezeClone(capabilityList);
    },
  });

  return Object.freeze({ dependencies, capabilities });
}

function buildCapabilityAvailabilityList(registry: NativeExtensionRegistry): ExtensionCapabilityAvailability[] {
  const grouped = new Map<string, ExtensionCapabilityAvailability>();
  for (const extension of registry.extensions) {
    for (const capability of extension.capabilities ?? []) {
      const current = grouped.get(capability.name) ?? { name: capability.name, available: true, providers: [], diagnostics: [] };
      current.providers.push({ extensionName: extension.name, extensionPath: extension.path, ...(capability.version !== undefined && { version: capability.version }) });
      grouped.set(capability.name, current);
    }
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function lookupCapability(
  registry: NativeExtensionRegistry,
  name: string,
  version: string | undefined,
  precomputed: ExtensionCapabilityAvailability[],
): ExtensionCapabilityAvailability {
  const providers = registry.extensions.flatMap((extension) => (extension.capabilities ?? [])
    .filter((capability) => capability.name === name && versionSatisfies(capability.version, version))
    .map((capability) => ({ extensionName: extension.name, extensionPath: extension.path, ...(capability.version !== undefined && { version: capability.version }) })));
  if (providers.length > 0) return { name, ...(version !== undefined && { version }), available: true, providers, diagnostics: [] };
  const current = precomputed.find((entry) => entry.name === name);
  const message = current
    ? `Capability "${name}" is present but does not satisfy version constraint "${version}"`
    : `Capability "${name}" is unavailable`;
  return { name, ...(version !== undefined && { version }), available: false, providers: [], diagnostics: [{ code: 'extension:dependency-capability-incompatible', message, capabilityName: name, ...(version !== undefined && { requiredVersion: version }) }] };
}

function lookupDependencyByName(registry: NativeExtensionRegistry, name: string): ExtensionDependencyAvailability {
  const candidate = registry.candidates.find((entry) => entry.name === name);
  const loaded = registry.extensions.find((entry) => entry.name === name);
  if (loaded) return { name, providerName: loaded.name, providerVersion: providerVersion(loaded), available: true, capabilities: loaded.capabilities ?? [], diagnostics: [] };
  const message = candidate ? `Extension dependency "${name}" is ${candidate.status}` : `Extension dependency "${name}" is missing`;
  return { name, providerName: candidate?.name, providerVersion: candidate ? providerVersion(candidate) : undefined, available: false, capabilities: [], diagnostics: [{ code: 'extension:dependency-missing', message, dependencyName: name, providerName: candidate?.name }] };
}
// --- eforge:endregion dependency-resolution-lookups ---

// --- eforge:region dependency-resolution-core ---
function resolveDependency(
  owner: NativeExtensionCandidate,
  dependency: NativeExtensionDependencyDeclaration,
  kind: 'required' | 'optional',
  candidates: NativeExtensionCandidate[],
  runtime: boolean,
): NativeExtensionResolvedDependency {
  const selected = selectProvider(dependency, candidates, runtime);
  if (!selected.provider) return unavailableEntry(owner, dependency, kind, selected.code, selected.message, selected.shadowedProvider);
  const provider = selected.provider;
  const providerVer = providerVersion(provider);
  const base = baseEntry(dependency, kind, provider);

  if (dependency.version !== undefined && !versionSatisfies(providerVer, dependency.version)) {
    return { ...base, available: false, diagnostics: [diagnostic(owner, dependency, kind, 'extension:dependency-version-incompatible', `Dependency "${displayDependency(dependency)}" requires provider version "${dependency.version}" but "${provider.name}" exposes "${providerVer ?? 'unversioned'}"`, provider)] };
  }

  const missingCapability = (dependency.capabilities ?? []).find((requirement) => !candidateSatisfiesCapability(provider, requirement));
  if (missingCapability) {
    const actualCapabilityVersion = provider.capabilities?.find((capability) => capability.name === missingCapability.name)?.version;
    return { ...base, available: false, diagnostics: [diagnostic(owner, dependency, kind, 'extension:dependency-capability-incompatible', `Dependency "${displayDependency(dependency)}" requires capability "${missingCapability.name}"${missingCapability.version ? ` satisfying "${missingCapability.version}"` : ''} from "${provider.name}"`, provider, missingCapability.name, missingCapability.version, actualCapabilityVersion ?? null)] };
  }

  if (provider.status === 'shadowed') {
    return { ...base, available: false, diagnostics: [diagnostic(owner, dependency, kind, 'extension:dependency-shadowed', `Dependency "${displayDependency(dependency)}" is provided only by shadowed extension "${provider.name}"`, provider)] };
  }
  if (provider.trustState === 'untrusted') {
    return { ...base, available: false, diagnostics: [diagnostic(owner, dependency, kind, 'extension:dependency-untrusted', `Dependency "${displayDependency(dependency)}" is untrusted and cannot be loaded`, provider)] };
  }
  if (provider.trustState === 'changed') {
    return { ...base, available: false, diagnostics: [diagnostic(owner, dependency, kind, 'extension:dependency-changed', `Dependency "${displayDependency(dependency)}" has changed since it was trusted`, provider)] };
  }
  if (runtime && provider.status !== 'loaded') {
    return { ...base, available: false, diagnostics: [diagnostic(owner, dependency, kind, 'extension:dependency-error', `Dependency "${displayDependency(dependency)}" did not load successfully (status: ${provider.status})`, provider)] };
  }
  if (!runtime && provider.status === 'error') {
    return { ...base, available: false, diagnostics: [diagnostic(owner, dependency, kind, 'extension:dependency-error', `Dependency "${displayDependency(dependency)}" is not loadable`, provider)] };
  }
  return { ...base, available: true, diagnostics: [] };
}

function selectProvider(dependency: NativeExtensionDependencyDeclaration, candidates: NativeExtensionCandidate[], runtime: boolean): {
  provider?: NativeExtensionCandidate;
  shadowedProvider?: NativeExtensionCandidate;
  code: string;
  message: string;
} {
  const pool = dependency.name ? candidates.filter((candidate) => candidate.name === dependency.name) : candidates;
  const nonShadowed = pool.filter((candidate) => candidate.status !== 'shadowed');
  const compatible = nonShadowed.filter((candidate) => candidateMatchesDependency(candidate, dependency));
  const preferred = compatible.find((candidate) => candidateIsTrustedAndLoadable(candidate, runtime));
  if (preferred) return { provider: preferred, code: '', message: '' };
  if (compatible[0]) return { provider: compatible[0], code: '', message: '' };
  const shadowed = pool.filter((candidate) => candidate.status === 'shadowed').find((candidate) => candidateMatchesDependency(candidate, dependency));
  if (shadowed) return { shadowedProvider: shadowed, code: 'extension:dependency-shadowed', message: `Dependency "${displayDependency(dependency)}" is provided only by shadowed extension "${shadowed.name}"` };
  if (dependency.name && nonShadowed[0]) return { provider: nonShadowed[0], code: '', message: '' };
  const incompatibleCapabilityProvider = findProviderWithRequestedCapabilityName(dependency, nonShadowed, runtime);
  if (incompatibleCapabilityProvider) return { provider: incompatibleCapabilityProvider, code: '', message: '' };
  return { code: 'extension:dependency-missing', message: `Missing extension dependency "${displayDependency(dependency)}"` };
}

function candidateIsTrustedAndLoadable(candidate: NativeExtensionCandidate, runtime: boolean): boolean {
  if (candidate.trustState === 'untrusted' || candidate.trustState === 'changed') return false;
  if (runtime) return candidate.status === 'loaded';
  return candidate.status !== 'error';
}

function findProviderWithRequestedCapabilityName(
  dependency: NativeExtensionDependencyDeclaration,
  candidates: NativeExtensionCandidate[],
  runtime: boolean,
): NativeExtensionCandidate | undefined {
  if (dependency.name !== undefined || (dependency.capabilities?.length ?? 0) === 0) return undefined;
  const withCapabilityName = candidates.filter((candidate) => (dependency.capabilities ?? []).some((requirement) => candidate.capabilities?.some((capability) => capability.name === requirement.name)));
  return withCapabilityName.find((candidate) => candidateIsTrustedAndLoadable(candidate, runtime)) ?? withCapabilityName[0];
}

function candidateMatchesDependency(candidate: NativeExtensionCandidate, dependency: NativeExtensionDependencyDeclaration): boolean {
  if (dependency.name !== undefined && candidate.name !== dependency.name) return false;
  if (dependency.version !== undefined && !versionSatisfies(providerVersion(candidate), dependency.version)) return false;
  return (dependency.capabilities ?? []).every((requirement) => candidateSatisfiesCapability(candidate, requirement));
}

function candidateSatisfiesCapability(candidate: NativeExtensionCandidate, requirement: { name: string; version?: string }): boolean {
  return (candidate.capabilities ?? []).some((capability) => capability.name === requirement.name && versionSatisfies(capability.version, requirement.version));
}

function unavailableEntry(
  owner: NativeExtensionCandidate,
  dependency: NativeExtensionDependencyDeclaration,
  kind: 'required' | 'optional',
  code: string,
  message: string,
  shadowedProvider?: NativeExtensionCandidate,
): NativeExtensionResolvedDependency {
  return {
    kind,
    name: dependency.name,
    providerName: shadowedProvider?.name,
    providerPath: shadowedProvider?.path,
    requiredVersion: dependency.version,
    available: false,
    capabilities: dependency.capabilities ?? [],
    diagnostics: [diagnostic(owner, dependency, kind, code, message, shadowedProvider)],
  };
}

function baseEntry(
  dependency: NativeExtensionDependencyDeclaration,
  kind: 'required' | 'optional',
  provider: NativeExtensionCandidate,
): NativeExtensionResolvedDependency {
  return {
    kind,
    name: dependency.name,
    providerName: provider.name,
    providerPath: provider.path,
    providerVersion: providerVersion(provider),
    requiredVersion: dependency.version,
    available: false,
    capabilities: dependency.capabilities ?? [],
    diagnostics: [],
  };
}

function diagnostic(
  owner: NativeExtensionCandidate,
  dependency: NativeExtensionDependencyDeclaration,
  kind: 'required' | 'optional',
  code: string,
  message: string,
  provider?: NativeExtensionCandidate,
  capabilityName?: string,
  requiredVersion?: string,
  actualVersionOverride?: string | null,
): NativeExtensionDiagnostic {
  return {
    severity: kind === 'required' ? 'error' : 'warning',
    code,
    message,
    name: owner.name,
    path: owner.path,
    extensionName: owner.name,
    scope: owner.scope,
    source: owner.source,
    dependencyName: dependency.name,
    providerName: provider?.name,
    capabilityName,
    requiredVersion: requiredVersion ?? dependency.version,
    actualVersion: actualVersionOverride === null ? undefined : actualVersionOverride ?? (provider ? providerVersion(provider) : undefined),
    dependencyKind: kind,
    ...(provider?.currentHash !== undefined && { currentHash: provider.currentHash }),
    ...(provider?.trustedHash !== undefined && { trustedHash: provider.trustedHash }),
  };
}
// --- eforge:endregion dependency-resolution-core ---

// --- eforge:region dependency-resolution-contributions ---
type ContributionRegistration = ActionRegistration | AgentTaskRegistration | ConsoleContributionRegistration | ConsoleWorkstationRegistration | IntegrationCommandRegistration | DeepLinkRegistration;

function contributionRegistrations(registry: NativeExtensionRegistry): ContributionRegistration[] {
  return [
    ...registry.actions,
    ...registry.agentTasks,
    ...registry.consoleContributions,
    ...registry.consoleWorkstations,
    ...registry.integrationCommands,
    ...registry.deepLinks,
  ];
}

function evaluateContributionAvailability(registry: NativeExtensionRegistry, registration: ContributionRegistration): NativeExtensionContributionAvailability {
  const requirementsAvailability = evaluateOwnContributionAvailability(registry, registration);
  const actionAvailability = boundActionAvailability(registry, registration);
  return combineContributionAvailability(requirementsAvailability, actionAvailability);
}

function evaluateOwnContributionAvailability(registry: NativeExtensionRegistry, registration: ContributionRegistration): NativeExtensionContributionAvailability {
  const requirements = registration.requirements ?? registration.value.requirements;
  if (requirements === undefined) return { available: true };
  const owner = findCandidate(registry.candidates, registration.extensionName, registration.extensionPath) ?? ownerCandidate(registration);
  const diagnostics: NativeExtensionDiagnostic[] = [];
  for (const dependency of requirements.dependencies ?? []) {
    diagnostics.push(...resolveDependency(owner, dependency, 'optional', registry.candidates, true).diagnostics);
  }
  for (const capability of requirements.capabilities ?? []) {
    if (lookupCapability(registry, capability.name, capability.version, []).available) continue;
    diagnostics.push(diagnostic(owner, { capabilities: [capability] }, 'optional', 'extension:dependency-capability-incompatible', `Contribution "${registration.id}" requires unavailable capability "${capability.name}"${capability.version ? ` satisfying "${capability.version}"` : ''}`, undefined, capability.name, capability.version));
  }
  return diagnostics.length === 0
    ? { available: true }
    : { available: false, message: diagnostics[0]?.message ?? 'Contribution requirements are unavailable', diagnostics: diagnostics.map(projectAvailabilityDiagnostic) };
}

function boundActionAvailability(registry: NativeExtensionRegistry, registration: ContributionRegistration): NativeExtensionContributionAvailability | undefined {
  const actionId = registration.kind === 'integrationCommand' || registration.kind === 'deepLink' ? registration.value.action?.actionId : undefined;
  if (actionId === undefined) return undefined;
  const resolvedActionId = resolveExtensionContributionId(registration.extensionName, actionId);
  return registry.actions.find((action) => action.id === resolvedActionId)?.availability;
}

function combineContributionAvailability(
  primary: NativeExtensionContributionAvailability,
  secondary: NativeExtensionContributionAvailability | undefined,
): NativeExtensionContributionAvailability {
  if (primary.available === false || secondary?.available === false) {
    const diagnostics = [...(primary.diagnostics ?? []), ...(secondary?.diagnostics ?? [])];
    return {
      available: false,
      message: primary.available === false ? primary.message ?? secondary?.message : secondary?.message,
      ...(diagnostics.length > 0 && { diagnostics }),
    };
  }
  return primary;
}

function ownerCandidate(registration: ContributionRegistration): NativeExtensionCandidate {
  return {
    name: registration.extensionName,
    path: registration.extensionPath,
    scope: 'external',
    source: 'explicit',
    trust: 'trusted',
    trustState: 'not-required',
    status: 'loaded',
    shadows: [],
    diagnostics: [],
  };
}
// --- eforge:endregion dependency-resolution-contributions ---

// --- eforge:region dependency-resolution-utils ---
function providerVersion(provider: { packageProvenance?: { version?: string }; installProvenance?: { resolvedVersion?: string } }): string | undefined {
  return provider.packageProvenance?.version ?? provider.installProvenance?.resolvedVersion;
}

function findCandidate(candidates: NativeExtensionCandidate[], name: string, path: string): NativeExtensionCandidate | undefined {
  return candidates.find((candidate) => candidate.name === name && candidate.path === path);
}

function displayDependency(dependency: NativeExtensionDependencyDeclaration): string {
  return dependency.name ?? dependency.capabilities?.map((capability) => capability.name).join(', ') ?? '<capability>';
}

function diagnosticKey(diagnostic: NativeExtensionDiagnostic): string {
  return [diagnostic.code, diagnostic.name, diagnostic.path, diagnostic.providerName, diagnostic.capabilityName, diagnostic.requiredVersion].join('\0');
}

function projectDependencyAvailability(entry: NativeExtensionResolvedDependency): ExtensionDependencyAvailability {
  return {
    kind: entry.kind,
    name: entry.name,
    providerName: entry.providerName,
    providerVersion: entry.providerVersion,
    available: entry.available,
    capabilities: entry.capabilities.map((capability) => ({ ...capability })),
    diagnostics: entry.diagnostics.map(projectAvailabilityDiagnostic),
  };
}

function projectAvailabilityDiagnostic(diagnostic: NativeExtensionDiagnostic): ExtensionAvailabilityDiagnostic {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    dependencyName: diagnostic.dependencyName,
    providerName: diagnostic.providerName,
    capabilityName: diagnostic.capabilityName,
    requiredVersion: diagnostic.requiredVersion,
    actualVersion: diagnostic.actualVersion,
  };
}

function freezeClone<T>(value: T): T {
  return deepFreeze(JSON.parse(JSON.stringify(value)) as T);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
// --- eforge:endregion dependency-resolution-utils ---
