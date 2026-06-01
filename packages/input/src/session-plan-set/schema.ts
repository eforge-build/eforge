/**
 * Read-only session plan-set schema, constants, and exported types.
 *
 * A session plan set is a directory under `.eforge/session-plans/<plan-set-id>/`
 * containing a canonical `plan-set.yaml` manifest, an optional umbrella anchor
 * markdown file, and manifest-declared child markdown files. The manifest is the
 * single source of membership — readers verify files named by the manifest and
 * never recursively discover child plans as a second membership source.
 *
 * This module defines the Zod schemas and the structural TypeScript types used
 * by the manifest, path, read, and validation modules. Duplicate-id and
 * duplicate-file detection are validation diagnostics, not schema errors.
 */
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical manifest file name inside a plan-set directory. */
export const SESSION_PLAN_SET_MANIFEST_FILENAME = 'plan-set.yaml';

/** Lifecycle status value set shared by the plan set and its children. */
export const SESSION_PLAN_SET_STATUSES = ['planning', 'ready', 'submitted', 'abandoned'] as const;

/** Strategy value set describing how children relate to one another. */
export const SESSION_PLAN_SET_STRATEGIES = ['sequential', 'parallel', 'dag'] as const;

/** Child kind value set. */
export const SESSION_PLAN_SET_CHILD_KINDS = ['plan', 'note', 'reference'] as const;

/** Lower-case slug identifier pattern shared by plan-set and child ids. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Enum schemas + derived union types
// ---------------------------------------------------------------------------

export const sessionPlanSetStatusSchema = z.enum(SESSION_PLAN_SET_STATUSES);
export const sessionPlanSetStrategySchema = z.enum(SESSION_PLAN_SET_STRATEGIES);
export const sessionPlanSetChildKindSchema = z.enum(SESSION_PLAN_SET_CHILD_KINDS);

export type SessionPlanSetStatus = z.output<typeof sessionPlanSetStatusSchema>;
export type SessionPlanSetStrategy = z.output<typeof sessionPlanSetStrategySchema>;
export type SessionPlanSetChildKind = z.output<typeof sessionPlanSetChildKindSchema>;

// ---------------------------------------------------------------------------
// External reference schema
// ---------------------------------------------------------------------------

/** An external tracker / document reference attached to a manifest or child. */
export const sessionPlanSetExternalRefSchema = z
  .object({
    kind: z.string(),
    ref: z.string(),
    url: z.string().optional(),
    title: z.string().optional(),
  })
  .passthrough();

export type SessionPlanSetExternalRef = z.output<typeof sessionPlanSetExternalRefSchema>;

// ---------------------------------------------------------------------------
// Child schema
// ---------------------------------------------------------------------------

/**
 * A single child entry in a plan-set manifest. The schema is permissive for
 * unknown fields so future metadata can be read without breaking this read-only
 * slice. Duplicate ids/files are validation diagnostics, not schema errors.
 */
export const sessionPlanSetChildSchema = z
  .object({
    id: z.string().regex(SLUG_RE, 'must be a lower-case slug'),
    title: z.string(),
    file: z.string(),
    kind: sessionPlanSetChildKindSchema,
    buildable: z.boolean(),
    status: sessionPlanSetStatusSchema,
    profile: z.string().optional(),
    dependsOn: z.array(z.string()).default([]),
    externalRefs: z.array(sessionPlanSetExternalRefSchema).default([]),
  })
  .passthrough();

export type SessionPlanSetChild = z.output<typeof sessionPlanSetChildSchema>;

// ---------------------------------------------------------------------------
// Manifest schema
// ---------------------------------------------------------------------------

/**
 * The canonical plan-set manifest. `children` order is the child ordering — do
 * not add a parallel order field. Permissive for unknown fields.
 */
export const sessionPlanSetManifestSchema = z
  .object({
    id: z.string().regex(SLUG_RE, 'must be a lower-case slug'),
    title: z.string(),
    status: sessionPlanSetStatusSchema,
    strategy: sessionPlanSetStrategySchema,
    anchor: z.string().optional(),
    children: z.array(sessionPlanSetChildSchema).default([]),
    externalRefs: z.array(sessionPlanSetExternalRefSchema).default([]),
  })
  .passthrough();

export type SessionPlanSetManifest = z.output<typeof sessionPlanSetManifestSchema>;

// ---------------------------------------------------------------------------
// List entry
// ---------------------------------------------------------------------------

/** A lightweight listing entry for a directory that contains a valid manifest. */
export interface SessionPlanSetListEntry {
  /** Plan-set id from the manifest (not the directory name). */
  id: string;
  /** Directory name, used to load the set via `loadSessionPlanSet`. */
  planSetId: string;
  /** Human-readable title. */
  title: string;
  /** Plan-set lifecycle status. */
  status: SessionPlanSetStatus;
  /** Child relationship strategy. */
  strategy: SessionPlanSetStrategy;
  /** Absolute path to the plan-set directory. */
  dir: string;
  /** Absolute path to the `plan-set.yaml` manifest. */
  manifestPath: string;
  /** Number of declared children. */
  childCount: number;
}

// ---------------------------------------------------------------------------
// Load result shapes
// ---------------------------------------------------------------------------

/** Loaded umbrella anchor metadata. */
export interface SessionPlanSetAnchorLoad {
  /** Relative anchor file name as declared in the manifest. */
  anchor: string;
  /** Absolute resolved path; empty string when the path could not be resolved. */
  path: string;
  /** Whether the anchor file exists on disk. */
  exists: boolean;
  /** Raw anchor content when the file exists. */
  content?: string;
  /** Path-resolution error message when the anchor path is unsafe. */
  pathError?: string;
}

/** Loaded child metadata for a single manifest-declared child file. */
export interface SessionPlanSetChildLoad {
  /** The manifest child entry. */
  child: SessionPlanSetChild;
  /** Absolute resolved path; empty string when the path could not be resolved. */
  path: string;
  /** Relative file path as declared in the manifest. */
  file: string;
  /** Whether the child file exists on disk. */
  exists: boolean;
  /** Raw markdown content when the file exists. */
  content?: string;
  /** Parsed child frontmatter record when present and valid. */
  frontmatter?: Record<string, unknown>;
  /** Frontmatter YAML parse error message when the child frontmatter is malformed. */
  frontmatterError?: string;
  /** Path-resolution error message when the child path is unsafe. */
  pathError?: string;
}

/** The rich result of loading a plan set from its manifest. */
export interface SessionPlanSetLoadResult {
  /** Plan-set id from the manifest. */
  id: string;
  /** Absolute path to the plan-set directory. */
  dir: string;
  /** Absolute path to the manifest file. */
  manifestPath: string;
  /** The parsed manifest. */
  manifest: SessionPlanSetManifest;
  /** Umbrella anchor metadata when the manifest declares an anchor. */
  anchor?: SessionPlanSetAnchorLoad;
  /** Child metadata in manifest order. */
  children: SessionPlanSetChildLoad[];
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** Diagnostic codes emitted by `validateSessionPlanSet`. */
export type SessionPlanSetDiagnosticCode =
  | 'duplicate-child-id'
  | 'duplicate-child-file'
  | 'unknown-child-dependency'
  | 'missing-anchor'
  | 'missing-child-file'
  | 'child-frontmatter-parse-error'
  | 'invalid-anchor-path'
  | 'invalid-child-path';

/** A single validation diagnostic. */
export interface SessionPlanSetDiagnostic {
  severity: 'error';
  code: SessionPlanSetDiagnosticCode;
  message: string;
  /** Child id this diagnostic relates to, when applicable. */
  childId?: string;
  /** File path this diagnostic relates to, when applicable. */
  file?: string;
  /** Unknown dependency id, when applicable. */
  dependency?: string;
  /** Resolved or declared path, when applicable. */
  path?: string;
}

// ---------------------------------------------------------------------------
// Summary (JSON-safe)
// ---------------------------------------------------------------------------

/** JSON-safe child summary. */
export interface SessionPlanSetChildSummary {
  id: string;
  file: string;
  kind: SessionPlanSetChildKind;
  buildable: boolean;
  status: SessionPlanSetStatus;
  profile?: string;
  dependsOn: string[];
  exists: boolean;
}

/** JSON-safe anchor summary. */
export interface SessionPlanSetAnchorSummary {
  file: string;
  path: string;
  exists: boolean;
}

/** JSON-safe summary of a plan set. Contains no Map values or raw content. */
export interface SessionPlanSetSummary {
  id: string;
  title: string;
  status: SessionPlanSetStatus;
  strategy: SessionPlanSetStrategy;
  anchor?: SessionPlanSetAnchorSummary;
  children: SessionPlanSetChildSummary[];
  diagnostics: SessionPlanSetDiagnostic[];
}

/** Result of validating a plan set. */
export interface SessionPlanSetValidationResult {
  ok: boolean;
  diagnostics: SessionPlanSetDiagnostic[];
  summary: SessionPlanSetSummary;
}
