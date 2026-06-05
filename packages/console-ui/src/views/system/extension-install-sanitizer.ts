/**
 * Redaction helpers for install provenance shown in the System details panel.
 *
 * `sourceSpec` is recorded verbatim "as provided at install time" and can carry
 * credentials: URL userinfo (`https://user:token@host/...`), token-like query
 * parameters (`?token=...`, presigned `X-Amz-*` params), or a bare token-like
 * specifier. We redact those before rendering provenance in the Console so
 * secrets cannot leak into the UI or screenshots, while preserving enough
 * provenance (host, path, source kind, version, timestamp) for operators.
 */
import type { ExtensionInstallProvenance } from '@eforge-build/client/browser';

/** Placeholder substituted for any redacted credential value. */
export const REDACTED_VALUE = '***redacted***';

/** Query parameter names whose values are treated as secrets. */
const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'password',
  'passwd',
  'pwd',
  'secret',
  'apikey',
  'api_key',
  'auth',
  'authorization',
  'sig',
  'signature',
]);

function isSensitiveQueryKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    SENSITIVE_QUERY_KEYS.has(lower) ||
    lower.startsWith('x-amz-') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('password')
  );
}

/** Redact credentials in a URL-shaped sourceSpec. Returns null when not a URL. */
function redactUrl(spec: string): string | null {
  let url: URL;
  try {
    url = new URL(spec);
  } catch {
    return null;
  }
  if (url.username) url.username = REDACTED_VALUE;
  if (url.password) url.password = REDACTED_VALUE;
  for (const key of [...url.searchParams.keys()]) {
    if (isSensitiveQueryKey(key)) {
      url.searchParams.set(key, REDACTED_VALUE);
    }
  }
  return url.toString();
}

/** Whether a non-URL specifier looks like a bare credential token. */
function looksLikeBareToken(spec: string): boolean {
  if (spec.includes('/') || spec.includes('\\') || spec.includes(' ') || spec.includes('@')) {
    return false;
  }
  if (/^npm_[A-Za-z0-9]{20,}$/.test(spec)) return true;
  if (/^gh[pousr]_[A-Za-z0-9]{20,}$/.test(spec)) return true;
  return /^[A-Za-z0-9+/_-]{40,}={0,2}$/.test(spec);
}

/** Redact credentials from a single sourceSpec string. */
export function redactSourceSpec(spec: string): string {
  const url = redactUrl(spec);
  if (url !== null) return url;
  if (looksLikeBareToken(spec)) return REDACTED_VALUE;
  return spec;
}

/**
 * Return a copy of install provenance with any credential-bearing `sourceSpec`
 * redacted. All other provenance fields are preserved unchanged.
 */
export function sanitizeInstallProvenance(
  install: ExtensionInstallProvenance,
): ExtensionInstallProvenance {
  return { ...install, sourceSpec: redactSourceSpec(install.sourceSpec) };
}
