import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';

import { SCOPES, getScopeDirectory, type Scope, type ScopeResolverOpts } from '@eforge-build/scopes';

import { hashExtensionDirectory, hashExtensionFile } from './hash.js';
import { readInstallSidecar, type InstallSidecarData } from './install-metadata.js';
import { parsePackageManifest, type ExtensionPackageMetadata } from './package-manifest.js';
import { getTrustRecord, getTrustStorePath, readTrustStore, type ExtensionTrustStore } from './trust-store.js';
import type {
  NativeExtensionCandidate,
  NativeExtensionDiagnostic,
  NativeExtensionDiscoveryResult,
  NativeExtensionFormat,
  NativeExtensionInstallProvenance,
  NativeExtensionLayout,
  NativeExtensionPackageProvenance,
  NativeExtensionScope,
  NativeExtensionCapabilityDeclaration,
  NativeExtensionDependencyManifest,
  NativeExtensionShadow,
  NativeExtensionTrust,
  NativeExtensionTrustState,
} from './types.js';

const EXTENSION_DIR = 'extensions';
const SUPPORTED_EXTENSIONS = new Set(['.ts', '.mts', '.js', '.mjs']);
const ENTRYPOINT_NAMES = ['index.ts', 'index.mts', 'index.js', 'index.mjs'];
const PRECEDENCE: readonly Scope[] = [...SCOPES].reverse();

interface ResolvedLayout {
  name: string;
  path: string;
  entrypoint: string;
  format: NativeExtensionFormat;
  layout: NativeExtensionLayout;
  packageProvenance?: NativeExtensionPackageProvenance;
  installProvenance?: NativeExtensionInstallProvenance;
  capabilities?: NativeExtensionCapabilityDeclaration[];
  dependencies?: NativeExtensionDependencyManifest;
}

interface RawAutoCandidate extends ResolvedLayout {
  scope: Scope;
  status?: NativeExtensionCandidate['status'];
  diagnostics?: NativeExtensionDiagnostic[];
}

export async function discoverNativeExtensions(options: {
  cwd: string;
  configDir: string;
  config: {
    enabled: boolean;
    include?: string[];
    exclude?: string[];
    paths?: string[];
  };
}): Promise<NativeExtensionDiscoveryResult> {
  const diagnostics: NativeExtensionDiagnostic[] = [];
  if (!options.config.enabled) return { candidates: [], diagnostics };

  const scopeOpts: ScopeResolverOpts = { cwd: options.cwd, configDir: options.configDir };

  // Read the trust store once for the entire discovery call.
  const eforgeDir = resolve(options.cwd, '.eforge');
  const trustStorePath = getTrustStorePath(eforgeDir);
  const trustStore = await readTrustStore(eforgeDir);

  const autoCandidates: RawAutoCandidate[] = [];
  const shadowedCandidates: NativeExtensionCandidate[] = [];

  for (const scope of PRECEDENCE) {
    const scopeDir = getScopeDirectory(scope, scopeOpts);
    const extensionsDir = resolve(scopeDir, EXTENSION_DIR);
    for (const entry of await readDirectoryEntries(extensionsDir)) {
      const entryPath = resolve(extensionsDir, entry);
      const layoutResult = await resolveExtensionLayoutFull(entryPath);
      // Surface any manifest-level diagnostics from the layout resolution.
      diagnostics.push(...layoutResult.diagnostics);
      if (!layoutResult.layout) {
        if (!layoutResult.invalidManifest) {
          // Suppress the generic "unsupported-layout" warning when we already emitted a manifest error.
          diagnostics.push({
            severity: 'warning',
            code: 'extension:unsupported-layout',
            message: `Skipping unsupported extension layout at ${entryPath}`,
            path: entryPath,
            scope,
            source: 'auto',
          });
        }
        continue;
      }
      if (!passesAutoFilters(layoutResult.layout.name, options.config.include, options.config.exclude)) continue;
      const hasManifestError = layoutResult.diagnostics.some((diagnostic) => diagnostic.code === 'extension:invalid-package-manifest');
      autoCandidates.push({
        ...layoutResult.layout,
        scope,
        ...(hasManifestError && { status: 'error' as const, diagnostics: layoutResult.diagnostics }),
      });
    }
  }

  const winners: NativeExtensionCandidate[] = [];
  const byName = new Map<string, RawAutoCandidate[]>();
  for (const candidate of autoCandidates) {
    const entries = byName.get(candidate.name) ?? [];
    entries.push(candidate);
    byName.set(candidate.name, entries);
  }

  for (const [name, entries] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    entries.sort((a, b) => PRECEDENCE.indexOf(a.scope) - PRECEDENCE.indexOf(b.scope));
    const [winner, ...shadows] = entries;
    const shadowEntries: NativeExtensionShadow[] = shadows.map((shadow) => ({
      name: shadow.name,
      path: shadow.path,
      entrypoint: shadow.entrypoint,
      scope: shadow.scope,
      format: shadow.format,
      layout: shadow.layout,
    }));
    const winnerTrust = initialTrustForScope(winner.scope);
    winners.push({
      name,
      path: winner.path,
      entrypoint: winner.entrypoint,
      scope: winner.scope,
      source: 'auto',
      format: winner.format,
      layout: winner.layout,
      trust: winnerTrust,
      status: winner.status ?? 'pending',
      shadows: shadowEntries,
      diagnostics: winner.diagnostics ?? [],
      ...(winner.packageProvenance !== undefined && { packageProvenance: winner.packageProvenance }),
      ...(winner.installProvenance !== undefined && { installProvenance: winner.installProvenance }),
      ...(winner.capabilities !== undefined && { capabilities: winner.capabilities }), ...(winner.dependencies !== undefined && { dependencies: winner.dependencies }),
    });
    for (const shadow of shadows) {
      const shadowTrust = initialTrustForScope(shadow.scope);
      shadowedCandidates.push({
        name: shadow.name,
        path: shadow.path,
        entrypoint: shadow.entrypoint,
        scope: shadow.scope,
        source: 'auto',
        format: shadow.format,
        layout: shadow.layout,
        trust: shadowTrust,
        status: shadow.status ?? 'shadowed',
        shadows: [],
        diagnostics: shadow.diagnostics ?? [],
        ...(shadow.packageProvenance !== undefined && { packageProvenance: shadow.packageProvenance }),
        ...(shadow.installProvenance !== undefined && { installProvenance: shadow.installProvenance }),
        ...(shadow.capabilities !== undefined && { capabilities: shadow.capabilities }), ...(shadow.dependencies !== undefined && { dependencies: shadow.dependencies }),
      });
    }
  }

  const explicitCandidates: NativeExtensionCandidate[] = [];
  const autoWinnerNames = new Set(winners.map((candidate) => candidate.name));
  const explicitByName = new Map<string, NativeExtensionCandidate[]>();
  for (const configuredPath of options.config.paths ?? []) {
    const absolutePath = isAbsolute(configuredPath) ? configuredPath : resolve(options.cwd, configuredPath);
    const layoutResult = await resolveExtensionLayoutFull(absolutePath);
    diagnostics.push(...layoutResult.diagnostics);
    const layout = layoutResult.layout;
    if (!layout) {
      const diagnostic: NativeExtensionDiagnostic = {
        severity: 'error',
        code: 'extension:unsupported-explicit-layout',
        message: `Explicit extension path is not a supported extension module: ${absolutePath}`,
        path: absolutePath,
        source: 'explicit',
      };
      diagnostics.push(diagnostic);
      const explicitScope = scopeForPath(absolutePath, scopeOpts);
      explicitCandidates.push({
        name: basenameWithoutKnownExtension(absolutePath),
        path: absolutePath,
        scope: explicitScope,
        source: 'explicit',
        trust: initialTrustForScope(explicitScope),
        status: 'error',
        shadows: [],
        diagnostics: [...layoutResult.diagnostics, diagnostic],
      });
      continue;
    }
    const scope = scopeForPath(layout.path, scopeOpts);
    const candidate: NativeExtensionCandidate = {
      name: layout.name,
      path: layout.path,
      entrypoint: layout.entrypoint,
      scope,
      source: 'explicit',
      format: layout.format,
      layout: layout.layout,
      trust: initialTrustForScope(scope),
      status: layoutResult.diagnostics.some((diagnostic) => diagnostic.code === 'extension:invalid-package-manifest') ? 'error' : 'pending',
      shadows: [],
      diagnostics: [...layoutResult.diagnostics],
      ...(layout.packageProvenance !== undefined && { packageProvenance: layout.packageProvenance }),
      ...(layout.installProvenance !== undefined && { installProvenance: layout.installProvenance }),
      ...(layout.capabilities !== undefined && { capabilities: layout.capabilities }), ...(layout.dependencies !== undefined && { dependencies: layout.dependencies }),
    };
    explicitCandidates.push(candidate);
    const sameName = explicitByName.get(candidate.name) ?? [];
    sameName.push(candidate);
    explicitByName.set(candidate.name, sameName);
  }

  for (const [name, candidates] of explicitByName.entries()) {
    if (candidates.length > 1 || autoWinnerNames.has(name)) {
      const message = autoWinnerNames.has(name)
        ? `Explicit extension "${name}" collides with an auto-discovered extension`
        : `Duplicate explicit extension name "${name}"`;
      for (const candidate of candidates) {
        const diagnostic: NativeExtensionDiagnostic = {
          severity: 'error',
          code: 'extension:duplicate-explicit-name',
          message,
          name,
          path: candidate.path,
          scope: candidate.scope,
          source: 'explicit',
        };
        candidate.status = 'error';
        candidate.diagnostics.push(diagnostic);
        diagnostics.push(diagnostic);
      }
    }
  }

  // Enrich all candidates with trust state and hash metadata.
  const allCandidates = [...winners, ...shadowedCandidates, ...explicitCandidates];
  await rejectEscapingProjectTeamCandidates(allCandidates, scopeOpts, diagnostics);
  await enrichCandidatesWithTrust(allCandidates, trustStore, trustStorePath);

  return {
    candidates: allCandidates,
    diagnostics,
  };
}

async function rejectEscapingProjectTeamCandidates(
  candidates: NativeExtensionCandidate[],
  opts: ScopeResolverOpts,
  diagnostics: NativeExtensionDiagnostic[],
): Promise<void> {
  for (const candidate of candidates) {
    if (candidate.scope !== 'project-team') continue;
    if (await isProjectTeamPathInsideRealScope(candidate.path, opts)) continue;
    const diagnostic: NativeExtensionDiagnostic = {
      severity: 'error',
      code: 'extension:project-team-path-escape',
      message: 'Project-team extension path must resolve within eforge/extensions/ without symlink escape',
      name: candidate.name,
      path: candidate.path,
      scope: candidate.scope,
      source: candidate.source,
    };
    candidate.status = 'error';
    candidate.diagnostics.push(diagnostic);
    diagnostics.push(diagnostic);
  }
}

async function isProjectTeamPathInsideRealScope(path: string, opts: ScopeResolverOpts): Promise<boolean> {
  const extensionsDir = resolve(getScopeDirectory('project-team', opts), EXTENSION_DIR);
  if (!isPathInside(path, extensionsDir)) return false;
  try {
    const dirInfo = await lstat(extensionsDir);
    if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) return false;
    const [realExtensionsDir, realCandidatePath] = await Promise.all([
      realpath(extensionsDir),
      realpath(path),
    ]);
    return isPathInside(realCandidatePath, realExtensionsDir);
  } catch {
    return false;
  }
}

/**
 * Post-process candidates to assign trustState, trust, and hash metadata.
 *
 * - Project-team candidates: compute content hash, look up trust record, classify state.
 * - All other candidates (user, project-local, external): trustState = 'not-required', trust = 'trusted'.
 */
async function enrichCandidatesWithTrust(
  candidates: NativeExtensionCandidate[],
  trustStore: ExtensionTrustStore,
  trustStorePath: string,
): Promise<void> {
  for (const candidate of candidates) {
    if (candidate.scope !== 'project-team') {
      candidate.trustState = 'not-required';
      candidate.trust = 'trusted';
      continue;
    }

    // Compute content hash for the extension.
    let hash: string | undefined;
    try {
      if (candidate.layout === 'directory') {
        hash = await hashExtensionDirectory(candidate.path, candidate.entrypoint);
      } else if (candidate.entrypoint) {
        hash = await hashExtensionFile(candidate.entrypoint);
      }
    } catch {
      // If hashing fails, treat as untrusted.
    }

    const record = hash !== undefined ? getTrustRecord(trustStore, candidate.name) : undefined;
    let trustState: NativeExtensionTrustState;
    let trust: NativeExtensionTrust;

    if (hash === undefined || !record) {
      trustState = 'untrusted';
      trust = 'untrusted';
    } else if (record.hash === hash) {
      trustState = 'trusted';
      trust = 'trusted';
    } else {
      trustState = 'changed';
      trust = 'untrusted';
    }

    candidate.trustState = trustState;
    candidate.trust = trust;
    candidate.trustStorePath = trustStorePath;

    if (hash !== undefined) {
      candidate.currentHash = hash;
    }
    if (record) {
      candidate.trustedHash = record.hash;
      candidate.trustedAt = record.trustedAt;
      if (record.trustedBy !== undefined) {
        candidate.trustedBy = record.trustedBy;
      }
    }
  }
}

interface ResolvedLayoutOrError {
  layout: ResolvedLayout | null;
  /** Diagnostics emitted when `eforge.extension` fields are invalid. */
  diagnostics: NativeExtensionDiagnostic[];
  /** True when an invalid `eforge.extension.entrypoint` caused an error. */
  invalidManifest?: boolean;
}

async function resolveExtensionLayoutFull(path: string): Promise<ResolvedLayoutOrError> {
  const diagnostics: NativeExtensionDiagnostic[] = [];
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch {
    return { layout: null, diagnostics };
  }

  if (info.isFile()) {
    const ext = extname(path);
    if (!SUPPORTED_EXTENSIONS.has(ext)) return { layout: null, diagnostics };
    return {
      layout: {
        name: basename(path, ext),
        path,
        entrypoint: path,
        format: formatFromExtension(ext),
        layout: 'file',
      },
      diagnostics,
    };
  }

  if (!info.isDirectory()) return { layout: null, diagnostics };

  // Parse package.json for this directory.
  const manifestResult = await parsePackageManifest(path);
  const packageProvenance = manifestResult.ok && manifestResult.metadata
    ? buildPackageProvenance(manifestResult.metadata)
    : undefined;

  // Read install sidecar (tolerant — missing sidecar is not an error).
  const sidecarResult = await readInstallSidecar(path);
  const installProvenance = sidecarResult.ok && sidecarResult.data
    ? buildInstallProvenance(sidecarResult.data)
    : undefined;

  // Determine logical name: prefer eforge.extension.name over basename.
  const eforgeExt = manifestResult.ok ? manifestResult.metadata?.eforgeExtension : undefined;
  const hasInvalidName = manifestResult.errors.some((e) => e.code === 'eforge-extension-invalid-name');
  const hasInvalidEntrypoint = manifestResult.errors.some((e) => e.code === 'eforge-extension-invalid-entrypoint');
  const hasInvalidDependencyMetadata = manifestResult.errors.some((e) => e.code === 'eforge-extension-invalid-capability' || e.code === 'eforge-extension-invalid-dependency');
  const capabilities = eforgeExt?.capabilities;
  const dependencies = eforgeExt?.dependencies;

  const effectiveName = (!hasInvalidName && eforgeExt?.name) ? eforgeExt.name : basename(path);

  // Emit diagnostics for invalid eforge.extension fields.
  if (hasInvalidName || hasInvalidEntrypoint || hasInvalidDependencyMetadata) {
    for (const err of manifestResult.errors) {
      if (err.code === 'eforge-extension-invalid-name' || err.code === 'eforge-extension-invalid-entrypoint' || err.code === 'eforge-extension-invalid-capability' || err.code === 'eforge-extension-invalid-dependency') {
        diagnostics.push({
          severity: 'error',
          code: 'extension:invalid-package-manifest',
          message: err.message,
          path,
        });
      }
    }
  }

  // If eforge.extension.entrypoint is present and valid, resolve it exclusively.
  if (!hasInvalidEntrypoint && eforgeExt?.entrypoint) {
    const resolved = resolve(path, eforgeExt.entrypoint);
    if (!isPathInside(resolved, path)) {
      diagnostics.push({
        severity: 'error',
        code: 'extension:invalid-package-manifest',
        message: `eforge.extension.entrypoint "${eforgeExt.entrypoint}" resolves outside the package directory at ${path}`,
        path,
      });
      // Return null — invalid entrypoint path.
      return { layout: null, diagnostics, invalidManifest: true };
    }
    if (!SUPPORTED_EXTENSIONS.has(extname(resolved))) {
      diagnostics.push({
        severity: 'error',
        code: 'extension:invalid-package-manifest',
        message: `eforge.extension.entrypoint "${eforgeExt.entrypoint}" is not a supported extension format at ${path}`,
        path,
      });
      return { layout: null, diagnostics, invalidManifest: true };
    }
    if (!(await isRegularFile(resolved))) {
      diagnostics.push({
        severity: 'error',
        code: 'extension:invalid-package-manifest',
        message: `eforge.extension.entrypoint "${eforgeExt.entrypoint}" does not exist at ${resolved}`,
        path,
      });
      return { layout: null, diagnostics, invalidManifest: true };
    }
    return {
      layout: {
        name: effectiveName,
        path,
        entrypoint: resolved,
        format: formatFromExtension(extname(resolved)),
        layout: 'directory',
        ...(packageProvenance !== undefined && { packageProvenance }),
        ...(installProvenance !== undefined && { installProvenance }),
        ...(capabilities !== undefined && { capabilities }), ...(dependencies !== undefined && { dependencies }),
      },
      diagnostics,
    };
  }

  // If eforge.extension.entrypoint was present but invalid, do not fall back.
  if (hasInvalidEntrypoint) {
    return { layout: null, diagnostics, invalidManifest: true };
  }

  // Fall back to package exports / main.
  if (manifestResult.ok && manifestResult.metadata !== undefined) {
    // Re-read raw package.json for exports/main fields.
    const rawPkg = await readRawPackageJson(path);
    if (rawPkg) {
      const exportPath = entrypointFromExports(rawPkg.exports);
      const mainPath = typeof rawPkg.main === 'string' ? rawPkg.main : undefined;
      for (const candidate of [exportPath, mainPath]) {
        if (!candidate) continue;
        const resolved = resolve(path, candidate);
        if (!isPathInside(resolved, path)) continue;
        if (!SUPPORTED_EXTENSIONS.has(extname(resolved))) continue;
        if (await isRegularFile(resolved)) {
          return {
            layout: {
              name: effectiveName,
              path,
              entrypoint: resolved,
              format: formatFromExtension(extname(resolved)),
              layout: 'directory',
              ...(packageProvenance !== undefined && { packageProvenance }),
              ...(installProvenance !== undefined && { installProvenance }),
              ...(capabilities !== undefined && { capabilities }), ...(dependencies !== undefined && { dependencies }),
            },
            diagnostics,
          };
        }
      }
    }
  } else if (!manifestResult.ok && manifestResult.errors.some((e) => e.code !== 'package-json-not-found')) {
    // package.json exists but is invalid JSON or wrong shape — try legacy path.
    const rawPkg = await readRawPackageJson(path);
    if (rawPkg) {
      const exportPath = entrypointFromExports(rawPkg.exports);
      const mainPath = typeof rawPkg.main === 'string' ? rawPkg.main : undefined;
      for (const candidate of [exportPath, mainPath]) {
        if (!candidate) continue;
        const resolved = resolve(path, candidate);
        if (!isPathInside(resolved, path)) continue;
        if (!SUPPORTED_EXTENSIONS.has(extname(resolved))) continue;
        if (await isRegularFile(resolved)) {
          return {
            layout: {
              name: basename(path),
              path,
              entrypoint: resolved,
              format: formatFromExtension(extname(resolved)),
              layout: 'directory',
            },
            diagnostics,
          };
        }
      }
    }
  } else if (!manifestResult.ok) {
    // package.json not found — fall through to index.* search.
  }

  // Fall back to index.* files.
  for (const entry of ENTRYPOINT_NAMES) {
    const candidate = resolve(path, entry);
    if (await isRegularFile(candidate)) {
      return {
        layout: {
          name: effectiveName,
          path,
          entrypoint: candidate,
          format: formatFromExtension(extname(candidate)),
          layout: 'directory',
          ...(packageProvenance !== undefined && { packageProvenance }),
          ...(installProvenance !== undefined && { installProvenance }),
          ...(capabilities !== undefined && { capabilities }), ...(dependencies !== undefined && { dependencies }),
        },
        diagnostics,
      };
    }
  }
  return { layout: null, diagnostics };
}

async function readRawPackageJson(dir: string): Promise<Record<string, unknown> | null> {
  const packagePath = resolve(dir, 'package.json');
  let data: unknown;
  try {
    data = JSON.parse(await readFile(packagePath, 'utf-8'));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

function buildPackageProvenance(metadata: ExtensionPackageMetadata): NativeExtensionPackageProvenance | undefined {
  const provenance: NativeExtensionPackageProvenance = {};
  let hasAny = false;
  if (metadata.packageName) { provenance.packageName = metadata.packageName; hasAny = true; }
  if (metadata.version) { provenance.version = metadata.version; hasAny = true; }
  if (metadata.description) { provenance.description = metadata.description; hasAny = true; }
  if (metadata.eforgeExtension?.name) { provenance.eforgeExtensionName = metadata.eforgeExtension.name; hasAny = true; }
  if (metadata.eforgeExtension?.entrypoint) { provenance.eforgeEntrypoint = metadata.eforgeExtension.entrypoint; hasAny = true; }
  if (metadata.repository) { provenance.repository = metadata.repository; hasAny = true; }
  if (metadata.homepage) { provenance.homepage = metadata.homepage; hasAny = true; }
  if (metadata.eforgeExtension?.capabilities) { provenance.capabilities = metadata.eforgeExtension.capabilities; hasAny = true; }
  if (metadata.eforgeExtension?.dependencies) { provenance.dependencies = metadata.eforgeExtension.dependencies; hasAny = true; }
  return hasAny ? provenance : undefined;
}

function buildInstallProvenance(data: InstallSidecarData): NativeExtensionInstallProvenance {
  return {
    sourceKind: data.sourceKind,
    sourceSpec: data.sourceSpec,
    ...(data.resolvedVersion !== undefined && { resolvedVersion: data.resolvedVersion }),
    ...(data.integrity !== undefined && { integrity: data.integrity }),
    installedAt: data.installedAt,
    targetScope: data.targetScope,
  };
}

function entrypointFromExports(exportsField: unknown): string | undefined {
  if (typeof exportsField === 'string') return exportsField;
  if (!exportsField || typeof exportsField !== 'object') return undefined;
  const obj = exportsField as Record<string, unknown>;
  const root = obj['.'] ?? obj;
  if (typeof root === 'string') return root;
  if (!root || typeof root !== 'object') return undefined;
  const rootObj = root as Record<string, unknown>;
  for (const key of ['import', 'default']) {
    if (typeof rootObj[key] === 'string') return rootObj[key] as string;
  }
  return undefined;
}

async function readDirectoryEntries(dir: string): Promise<string[]> {
  try { const info = await lstat(dir); return info.isDirectory() && !info.isSymbolicLink() ? readdir(dir) : []; } catch { return []; }
}

async function isRegularFile(path: string): Promise<boolean> {
  try { return (await lstat(path)).isFile(); } catch { return false; }
}

function formatFromExtension(ext: string): NativeExtensionFormat {
  if (ext === '.ts' || ext === '.mts' || ext === '.js' || ext === '.mjs') return ext.slice(1) as NativeExtensionFormat;
  throw new Error(`Unsupported extension format: ${ext}`);
}

function basenameWithoutKnownExtension(path: string): string {
  const ext = extname(path); return SUPPORTED_EXTENSIONS.has(ext) ? basename(path, ext) : basename(path);
}

function passesAutoFilters(name: string, include: string[] | undefined, exclude: string[] | undefined): boolean {
  return !(include && !include.includes(name)) && !exclude?.includes(name);
}

/**
 * Returns the initial (pre-trust-store-lookup) trust value for a scope.
 * For project-team candidates, this is a placeholder; it will be overwritten
 * during `enrichCandidatesWithTrust`. For all other scopes, trust is always granted.
 */
function initialTrustForScope(scope: NativeExtensionScope): NativeExtensionTrust {
  return scope === 'project-team' ? 'untrusted' : 'trusted';
}

function scopeForPath(path: string, opts: ScopeResolverOpts): NativeExtensionScope {
  const resolvedPath = resolve(path);
  for (const scope of PRECEDENCE) {
    const dir = getScopeDirectory(scope, opts);
    if (isPathInside(resolvedPath, dir)) return scope;
  }
  return 'external';
}

function isPathInside(path: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
