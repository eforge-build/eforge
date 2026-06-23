import type { PlaybookPlanSeed } from '@eforge-build/input';

export function omitUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => omitUndefined(entry)) as T;
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== undefined) out[key] = omitUndefined(entry);
  }
  return out as T;
}

export function projectPlanSeed(seed: PlaybookPlanSeed) {
  const sections: Record<string, string> = {};
  for (const [key, value] of seed.sections) sections[key] = value;
  return omitUndefined({
    sessionId: seed.sessionId,
    topic: seed.topic,
    sections,
    seededFrom: seed.seededFrom,
    profile: seed.profile,
  });
}
