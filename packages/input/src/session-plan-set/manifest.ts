/**
 * Deterministic parse/serialize helpers for the plan-set manifest.
 *
 * Parse failures use predictable error prefixes so callers and tests can match
 * on them:
 *  - `Invalid session plan-set manifest YAML: ...` for YAML parser exceptions
 *  - `Invalid session plan-set manifest: ...` for schema validation failures
 *
 * Serialization emits a canonical field ordering so output round-trips through
 * parse.
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  sessionPlanSetManifestSchema,
  type SessionPlanSetChild,
  type SessionPlanSetExternalRef,
  type SessionPlanSetManifest,
} from './schema.js';

/** Parse a raw `plan-set.yaml` string into a typed manifest. */
export function parseSessionPlanSetManifest(raw: string): SessionPlanSetManifest {
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    throw new Error(`Invalid session plan-set manifest YAML: ${(err as Error).message}`);
  }

  const result = sessionPlanSetManifestSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map((i) => {
      const path = i.path.length > 0 ? i.path.join('.') + ': ' : '';
      return path + i.message;
    });
    throw new Error(`Invalid session plan-set manifest: ${errors.join('; ')}`);
  }

  return result.data;
}

/**
 * Append passthrough (unknown) fields from `source` after the known fields on
 * `out`. The schemas use `.passthrough()` so future metadata is read into the
 * parsed object; preserving it here keeps serialization lossless across a
 * parse/serialize round trip. Known fields retain their canonical order and
 * unknown keys are appended in deterministic (lexicographic) order so output
 * stays diff-friendly.
 */
function appendPassthrough(
  out: Record<string, unknown>,
  source: Record<string, unknown>,
  knownKeys: readonly string[],
): Record<string, unknown> {
  const known = new Set(knownKeys);
  for (const key of Object.keys(source).sort()) {
    if (!known.has(key)) out[key] = source[key];
  }
  return out;
}

/** Serialize an external ref with canonical field order. */
function serializeExternalRef(ref: SessionPlanSetExternalRef): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: ref.kind, ref: ref.ref };
  if (ref.url !== undefined) out.url = ref.url;
  if (ref.title !== undefined) out.title = ref.title;
  appendPassthrough(out, ref as Record<string, unknown>, ['kind', 'ref', 'url', 'title']);
  return out;
}

/**
 * Serialize a child with field order:
 * `id`, `title`, `file`, `kind`, `buildable`, `status`, `profile`, `dependsOn`,
 * `externalRefs` (only when non-empty).
 */
function serializeChild(child: SessionPlanSetChild): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: child.id,
    title: child.title,
    file: child.file,
    kind: child.kind,
    buildable: child.buildable,
    status: child.status,
  };
  if (child.profile !== undefined) out.profile = child.profile;
  out.dependsOn = child.dependsOn;
  if (child.externalRefs.length > 0) {
    out.externalRefs = child.externalRefs.map(serializeExternalRef);
  }
  appendPassthrough(out, child as Record<string, unknown>, [
    'id',
    'title',
    'file',
    'kind',
    'buildable',
    'status',
    'profile',
    'dependsOn',
    'externalRefs',
  ]);
  return out;
}

/**
 * Serialize a manifest with field order:
 * `id`, `title`, `status`, `strategy`, `anchor`, `children`,
 * `externalRefs` (only when non-empty).
 */
export function serializeSessionPlanSetManifest(manifest: SessionPlanSetManifest): string {
  const out: Record<string, unknown> = {
    id: manifest.id,
    title: manifest.title,
    status: manifest.status,
    strategy: manifest.strategy,
  };
  if (manifest.anchor !== undefined) out.anchor = manifest.anchor;
  out.children = manifest.children.map(serializeChild);
  if (manifest.externalRefs.length > 0) {
    out.externalRefs = manifest.externalRefs.map(serializeExternalRef);
  }
  appendPassthrough(out, manifest as Record<string, unknown>, [
    'id',
    'title',
    'status',
    'strategy',
    'anchor',
    'children',
    'externalRefs',
  ]);
  return stringifyYaml(out, { lineWidth: 0 });
}
