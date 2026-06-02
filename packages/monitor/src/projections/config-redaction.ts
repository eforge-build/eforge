const SENSITIVE_KEY_EXACT = new Set(['apikey', 'key', 'token', 'secret', 'password', 'authorization', 'credential', 'credentials']);

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_EXACT.has(normalized)
    || normalized.includes('token')
    || normalized.includes('secret')
    || normalized.includes('password')
    || normalized.includes('credential')
    || normalized.includes('authorization')
    || normalized.includes('privatekey')
    || normalized.includes('accesskey')
    || normalized.includes('apikey');
}

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? '[redacted]' : redactSensitive(nested);
    }
    return result;
  }
  return value;
}

export function redactGitRemote(remote: string | null): string | null {
  if (!remote) return remote;
  try {
    const parsed = new URL(remote);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return remote;
  }
}
