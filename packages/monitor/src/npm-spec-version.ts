// --- eforge:region npm-spec-version ---
/** Registry npm package spec helpers used by extension package updates. */
export function updateNpmSpecVersion(spec: string, version: string): string {
  // Handle scoped packages: @scope/name or @scope/name@existing
  if (spec.startsWith('@')) {
    const secondAt = spec.indexOf('@', 1);
    return secondAt >= 0
      ? `${spec.slice(0, secondAt)}@${version}`
      : `${spec}@${version}`;
  }

  // Regular: name or name@existing
  const atIdx = spec.indexOf('@');
  return atIdx >= 0
    ? `${spec.slice(0, atIdx)}@${version}`
    : `${spec}@${version}`;
}

export function isRegistryNpmPackageSpec(spec: string): boolean {
  if (spec.endsWith('.tgz') || spec.endsWith('.tar.gz')) return false;

  const versionSeparator = spec.startsWith('@') ? spec.indexOf('@', 1) : spec.indexOf('@');
  const packageName = versionSeparator >= 0 ? spec.slice(0, versionSeparator) : spec;
  const versionPart = versionSeparator >= 0 ? spec.slice(versionSeparator + 1) : undefined;

  if (versionPart !== undefined && (versionPart.length === 0 || versionPart.includes(':') || versionPart.includes('/'))) {
    return false;
  }
  if (packageName.startsWith('@')) {
    return /^@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*$/iu.test(packageName);
  }
  return /^[a-z0-9][a-z0-9._~-]*$/iu.test(packageName);
}
// --- eforge:endregion npm-spec-version ---
