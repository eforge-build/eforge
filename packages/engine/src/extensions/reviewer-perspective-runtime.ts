/**
 * Reviewer perspective runtime — applicability evaluation, prompt provenance
 * composition, and diagnostic event helpers for extension reviewer perspectives.
 */

import type { EforgeEvent } from '../events.js';
import type { ReviewerPerspectiveRegistration, ReviewerPerspectiveApplicability } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUILT_IN_REVIEWER_PERSPECTIVE_KEYS = new Set(['code', 'security', 'api', 'docs', 'test', 'verify']);

export const DEFAULT_APPLICABILITY_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Applicability evaluation
// ---------------------------------------------------------------------------

export interface ApplicabilityInput {
  changedFiles: string[];
  changedLines: number;
}

export type ApplicabilityOutcome =
  | { applicable: true }
  | { applicable: false; reason: 'not-applicable' }
  | { applicable: false; reason: 'applicability-error'; message: string }
  | { applicable: false; reason: 'applicability-timeout'; timeoutMs: number };

/**
 * Evaluate whether a reviewer perspective's `appliesTo` rules match the given
 * changeset. When `appliesTo` is absent the perspective is always applicable.
 *
 * Declarative rules are evaluated synchronously first. The optional `fn`
 * predicate is invoked only when all declarative rules pass; it is bounded by
 * `timeoutMs`.
 */
export async function evaluateApplicability(
  appliesTo: ReviewerPerspectiveApplicability | undefined,
  input: ApplicabilityInput,
  timeoutMs = DEFAULT_APPLICABILITY_TIMEOUT_MS,
): Promise<ApplicabilityOutcome> {
  if (!appliesTo) return { applicable: true };

  const { changedFiles, changedLines } = input;

  try {
    // -- fileGlobs --
    if (appliesTo.fileGlobs && appliesTo.fileGlobs.length > 0) {
      const anyMatch = changedFiles.some((file) =>
        appliesTo.fileGlobs!.some((glob) => matchGlob(glob, file)),
      );
      if (!anyMatch) return { applicable: false, reason: 'not-applicable' };
    }

    // -- paths (prefix matching) --
    if (appliesTo.paths && appliesTo.paths.length > 0) {
      const anyMatch = changedFiles.some((file) =>
        appliesTo.paths!.some((prefix) => {
          const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
          return file.startsWith(normalizedPrefix) || file === prefix;
        }),
      );
      if (!anyMatch) return { applicable: false, reason: 'not-applicable' };
    }

    // -- extensions --
    if (appliesTo.extensions && appliesTo.extensions.length > 0) {
      const normalizedExts = appliesTo.extensions.map((ext) =>
        ext.startsWith('.') ? ext : `.${ext}`,
      );
      const anyMatch = changedFiles.some((file) =>
        normalizedExts.some((ext) => file.endsWith(ext)),
      );
      if (!anyMatch) return { applicable: false, reason: 'not-applicable' };
    }

    // -- categories (via file extension heuristics) --
    if (appliesTo.categories && appliesTo.categories.length > 0) {
      const categoryFiles = categorizeChangedFiles(changedFiles);
      const anyMatch = appliesTo.categories.some(
        (cat) => (categoryFiles[cat]?.length ?? 0) > 0,
      );
      if (!anyMatch) return { applicable: false, reason: 'not-applicable' };
    }

    // -- minChangedFiles --
    if (appliesTo.minChangedFiles !== undefined && changedFiles.length < appliesTo.minChangedFiles) {
      return { applicable: false, reason: 'not-applicable' };
    }

    // -- minChangedLines --
    if (appliesTo.minChangedLines !== undefined && changedLines < appliesTo.minChangedLines) {
      return { applicable: false, reason: 'not-applicable' };
    }

    // -- fn predicate (bounded by timeout) --
    if (appliesTo.fn) {
      const result = await withTimeout(
        Promise.resolve(appliesTo.fn(changedFiles, changedLines)),
        timeoutMs,
      );
      if (result.kind === 'timeout') {
        return { applicable: false, reason: 'applicability-timeout', timeoutMs };
      }
      if (result.kind === 'error') {
        return {
          applicable: false,
          reason: 'applicability-error',
          message: result.error instanceof Error ? result.error.message : String(result.error),
        };
      }
      if (typeof result.value !== 'boolean') {
        return {
          applicable: false,
          reason: 'applicability-error',
          message: `Applicability function returned ${typeof result.value}; expected boolean`,
        };
      }
      if (!result.value) {
        return { applicable: false, reason: 'not-applicable' };
      }
    }

    return { applicable: true };
  } catch (err) {
    return {
      applicable: false,
      reason: 'applicability-error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Perspective selection
// ---------------------------------------------------------------------------

export interface SelectExtensionPerspectivesOptions {
  registrations: ReviewerPerspectiveRegistration[];
  /**
   * When provided, only perspectives whose key appears in this list are
   * considered. Unknown keys in this list emit `extension:reviewer-perspective:skipped`
   * events with reason `unknown-key`.
   */
  explicitKeys?: string[];
  applicabilityInput: ApplicabilityInput;
  planId?: string;
  timeoutMs?: number;
}

export interface SelectExtensionPerspectivesResult {
  /** Keys of perspectives that passed applicability and should be dispatched. */
  selectedKeys: string[];
  /** Diagnostic events to yield before dispatching. */
  diagnosticEvents: EforgeEvent[];
}

/**
 * Evaluate applicability for all registered extension perspectives (or a
 * filtered subset when `explicitKeys` is provided) and return the keys to
 * dispatch plus diagnostic events for skipped perspectives.
 */
export async function selectExtensionPerspectives(
  options: SelectExtensionPerspectivesOptions,
): Promise<SelectExtensionPerspectivesResult> {
  const { registrations, explicitKeys, applicabilityInput, planId, timeoutMs } = options;
  const selectedKeys: string[] = [];
  const diagnosticEvents: EforgeEvent[] = [];
  const timestamp = new Date().toISOString();

  // Build lookup by key for fast access
  const byKey = new Map<string, ReviewerPerspectiveRegistration>(
    registrations.map((r) => [r.value.key, r]),
  );

  if (explicitKeys !== undefined) {
    // Explicit mode: only consider requested keys; diagnose unknown ones
    for (const key of explicitKeys) {
      if (BUILT_IN_REVIEWER_PERSPECTIVE_KEYS.has(key)) {
        // Built-in keys are handled by the built-in dispatch path; skip silently
        continue;
      }
      const registration = byKey.get(key);
      if (!registration) {
        diagnosticEvents.push({
          type: 'extension:reviewer-perspective:skipped',
          timestamp,
          extensionPath: '',
          extensionName: '',
          perspectiveKey: key,
          reason: 'unknown-key',
          message: `Perspective key "${key}" is not registered by any loaded extension`,
          ...(planId && { planId }),
        });
        continue;
      }
      const outcome = await evaluateApplicability(
        registration.value.appliesTo,
        applicabilityInput,
        timeoutMs,
      );
      if (outcome.applicable) {
        selectedKeys.push(key);
        diagnosticEvents.push({
          type: 'extension:reviewer-perspective:applied',
          timestamp,
          extensionPath: registration.extensionPath,
          extensionName: registration.extensionName,
          perspectiveKey: key,
          perspectiveLabel: registration.value.label,
          ...(planId && { planId }),
        });
      } else {
        diagnosticEvents.push({
          type: 'extension:reviewer-perspective:skipped',
          timestamp,
          extensionPath: registration.extensionPath,
          extensionName: registration.extensionName,
          perspectiveKey: key,
          reason: outcome.reason,
          ...('message' in outcome && outcome.message ? { message: outcome.message } : {}),
          ...('timeoutMs' in outcome && outcome.timeoutMs !== undefined ? { timeoutMs: outcome.timeoutMs } : {}),
          ...(planId && { planId }),
        });
      }
    }
  } else {
    // Auto mode: evaluate all registered extension perspectives
    for (const registration of registrations) {
      const key = registration.value.key;
      const outcome = await evaluateApplicability(
        registration.value.appliesTo,
        applicabilityInput,
        timeoutMs,
      );
      if (outcome.applicable) {
        selectedKeys.push(key);
        diagnosticEvents.push({
          type: 'extension:reviewer-perspective:applied',
          timestamp,
          extensionPath: registration.extensionPath,
          extensionName: registration.extensionName,
          perspectiveKey: key,
          perspectiveLabel: registration.value.label,
          ...(planId && { planId }),
        });
      } else {
        diagnosticEvents.push({
          type: 'extension:reviewer-perspective:skipped',
          timestamp,
          extensionPath: registration.extensionPath,
          extensionName: registration.extensionName,
          perspectiveKey: key,
          reason: outcome.reason,
          ...('message' in outcome && outcome.message ? { message: outcome.message } : {}),
          ...('timeoutMs' in outcome && outcome.timeoutMs !== undefined ? { timeoutMs: outcome.timeoutMs } : {}),
          ...(planId && { planId }),
        });
      }
    }
  }

  return { selectedKeys, diagnosticEvents };
}

// ---------------------------------------------------------------------------
// Prompt composition
// ---------------------------------------------------------------------------

/**
 * Build the prompt fragment provenance section for an extension reviewer
 * perspective. The section is appended to the base reviewer prompt so the
 * agent understands the domain-specific lens it should apply.
 */
export function buildExtensionPerspectivePromptSection(
  extensionName: string,
  extensionPath: string,
  spec: { key: string; label: string; description: string; promptFragment: string },
): string {
  return [
    `## Extension reviewer perspective: ${spec.label} (${spec.key})`,
    '',
    `*Contributed by extension: ${extensionName} (${extensionPath})*`,
    '',
    spec.description,
    '',
    spec.promptFragment,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Simple glob pattern matching (supports *, **, and ? wildcards). */
function matchGlob(pattern: string, path: string): boolean {
  // Convert glob to regex:
  // 1. Escape regex special chars (excluding * and ?)
  // 2. Replace ** with a placeholder, * with [^/]*, ? with [^/]
  // 3. Replace placeholder back to .*
  try {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials (not * or ?)
      .replace(/\*\*/g, '\x00') // protect ** before single * replacement
      .replace(/\*/g, '[^/]*') // single * matches within one path segment
      .replace(/\x00/g, '.*') // ** matches across path separators
      .replace(/\?/g, '[^/]'); // ? matches one non-separator char
    return new RegExp(`^${regexStr}$`).test(path);
  } catch {
    return false;
  }
}

/** Lightweight file categorization for applicability evaluation. */
function categorizeChangedFiles(files: string[]): Record<string, string[]> {
  const cats: Record<string, string[]> = {
    code: [],
    api: [],
    docs: [],
    config: [],
    deps: [],
    test: [],
  };
  for (const file of files) {
    const lower = file.toLowerCase();
    if (lower.includes('test') || lower.includes('spec') || lower.includes('__tests__')) {
      cats.test!.push(file);
    } else if (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.startsWith('docs/') || lower.includes('/docs/')) {
      cats.docs!.push(file);
    } else if (lower === 'package.json' || lower.endsWith('/package.json') || lower === 'package-lock.json' || lower.endsWith('/package-lock.json') || lower === 'pnpm-lock.yaml') {
      cats.deps!.push(file);
    } else if (lower.includes('openapi') || lower.includes('swagger') || lower.endsWith('.graphql') || lower.endsWith('.gql')) {
      cats.api!.push(file);
    } else if (lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.json') || lower.endsWith('.toml') || lower.endsWith('.env') || lower.endsWith('.ini')) {
      cats.config!.push(file);
    } else {
      cats.code!.push(file);
    }
  }
  return cats;
}

type TimeoutResult<T> = { kind: 'value'; value: T } | { kind: 'timeout' } | { kind: 'error'; error: unknown };

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<TimeoutResult<T>> {
  return new Promise<TimeoutResult<T>>((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    promise.then(
      (val) => { clearTimeout(timer); resolve({ kind: 'value', value: val }); },
      (err) => { clearTimeout(timer); resolve({ kind: 'error', error: err }); },
    );
  });
}
