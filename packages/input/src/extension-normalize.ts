/**
 * Async preprocessing seam for eforge build sources.
 *
 * Resolves explicit `eforge://input/<adapter>/<id...>` references via registered
 * adapter extensions, normalizes session-plan file sources via
 * `normalizeBuildSource`, then applies PRD enrichers sequentially (fail-open).
 *
 * Public API:
 *   preprocessBuildSource     — top-level async preprocessing helper
 *   parseInputSourceReference — parse `eforge://input/<adapter>/<id...>` references
 *   FatalPreprocessingError   — thrown when an input-source failure is unrecoverable
 *
 * Structural types (no engine dependency):
 *   InputSourceRegistrationLike  — structural input-source registration shape
 *   PrdEnricherRegistrationLike  — structural PRD enricher registration shape
 *   PreprocessingProvenanceEvent — timestamp-free event payload union
 *   PreprocessingResult          — return type of preprocessBuildSource
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createEforgeProjectPaths } from '@eforge-build/extension-sdk/project-paths';
import { normalizeBuildSource } from './session-plan.js';

// ---------------------------------------------------------------------------
// Structural registration types (no @eforge-build/engine dependency)
// ---------------------------------------------------------------------------

/**
 * Structural shape for input-source registrations accepted by `preprocessBuildSource`.
 * Compatible with `InputSourceRegistration` from `@eforge-build/engine` without
 * importing it.
 */
export interface InputSourceRegistrationLike {
  extensionName: string;
  extensionPath: string;
  name: string;
  value: {
    name: string;
    description: string;
    canHandle?: (...args: never[]) => unknown;
    fetch: (...args: never[]) => unknown;
  };
}

/**
 * Structural shape for PRD enricher registrations accepted by `preprocessBuildSource`.
 * Compatible with `PrdEnricherRegistration` from `@eforge-build/engine` without
 * importing it.
 */
export interface PrdEnricherRegistrationLike {
  extensionName: string;
  extensionPath: string;
  name: string;
  value: {
    name: string;
    description: string;
    appliesTo?: (...args: never[]) => unknown;
    enrich: (...args: never[]) => unknown;
  };
}

// ---------------------------------------------------------------------------
// Provenance event types (timestamp-free; compatible with EforgeEvent variants)
// ---------------------------------------------------------------------------

/** Emitted when an input adapter successfully fetches content. */
export type InputSourceFetchedEvent = {
  type: 'extension:input-source:fetched';
  extensionPath: string;
  extensionName: string;
  adapterName: string;
  sourceId: string;
  contentLength: number;
};

/** Emitted when an input adapter fails to fetch content (fatal). */
export type InputSourceFailedEvent = {
  type: 'extension:input-source:failed';
  extensionPath: string;
  extensionName: string;
  adapterName: string;
  sourceId: string;
  reason: 'not-found' | 'error' | 'timeout' | 'invalid-result';
  message: string;
  stack?: string;
  timeoutMs?: number;
};

/** Emitted when a PRD enricher successfully applies (or no-ops). */
export type PrdEnricherAppliedEvent = {
  type: 'extension:prd-enricher:applied';
  extensionPath: string;
  extensionName: string;
  enricherName: string;
  sourceId: string;
  changed: boolean;
  inputLength: number;
  outputLength: number;
};

/** Emitted when a PRD enricher fails (fail-open). */
export type PrdEnricherFailedEvent = {
  type: 'extension:prd-enricher:failed';
  extensionPath: string;
  extensionName: string;
  enricherName: string;
  sourceId: string;
  reason: 'error' | 'timeout' | 'invalid-result';
  message: string;
  stack?: string;
  timeoutMs?: number;
};

/** Union of all timestamp-free provenance/diagnostic event payloads. */
export type PreprocessingProvenanceEvent =
  | InputSourceFetchedEvent
  | InputSourceFailedEvent
  | PrdEnricherAppliedEvent
  | PrdEnricherFailedEvent;

// ---------------------------------------------------------------------------
// Provenance summary
// ---------------------------------------------------------------------------

export interface PreprocessingProvenance {
  /** For `eforge://input/...` sources: the matched adapter name. */
  adapterName?: string;
  /** For `eforge://input/...` sources: the resolved source id. */
  sourceId?: string;
  /** For `eforge://input/...` sources: the matched adapter extension name. */
  extensionName?: string;
  /** For `eforge://input/...` sources: the matched adapter extension path. */
  extensionPath?: string;
  /** Names of enrichers that changed the content. */
  enrichersApplied: string[];
  /** Names of enrichers that failed (fail-open: content unchanged). */
  enrichersFailed: string[];
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface PreprocessingResult {
  /** Normalized content ready for the build engine. */
  content: string;
  /** Resolved absolute source file path for file-based inputs; undefined for adapter/inline inputs. */
  sourcePath?: string;
  /** Provenance summary. */
  provenance: PreprocessingProvenance;
  /** Timestamp-free provenance/diagnostic event payloads. */
  events: PreprocessingProvenanceEvent[];
  /**
   * Agent runtime profile inherited from a session plan's `agent_profile` frontmatter field.
   * Only present when the source is a `.eforge/session-plans/*.md` file that declares `agent_profile`.
   * Callers use this to apply the inherited profile when no explicit override is provided.
   */
  agentProfile?: string;
}

// ---------------------------------------------------------------------------
// Fatal preprocessing error
// ---------------------------------------------------------------------------

/**
 * Thrown when an input-source failure is unrecoverable (fatal enqueue failure).
 * Carries the `extension:input-source:failed` event that caused the failure.
 */
export class FatalPreprocessingError extends Error {
  /** The `extension:input-source:failed` diagnostic event that caused this error. */
  readonly diagnosticEvent: InputSourceFailedEvent;

  constructor(diagnosticEvent: InputSourceFailedEvent) {
    super(diagnosticEvent.message);
    this.name = 'FatalPreprocessingError';
    this.diagnosticEvent = diagnosticEvent;
  }
}

// ---------------------------------------------------------------------------
// Source reference parsing
// ---------------------------------------------------------------------------

export interface InputSourceReference {
  adapter: string;
  sourceId: string;
}

const INPUT_REF_PREFIX = 'eforge://input/';

/**
 * Parse an `eforge://input/<adapter>/<id...>` reference.
 *
 * Returns `null` if the source does not begin with `eforge://input/` (i.e., it
 * is a file path or inline content). Throws if the reference starts with the
 * prefix but is structurally malformed (missing adapter or source id).
 *
 * The source id segment is URL-decoded, so percent-encoded characters like
 * `%2F` (→ `/`) and `%23` (→ `#`) are expanded.
 *
 * @example
 * parseInputSourceReference('eforge://input/github/owner%2Frepo%23123')
 * // => { adapter: 'github', sourceId: 'owner/repo#123' }
 *
 * parseInputSourceReference('/path/to/file.md')
 * // => null
 */
export function parseInputSourceReference(source: string): InputSourceReference | null {
  if (!source.startsWith(INPUT_REF_PREFIX)) return null;

  const rest = source.slice(INPUT_REF_PREFIX.length);
  const slashIdx = rest.indexOf('/');

  if (slashIdx <= 0) {
    // No slash found after adapter name, or adapter name is empty
    throw new Error(
      `Malformed eforge input reference "${source}": missing source id (expected eforge://input/<adapter>/<id>)`,
    );
  }

  const adapter = rest.slice(0, slashIdx);
  const encodedSourceId = rest.slice(slashIdx + 1);

  if (!encodedSourceId) {
    throw new Error(
      `Malformed eforge input reference "${source}": missing source id (expected eforge://input/<adapter>/<id>)`,
    );
  }

  let sourceId: string;
  try {
    sourceId = decodeURIComponent(encodedSourceId);
  } catch {
    throw new Error(
      `Malformed eforge input reference "${source}": invalid percent-encoding in source id`,
    );
  }

  return { adapter, sourceId };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Sentinel used to distinguish a timeout from other errors. */
class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) { super(`Timed out after ${timeoutMs}ms`); this.name = 'TimeoutError'; }
}

/**
 * Run an async factory with a wall-clock timeout.
 * Rejects with `TimeoutError` if the factory does not settle within `timeoutMs`.
 */
async function withTimeout<T>(factory: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);

    factory().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Extract a content string from an adapter/enricher result.
 * Returns `null` when the result is a non-null, non-string value without a
 * `content` string field (i.e., the result is invalid).
 */
function extractContent(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (result !== null && result !== undefined && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj.content === 'string') return obj.content;
  }
  return null;
}

const unavailableExec = () => ({ async run(): Promise<never> { throw new Error('Input transform exec.run is unavailable during preprocessing'); } });

type InputTransformContextOpts = { cwd: string; configDir: string; originalSource: string; sourceKind: 'inline' | 'file' | 'extension-reference'; extensionName: string; extensionPath: string; sourceId?: string; sourcePath?: string; adapterId?: string };

const buildInputTransformContext = ({ cwd, configDir, extensionName, ...rest }: InputTransformContextOpts): Record<string, unknown> => ({ cwd, ...rest, extensionName, logger: { debug() {}, info() {}, warn() {}, error() {} }, exec: unavailableExec(), paths: createEforgeProjectPaths({ cwd, configDir, extensionName }) });

export interface PreprocessBuildSourceOpts {
  /** Raw source string: a file path, inline content, or `eforge://input/<adapter>/<id>` reference. */
  source: string;
  /** Registered input source adapters from the extension registry. */
  inputSources: InputSourceRegistrationLike[];
  /** Registered PRD enrichers from the extension registry. */
  prdEnrichers: PrdEnricherRegistrationLike[];
  /** Project working directory for resolving relative file paths. */
  cwd: string;
  configDir?: string;
  /** Timeout in milliseconds for adapter fetch and enricher calls. */
  timeoutMs: number;
}

/**
 * Async preprocessing helper for eforge build sources.
 *
 * Resolution order:
 * 1. **Explicit reference**: if `source` matches `eforge://input/<adapter>/<id>`,
 *    look up the registered adapter by name and call its `fetch` function.
 *    Unknown adapters, not-found results, invalid results, and timeouts are all
 *    fatal — throws `FatalPreprocessingError` without running enrichers.
 * 2. **File/inline**: attempt to stat and read `source` as a file path. If the
 *    file exists, pass its content through `normalizeBuildSource` (which handles
 *    session-plan conversion). If the file does not exist, treat `source` as
 *    inline content.
 * 3. **Enrichers**: apply each registered PRD enricher sequentially. Throws
 *    (`error`, `timeout`, `invalid-result`) are fail-open: the helper records a
 *    diagnostic event and continues with the last valid content; subsequent
 *    enrichers still run.
 *
 * Returns a `PreprocessingResult` with the normalized `content`, an optional
 * `sourcePath` (for file inputs), a `provenance` summary, and timestamp-free
 * `events` suitable for wrapping with a timestamp before yielding as `EforgeEvent`s.
 *
 * @throws `FatalPreprocessingError` if the explicit input-source resolution fails.
 */
export async function preprocessBuildSource(
  opts: PreprocessBuildSourceOpts,
): Promise<PreprocessingResult> {
  const { source, inputSources, prdEnrichers, cwd, timeoutMs } = opts;
  const configDir = opts.configDir ?? resolve(cwd, 'eforge');

  const events: PreprocessingProvenanceEvent[] = [];
  const provenance: PreprocessingProvenance = {
    enrichersApplied: [],
    enrichersFailed: [],
  };

  let content: string;
  let sourcePath: string | undefined;
  let agentProfile: string | undefined;

  // -------------------------------------------------------------------------
  // Step 1: Resolve source content
  // -------------------------------------------------------------------------

  let ref: InputSourceReference | null;
  try {
    ref = parseInputSourceReference(source);
  } catch (parseErr) {
    // Malformed eforge://input/... reference — fatal
    const failedEvent: InputSourceFailedEvent = {
      type: 'extension:input-source:failed',
      extensionPath: '',
      extensionName: '',
      adapterName: '',
      sourceId: source,
      reason: 'error',
      message: parseErr instanceof Error ? parseErr.message : String(parseErr),
    };
    events.push(failedEvent);
    throw new FatalPreprocessingError(failedEvent);
  }

  if (ref !== null) {
    // ------------------------------------------------------------------
    // Explicit eforge://input/<adapter>/<id> reference
    // ------------------------------------------------------------------
    const { adapter: adapterName, sourceId } = ref;

    provenance.adapterName = adapterName;
    provenance.sourceId = sourceId;

    // Lookup adapter by name
    const registration = inputSources.find((r) => r.name === adapterName);
    if (!registration) {
      const failedEvent: InputSourceFailedEvent = {
        type: 'extension:input-source:failed',
        extensionPath: '',
        extensionName: '',
        adapterName,
        sourceId,
        reason: 'error',
        message: `Unknown input adapter: "${adapterName}"`,
      };
      events.push(failedEvent);
      throw new FatalPreprocessingError(failedEvent);
    }

    provenance.extensionName = registration.extensionName;
    provenance.extensionPath = registration.extensionPath;

    // Fetch with timeout
    const fetchFn = registration.value.fetch as unknown as (sourceId: string, ctx?: Record<string, unknown>) => Promise<unknown>;

    let fetchResult: unknown;
    try {
      fetchResult = await withTimeout(() => fetchFn(sourceId, buildInputTransformContext({ cwd, configDir, originalSource: source, sourceKind: 'extension-reference', adapterId: adapterName, sourceId, extensionName: registration.extensionName, extensionPath: registration.extensionPath })), timeoutMs);
    } catch (err) {
      if (err instanceof TimeoutError) {
        const failedEvent: InputSourceFailedEvent = {
          type: 'extension:input-source:failed',
          extensionPath: registration.extensionPath,
          extensionName: registration.extensionName,
          adapterName,
          sourceId,
          reason: 'timeout',
          message: err.message,
          timeoutMs: err.timeoutMs,
        };
        events.push(failedEvent);
        throw new FatalPreprocessingError(failedEvent);
      }
      const failedEvent: InputSourceFailedEvent = {
        type: 'extension:input-source:failed',
        extensionPath: registration.extensionPath,
        extensionName: registration.extensionName,
        adapterName,
        sourceId,
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      };
      events.push(failedEvent);
      throw new FatalPreprocessingError(failedEvent);
    }

    // null/undefined → not-found (fatal)
    if (fetchResult === null || fetchResult === undefined) {
      const failedEvent: InputSourceFailedEvent = {
        type: 'extension:input-source:failed',
        extensionPath: registration.extensionPath,
        extensionName: registration.extensionName,
        adapterName,
        sourceId,
        reason: 'not-found',
        message: `Adapter "${adapterName}" returned null/undefined for source id "${sourceId}"`,
      };
      events.push(failedEvent);
      throw new FatalPreprocessingError(failedEvent);
    }

    // Extract content string
    const extracted = extractContent(fetchResult);
    if (extracted === null) {
      const failedEvent: InputSourceFailedEvent = {
        type: 'extension:input-source:failed',
        extensionPath: registration.extensionPath,
        extensionName: registration.extensionName,
        adapterName,
        sourceId,
        reason: 'invalid-result',
        message: `Adapter "${adapterName}" returned an invalid result for source id "${sourceId}": expected string or { content: string }`,
      };
      events.push(failedEvent);
      throw new FatalPreprocessingError(failedEvent);
    }

    content = extracted;

    events.push({
      type: 'extension:input-source:fetched',
      extensionPath: registration.extensionPath,
      extensionName: registration.extensionName,
      adapterName,
      sourceId,
      contentLength: content.length,
    });
  } else {
    // ------------------------------------------------------------------
    // File or inline content
    // ------------------------------------------------------------------
    let rawContent: string | undefined;
    let resolvedPath: string | undefined;

    try {
      resolvedPath = resolve(cwd, source);
      const fileStat = await stat(resolvedPath);
      if (fileStat.isFile()) {
        rawContent = await readFile(resolvedPath, 'utf-8');
      }
    } catch {
      // File is not accessible — treat source as inline content
    }

    if (rawContent !== undefined && resolvedPath !== undefined) {
      // Normalize (session-plan conversion for .eforge/session-plans/*.md paths)
      const normalized = normalizeBuildSource({ sourcePath: resolvedPath, content: rawContent });
      content = normalized.content;
      sourcePath = resolvedPath;
      agentProfile = normalized.agentProfile;
    } else {
      // Inline content
      content = source;
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Apply PRD enrichers sequentially (fail-open)
  // -------------------------------------------------------------------------

  // Use the source id for enricher provenance: adapter sourceId or the raw source string
  const enricherSourceId = provenance.sourceId ?? source;

  for (const registration of prdEnrichers) {
    const inputLength = content.length;
    const enrichFn = registration.value.enrich as unknown as (input: Record<string, unknown>) => Promise<unknown>;
    const ctx = buildInputTransformContext({ cwd, configDir, originalSource: source, sourceKind: ref ? 'extension-reference' : sourcePath ? 'file' : 'inline', sourcePath, adapterId: provenance.adapterName, sourceId: enricherSourceId, extensionName: registration.extensionName, extensionPath: registration.extensionPath });

    let enrichResult: unknown;
    try {
      enrichResult = await withTimeout(() => enrichFn({ content, sourceId: enricherSourceId, ctx }), timeoutMs);
    } catch (err) {
      if (err instanceof TimeoutError) {
        events.push({
          type: 'extension:prd-enricher:failed',
          extensionPath: registration.extensionPath,
          extensionName: registration.extensionName,
          enricherName: registration.name,
          sourceId: enricherSourceId,
          reason: 'timeout',
          message: err.message,
          timeoutMs: err.timeoutMs,
        });
      } else {
        events.push({
          type: 'extension:prd-enricher:failed',
          extensionPath: registration.extensionPath,
          extensionName: registration.extensionName,
          enricherName: registration.name,
          sourceId: enricherSourceId,
          reason: 'error',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
      provenance.enrichersFailed.push(registration.name);
      continue; // fail-open: leave content unchanged, continue with next enricher
    }

    // null/undefined → no content change (not an error)
    if (enrichResult === null || enrichResult === undefined) {
      events.push({
        type: 'extension:prd-enricher:applied',
        extensionPath: registration.extensionPath,
        extensionName: registration.extensionName,
        enricherName: registration.name,
        sourceId: enricherSourceId,
        changed: false,
        inputLength,
        outputLength: content.length,
      });
      continue;
    }

    // Extract content string
    const extracted = extractContent(enrichResult);
    if (extracted === null) {
      events.push({
        type: 'extension:prd-enricher:failed',
        extensionPath: registration.extensionPath,
        extensionName: registration.extensionName,
        enricherName: registration.name,
        sourceId: enricherSourceId,
        reason: 'invalid-result',
        message: `Enricher "${registration.name}" returned an invalid result: expected string, { content: string }, or null/undefined`,
      });
      provenance.enrichersFailed.push(registration.name);
      continue; // fail-open
    }

    // Apply enriched content
    events.push({
      type: 'extension:prd-enricher:applied',
      extensionPath: registration.extensionPath,
      extensionName: registration.extensionName,
      enricherName: registration.name,
      sourceId: enricherSourceId,
      changed: true,
      inputLength,
      outputLength: extracted.length,
    });
    provenance.enrichersApplied.push(registration.name);
    content = extracted;
  }
  return {
    content,
    sourcePath,
    provenance,
    events,
    ...(agentProfile !== undefined && { agentProfile }),
  };
}
