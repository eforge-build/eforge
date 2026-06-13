export const PLAYBOOK_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SESSION_PLAN_ID_RE = PLAYBOOK_NAME_RE;
export const VALID_PLANNING_TYPES = ['bugfix', 'feature', 'refactor', 'architecture', 'docs', 'maintenance', 'unknown'] as const;
export const VALID_PLANNING_DEPTHS = ['quick', 'focused', 'deep'] as const;
export const VALID_PROFILES = ['errand', 'excursion', 'expedition'] as const;
export const VALID_SESSION_PLAN_STATUSES = ['planning', 'ready', 'abandoned', 'submitted'] as const;

export function includeSubmittedFromQuery(query: URLSearchParams): boolean {
  const raw = query.get('includeSubmitted');
  return raw === 'true' || raw === '1';
}

export function isValidSessionPlanId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_PLAN_ID_RE.test(value);
}

export function isValidPlaybookName(value: unknown): value is string {
  return typeof value === 'string' && PLAYBOOK_NAME_RE.test(value);
}

export function validateEnum<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}
