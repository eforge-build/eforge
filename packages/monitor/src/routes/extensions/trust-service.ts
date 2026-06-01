import { resolve } from 'node:path';
import type { ExtensionEntry } from '@eforge-build/client';
import { extensionEntryEnabled, EMPTY_EXTENSION_REGISTRATIONS, normalizeExtensionDiagnostic } from './discovery-service.js';
import { isProjectTeamExtensionPath } from './path-security.js';

type TrustTarget = { name?: string; path?: string; trustedBy?: string };

function entryFromCandidate(candidate: any, configEnabled: boolean, trust: 'trusted' | 'untrusted', extra: Record<string, unknown>): ExtensionEntry {
  return { name: candidate.name, path: candidate.path, ...(candidate.entrypoint !== undefined && { entrypoint: candidate.entrypoint }), scope: candidate.scope, source: candidate.source, status: candidate.status, enabled: extensionEntryEnabled(candidate.status, configEnabled), trust, trustState: trust, ...(candidate.format !== undefined && { format: candidate.format }), ...(candidate.layout !== undefined && { layout: candidate.layout }), shadows: candidate.shadows.map((s: any) => ({ name: s.name, path: s.path, ...(s.entrypoint !== undefined && { entrypoint: s.entrypoint }), scope: s.scope, ...(s.format !== undefined && { format: s.format }), ...(s.layout !== undefined && { layout: s.layout }) })), registrations: { ...EMPTY_EXTENSION_REGISTRATIONS }, diagnostics: candidate.diagnostics.map(normalizeExtensionDiagnostic), ...extra };
}

async function discoverTarget(cwd: string, target: TrustTarget) {
  const { loadConfig, getConfigDir, getConventionalConfigDir } = await import('@eforge-build/engine/config');
  const ext = await import('@eforge-build/engine/extensions/index');
  const { config, warnings } = await loadConfig(cwd);
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
  const configDir = await getConfigDir(cwd) ?? getConventionalConfigDir(cwd);
  const discovery = await ext.discoverNativeExtensions({ cwd, configDir, config: { ...config.extensions, enabled: true, include: undefined, exclude: undefined } });
  let candidate: any;
  if (target.name !== undefined) {
    const team = (await Promise.all(discovery.candidates.filter((c: any) => c.name === target.name && c.scope === 'project-team').map(async (c: any) => (await isProjectTeamExtensionPath(cwd, c.path, configDir)) ? c : undefined))).filter(Boolean);
    if (team.length === 0) throw Object.assign(new Error(`No project-team extension found with name: ${target.name}`), { statusCode: 404 });
    if (team.length > 1) throw Object.assign(new Error(`Ambiguous: multiple project-team extensions found with name: ${target.name}`), { statusCode: 409 });
    candidate = team[0];
  } else if (target.path !== undefined) {
    const resolved = resolve(cwd, target.path);
    if (!await isProjectTeamExtensionPath(cwd, target.path, configDir)) throw Object.assign(new Error('Path must resolve to a project-team extension within eforge/extensions/'), { statusCode: 400 });
    candidate = discovery.candidates.find((c: any) => c.scope === 'project-team' && c.path === resolved);
    if (!candidate) throw Object.assign(new Error(`No project-team extension found at path: ${target.path}`), { statusCode: 404 });
  }
  if (!candidate) throw Object.assign(new Error('Extension not found'), { statusCode: 404 });
  return { ext, config, eforgeDir: resolve(cwd, '.eforge'), candidate };
}

async function hashCandidate(ext: any, candidate: any): Promise<string> {
  if (candidate.layout === 'directory' && candidate.entrypoint) return ext.hashExtensionDirectory(candidate.path, candidate.entrypoint);
  if (candidate.entrypoint) return ext.hashExtensionFile(candidate.entrypoint);
  throw Object.assign(new Error('Cannot hash extension: no entrypoint resolved'), { statusCode: 400 });
}

export async function trustExtension(cwd: string, target: TrustTarget) {
  const { ext, config, eforgeDir, candidate } = await discoverTarget(cwd, target);
  let hash: string;
  try { hash = await hashCandidate(ext, candidate); } catch (err) { if ((err as { statusCode?: number }).statusCode) throw err; throw Object.assign(new Error(`Failed to hash extension: ${err instanceof Error ? err.message : String(err)}`), { statusCode: 500 }); }
  await ext.upsertTrustRecord(eforgeDir, candidate.name, hash, target.trustedBy);
  const trustRecord = (await ext.readTrustStore(eforgeDir)).records.find((r: any) => r.name === candidate.name);
  const extension = entryFromCandidate(candidate, config.extensions.enabled, 'trusted', { currentHash: hash, trustedHash: hash, ...(trustRecord && { trustedAt: trustRecord.trustedAt }), ...(trustRecord?.trustedBy !== undefined && { trustedBy: trustRecord.trustedBy }), trustStorePath: ext.getTrustStorePath(eforgeDir) });
  return { extension, message: `Extension "${candidate.name}" is now trusted. Run \`eforge extension reload\` or \`eforge extension validate ${candidate.name}\` to apply.` };
}

export async function untrustExtension(cwd: string, target: TrustTarget) {
  const { ext, config, eforgeDir, candidate } = await discoverTarget(cwd, target);
  await ext.removeTrustRecord(eforgeDir, candidate.name);
  let currentHash: string | undefined; try { currentHash = await hashCandidate(ext, candidate); } catch {}
  const extension = entryFromCandidate(candidate, config.extensions.enabled, 'untrusted', { ...(currentHash !== undefined && { currentHash }), trustStorePath: ext.getTrustStorePath(eforgeDir) });
  return { extension, message: `Extension "${candidate.name}" is now untrusted. Run \`eforge extension reload\` to apply.` };
}
