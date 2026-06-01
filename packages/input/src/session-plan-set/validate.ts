/**
 * Deterministic validation diagnostics and JSON-safe summary generation for
 * session plan sets.
 *
 * Diagnostics are produced in a deterministic order:
 *  1. duplicate child ids (manifest order)
 *  2. duplicate child files (manifest order)
 *  3. unknown child dependencies (manifest / dependency order)
 *  4. anchor diagnostics (invalid path, then missing)
 *  5. child file / path / frontmatter diagnostics (manifest order)
 *
 * The summary is JSON-safe: it contains no `Map` values and no raw umbrella or
 * child content.
 */
import { loadSessionPlanSet } from './read.js';
import type {
  SessionPlanSetChildSummary,
  SessionPlanSetDiagnostic,
  SessionPlanSetExternalRef,
  SessionPlanSetLoadResult,
  SessionPlanSetSummary,
  SessionPlanSetValidationResult,
} from './schema.js';

/**
 * Project external references onto only the declared public fields
 * (`kind`, `ref`, `url`, `title`). The manifest schema uses passthrough Zod
 * objects, so unknown fields would otherwise be serialized and exposed by the
 * daemon. Optional fields are omitted when undefined.
 */
function normalizeExternalRefs(
  refs: SessionPlanSetExternalRef[],
): SessionPlanSetExternalRef[] {
  return refs.map((ref) => {
    const normalized: SessionPlanSetExternalRef = { kind: ref.kind, ref: ref.ref };
    if (ref.url !== undefined) normalized.url = ref.url;
    if (ref.title !== undefined) normalized.title = ref.title;
    return normalized;
  });
}

/** Collect duplicate-child-id diagnostics in manifest order. */
function duplicateIdDiagnostics(load: SessionPlanSetLoadResult): SessionPlanSetDiagnostic[] {
  const diagnostics: SessionPlanSetDiagnostic[] = [];
  const seen = new Set<string>();
  for (const child of load.manifest.children) {
    if (seen.has(child.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate-child-id',
        message: `Duplicate child id "${child.id}"`,
        childId: child.id,
      });
    } else {
      seen.add(child.id);
    }
  }
  return diagnostics;
}

/** Collect duplicate-child-file diagnostics in manifest order. */
function duplicateFileDiagnostics(load: SessionPlanSetLoadResult): SessionPlanSetDiagnostic[] {
  const diagnostics: SessionPlanSetDiagnostic[] = [];
  const seen = new Set<string>();
  for (const child of load.manifest.children) {
    if (seen.has(child.file)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate-child-file',
        message: `Duplicate child file "${child.file}"`,
        childId: child.id,
        file: child.file,
      });
    } else {
      seen.add(child.file);
    }
  }
  return diagnostics;
}

/** Collect unknown-child-dependency diagnostics in manifest / dependency order. */
function unknownDependencyDiagnostics(load: SessionPlanSetLoadResult): SessionPlanSetDiagnostic[] {
  const diagnostics: SessionPlanSetDiagnostic[] = [];
  const ids = new Set(load.manifest.children.map((c) => c.id));
  for (const child of load.manifest.children) {
    for (const dependency of child.dependsOn) {
      if (!ids.has(dependency)) {
        diagnostics.push({
          severity: 'error',
          code: 'unknown-child-dependency',
          message: `Child "${child.id}" depends on unknown child "${dependency}"`,
          childId: child.id,
          dependency,
        });
      }
    }
  }
  return diagnostics;
}

/** Collect anchor diagnostics (invalid path, then missing). */
function anchorDiagnostics(load: SessionPlanSetLoadResult): SessionPlanSetDiagnostic[] {
  const anchor = load.anchor;
  if (anchor === undefined) return [];
  if (anchor.pathError !== undefined) {
    return [
      {
        severity: 'error',
        code: 'invalid-anchor-path',
        message: `Invalid umbrella anchor path "${anchor.anchor}": ${anchor.pathError}`,
        file: anchor.anchor,
      },
    ];
  }
  if (!anchor.exists) {
    return [
      {
        severity: 'error',
        code: 'missing-anchor',
        message: `Umbrella anchor file "${anchor.anchor}" does not exist`,
        file: anchor.anchor,
        path: anchor.path,
      },
    ];
  }
  return [];
}

/** Collect child file / path / frontmatter diagnostics in manifest order. */
function childFileDiagnostics(load: SessionPlanSetLoadResult): SessionPlanSetDiagnostic[] {
  const diagnostics: SessionPlanSetDiagnostic[] = [];
  for (const childLoad of load.children) {
    if (childLoad.pathError !== undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-child-path',
        message: `Invalid child path "${childLoad.file}": ${childLoad.pathError}`,
        childId: childLoad.child.id,
        file: childLoad.file,
      });
    } else if (!childLoad.exists) {
      diagnostics.push({
        severity: 'error',
        code: 'missing-child-file',
        message: `Child file "${childLoad.file}" does not exist`,
        childId: childLoad.child.id,
        file: childLoad.file,
        path: childLoad.path,
      });
    } else if (childLoad.frontmatterError !== undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'child-frontmatter-parse-error',
        message: `Child "${childLoad.child.id}" has malformed frontmatter: ${childLoad.frontmatterError}`,
        childId: childLoad.child.id,
        file: childLoad.file,
      });
    }
  }
  return diagnostics;
}

/** Compute all diagnostics in deterministic order for a loaded plan set. */
function computeDiagnostics(load: SessionPlanSetLoadResult): SessionPlanSetDiagnostic[] {
  return [
    ...duplicateIdDiagnostics(load),
    ...duplicateFileDiagnostics(load),
    ...unknownDependencyDiagnostics(load),
    ...anchorDiagnostics(load),
    ...childFileDiagnostics(load),
  ];
}

/**
 * Produce a JSON-safe summary of a loaded plan set. Includes manifest identity,
 * status, strategy, anchor metadata, per-child metadata, and the supplied
 * diagnostics. Never exposes `Map`, raw child content, or raw umbrella content.
 */
export function summarizeSessionPlanSet(
  loadResult: SessionPlanSetLoadResult,
  diagnostics: SessionPlanSetDiagnostic[] = [],
): SessionPlanSetSummary {
  const children: SessionPlanSetChildSummary[] = loadResult.children.map((childLoad) => {
    const childDiagnosticCount = diagnostics.filter(
      (d) => d.childId === childLoad.child.id,
    ).length;
    const summary: SessionPlanSetChildSummary = {
      id: childLoad.child.id,
      file: childLoad.file,
      kind: childLoad.child.kind,
      buildable: childLoad.child.buildable,
      status: childLoad.child.status,
      dependsOn: childLoad.child.dependsOn,
      exists: childLoad.exists,
      externalRefs: normalizeExternalRefs(childLoad.child.externalRefs),
      validation: { ok: childDiagnosticCount === 0, diagnosticCount: childDiagnosticCount },
    };
    if (childLoad.child.profile !== undefined) {
      summary.profile = childLoad.child.profile;
    }
    return summary;
  });

  const summary: SessionPlanSetSummary = {
    id: loadResult.manifest.id,
    title: loadResult.manifest.title,
    status: loadResult.manifest.status,
    strategy: loadResult.manifest.strategy,
    children,
    diagnostics,
    externalRefs: normalizeExternalRefs(loadResult.manifest.externalRefs),
  };

  if (loadResult.anchor !== undefined) {
    summary.anchor = {
      file: loadResult.anchor.anchor,
      path: loadResult.anchor.path,
      exists: loadResult.anchor.exists,
    };
  }

  return summary;
}

/**
 * Validate an already-loaded plan set. Returns `{ ok, diagnostics, summary }`
 * computed from the supplied load result without re-reading from disk. Callers
 * that also need the raw load result (e.g. for anchor content) load once and
 * pass it here to avoid a second filesystem read.
 */
export function validateLoadedSessionPlanSet(
  loadResult: SessionPlanSetLoadResult,
): SessionPlanSetValidationResult {
  const diagnostics = computeDiagnostics(loadResult);
  const summary = summarizeSessionPlanSet(loadResult, diagnostics);
  return { ok: diagnostics.length === 0, diagnostics, summary };
}

export interface ValidateSessionPlanSetOpts {
  cwd: string;
  planSetId: string;
}

/**
 * Load and validate a plan set. Returns `{ ok, diagnostics, summary }` where
 * `ok` is true when there are no diagnostics. Malformed child frontmatter is
 * reported as a diagnostic rather than thrown.
 */
export async function validateSessionPlanSet(
  opts: ValidateSessionPlanSetOpts,
): Promise<SessionPlanSetValidationResult> {
  const loadResult = await loadSessionPlanSet(opts);
  return validateLoadedSessionPlanSet(loadResult);
}
