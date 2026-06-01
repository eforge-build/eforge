import type { ExtensionDemoteRequest, ExtensionInstallRequest, ExtensionPromoteRequest, ExtensionRemoveRequest, ExtensionUpdateRequest } from '@eforge-build/client';
import { demoteExtensionPackage, ExtensionPackageError, installExtensionPackage, promoteExtensionPackage, removeExtensionPackage, updateExtensionPackage } from '../../extension-package-management.js';
import { loadExtensionResponse, selectExtensionByName } from './discovery-service.js';

async function configDirFor(cwd: string): Promise<{ configDir: string }> {
  const { loadConfig, getConfigDir, getConventionalConfigDir } = await import('@eforge-build/engine/config');
  const { warnings } = await loadConfig(cwd);
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
  return { configDir: await getConfigDir(cwd) ?? getConventionalConfigDir(cwd) };
}

async function rediscover(cwd: string, targetPath: string, name: string, action: string) {
  const listData = await loadExtensionResponse(cwd, { path: targetPath, discoverOnly: true });
  const extension = listData.extensions.find((e) => e.path === targetPath) ?? selectExtensionByName(listData.extensions, name);
  if (!extension) throw new Error(`Extension ${action} but not found in discovery`);
  return extension;
}

export async function installPackage(cwd: string, body: ExtensionInstallRequest) {
  const { configDir } = await configDirFor(cwd);
  const result = await installExtensionPackage(body, cwd, configDir);
  const extension = await rediscover(cwd, result.targetPath, result.name, 'installed');
  const needsTrust = result.scope === 'project' && (!body.trust);
  return { extension, message: needsTrust ? `Extension "${result.name}" installed to project scope. Run \`eforge extension trust ${result.name}\` to trust it before use.` : `Extension "${result.name}" installed to ${result.scope} scope.` };
}
export async function updatePackage(cwd: string, body: ExtensionUpdateRequest) {
  const { configDir } = await configDirFor(cwd);
  const result = await updateExtensionPackage(body, cwd, configDir);
  const extension = await rediscover(cwd, result.targetPath, result.name, 'updated');
  const needsTrust = result.scope === 'project' && (!body.trust);
  return { extension, ...(result.previousVersion !== undefined && { previousVersion: result.previousVersion }), message: needsTrust ? `Extension "${result.name}" updated. Run \`eforge extension trust ${result.name}\` to re-trust it before use.` : `Extension "${result.name}" updated.` };
}
export async function removePackage(cwd: string, body: ExtensionRemoveRequest) {
  const result = await removeExtensionPackage(body, cwd, (await configDirFor(cwd)).configDir);
  return { message: `Extension "${result.name}" removed from ${result.removedPath}.` };
}
export async function promotePackage(cwd: string, body: ExtensionPromoteRequest) {
  const result = await promoteExtensionPackage(body, cwd, (await configDirFor(cwd)).configDir);
  const extension = await rediscover(cwd, result.targetPath, result.name, 'promoted');
  return { extension, message: body.trust ? `Extension "${result.name}" promoted to project-team scope.` : `Extension "${result.name}" promoted to project-team scope. Run \`eforge extension trust ${result.name}\` to trust it before use.` };
}
export async function demotePackage(cwd: string, body: ExtensionDemoteRequest) {
  const result = await demoteExtensionPackage(body, cwd, (await configDirFor(cwd)).configDir);
  const extension = await rediscover(cwd, result.targetPath, result.name, 'demoted');
  return { extension, message: `Extension "${result.name}" demoted to project-local scope.` };
}
export { ExtensionPackageError };
