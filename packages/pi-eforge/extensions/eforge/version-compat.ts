/**
 * Version comparison helpers for Pi-facing daemon diagnostics.
 *
 * The daemon reports a build identifier shaped like
 * `{packageVersion}{-dirty?} ({gitSha})`, while the Pi extension only has its
 * package.json version available at runtime. Compare package versions instead
 * of exact build identifiers so local dirty builds do not produce false stale
 * daemon warnings.
 */
export function normalizeEforgePackageVersion(version: string): string {
  return version.trim().replace(/\s+\([^)]+\)\s*$/, '').replace(/-dirty$/, '');
}

export function getPiDaemonVersionMismatch(rawDaemonVersion: string | undefined, piExtensionVersion: string): string | undefined {
  if (rawDaemonVersion === undefined) return undefined;
  if (rawDaemonVersion.trim() === '' || rawDaemonVersion === 'unknown') return undefined;
  if (piExtensionVersion.trim() === '' || piExtensionVersion === 'unknown') return undefined;

  const daemonPackageVersion = normalizeEforgePackageVersion(rawDaemonVersion);
  const piPackageVersion = normalizeEforgePackageVersion(piExtensionVersion);
  if (daemonPackageVersion === piPackageVersion) return undefined;

  return 'Daemon package version differs from the installed Pi extension. Restart the daemon (or update the Pi extension) so they match.';
}
