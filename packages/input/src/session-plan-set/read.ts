/**
 * Read helpers for session plan sets.
 *
 * Membership is canonical to the manifest: `listSessionPlanSets` discovers
 * directories containing a valid `plan-set.yaml`, and `loadSessionPlanSet` reads
 * only the umbrella anchor and child files named by the manifest. Readers never
 * recursively discover child plans as a second membership source.
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseSessionPlanSetManifest } from './manifest.js';
import {
  resolveSessionPlanSetAnchorPath,
  resolveSessionPlanSetChildPath,
  resolveSessionPlanSetDir,
  resolveSessionPlanSetManifestPath,
  resolveSessionPlanSetsRoot,
} from './paths.js';
import {
  SESSION_PLAN_SET_MANIFEST_FILENAME,
  type SessionPlanSetAnchorLoad,
  type SessionPlanSetChild,
  type SessionPlanSetChildLoad,
  type SessionPlanSetListEntry,
  type SessionPlanSetLoadResult,
} from './schema.js';

export interface ListSessionPlanSetsOpts {
  cwd: string;
}

/**
 * List immediate directories under `.eforge/session-plans/` that contain a
 * valid `plan-set.yaml` manifest. Flat markdown files and directories without a
 * valid manifest are skipped. Results are sorted by manifest id.
 */
export async function listSessionPlanSets(opts: ListSessionPlanSetsOpts): Promise<SessionPlanSetListEntry[]> {
  const root = resolveSessionPlanSetsRoot(opts.cwd);

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    // The session-plans directory may legitimately not exist yet; callers
    // treat that as an empty collection. Any other filesystem failure
    // (permissions, ENOTDIR, etc.) is an operational error and is surfaced
    // rather than masked as an empty collection.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const results: SessionPlanSetListEntry[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory()) return;
      const dir = resolve(root, entry.name);
      const manifestPath = resolve(dir, SESSION_PLAN_SET_MANIFEST_FILENAME);

      let raw: string;
      try {
        raw = await readFile(manifestPath, 'utf-8');
      } catch {
        return;
      }

      let manifest;
      try {
        manifest = parseSessionPlanSetManifest(raw);
      } catch {
        return;
      }

      // loadSessionPlanSet resolves a plan set by its directory name, which may
      // diverge from the manifest id. Expose the directory name as `planSetId`
      // so callers can load the set even when the manifest id differs, rather
      // than silently dropping an otherwise-valid manifest.
      results.push({
        id: manifest.id,
        planSetId: entry.name,
        title: manifest.title,
        status: manifest.status,
        strategy: manifest.strategy,
        dir,
        manifestPath,
        childCount: manifest.children.length,
      });
    }),
  );

  results.sort((a, b) => a.id.localeCompare(b.id));
  return results;
}

/**
 * Split a leading YAML frontmatter block from child markdown.
 * Returns the parsed frontmatter record, or an `error` string when the
 * frontmatter block is present but fails to parse as YAML.
 */
function splitChildFrontmatter(
  content: string,
): { frontmatter?: Record<string, unknown> } | { error: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {};
  }
  try {
    const parsed = parseYaml(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown> };
    }
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Load the umbrella anchor metadata for a plan set. */
async function loadAnchor(cwd: string, planSetId: string, anchor: string): Promise<SessionPlanSetAnchorLoad> {
  let path: string;
  try {
    path = resolveSessionPlanSetAnchorPath({ cwd, planSetId, anchor });
  } catch (err) {
    return { anchor, path: '', exists: false, pathError: (err as Error).message };
  }
  try {
    const content = await readFile(path, 'utf-8');
    return { anchor, path, exists: true, content };
  } catch {
    return { anchor, path, exists: false };
  }
}

/** Load metadata for a single manifest-declared child. */
async function loadChild(cwd: string, planSetId: string, child: SessionPlanSetChild): Promise<SessionPlanSetChildLoad> {
  let path: string;
  try {
    path = resolveSessionPlanSetChildPath({ cwd, planSetId, childFile: child.file });
  } catch (err) {
    return { child, path: '', file: child.file, exists: false, pathError: (err as Error).message };
  }

  let content: string;
  try {
    content = await readFile(path, 'utf-8');
  } catch {
    return { child, path, file: child.file, exists: false };
  }

  const result: SessionPlanSetChildLoad = { child, path, file: child.file, exists: true, content };
  const fm = splitChildFrontmatter(content);
  if ('error' in fm) {
    result.frontmatterError = fm.error;
  } else if (fm.frontmatter !== undefined) {
    result.frontmatter = fm.frontmatter;
  }
  return result;
}

export interface LoadSessionPlanSetOpts {
  cwd: string;
  planSetId: string;
}

/**
 * Load a plan set from its manifest, umbrella anchor, and manifest-declared
 * child files in manifest order. Throws only when the manifest itself cannot be
 * read or parsed; per-anchor and per-child errors are captured in the result so
 * validation can report them as diagnostics.
 */
export async function loadSessionPlanSet(opts: LoadSessionPlanSetOpts): Promise<SessionPlanSetLoadResult> {
  const dir = resolveSessionPlanSetDir(opts);
  const manifestPath = resolveSessionPlanSetManifestPath(opts);
  const raw = await readFile(manifestPath, 'utf-8');
  const manifest = parseSessionPlanSetManifest(raw);

  let anchor: SessionPlanSetAnchorLoad | undefined;
  if (manifest.anchor !== undefined) {
    anchor = await loadAnchor(opts.cwd, opts.planSetId, manifest.anchor);
  }

  const children = await Promise.all(
    manifest.children.map((child) => loadChild(opts.cwd, opts.planSetId, child)),
  );

  const result: SessionPlanSetLoadResult = {
    id: manifest.id,
    dir,
    manifestPath,
    manifest,
    children,
  };
  if (anchor !== undefined) {
    result.anchor = anchor;
  }
  return result;
}
