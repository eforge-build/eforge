/**
 * Typed JSON fetch helper for Console route constants.
 * Rejects non-2xx responses with an Error containing the HTTP status.
 * Returns null for 404 when `allowNotFound` is true.
 * Accepts an optional AbortSignal to cancel the request.
 */
export async function fetchJson<T>(
  url: string,
  opts: { allowNotFound?: boolean; signal?: AbortSignal } = {},
): Promise<T | null> {
  const { allowNotFound, signal } = opts;
  const res = await fetch(url, signal ? { signal } : undefined);
  if (res.status === 404 && allowNotFound) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  return res.json() as Promise<T>;
}
