// --- eforge:region plan-02-concise-recovery-sidecar-contract ---
/**
 * Writes recovery sidecar files alongside a failed PRD:
 *   <prdId>.recovery.md   — concise operator report with detailed evidence below
 *   <prdId>.recovery.json — machine-readable v3 recovery sidecar contract
 *
 * Both files are written atomically via write-to-temp-then-rename (POSIX-safe).
 */

import { writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildFailureSummary, RecoveryVerdict } from '../events.js';
import { buildRecoverySidecarPayload } from './sidecar-payload.js';
import { renderRecoverySidecarMarkdown } from './sidecar-markdown.js';

/**
 * Write `.recovery.md` and `.recovery.json` sidecar files next to the failed PRD.
 *
 * @param failedPrdDir - Directory that contains (or will contain) the sidecar files
 * @param prdId - PRD identifier, used as the filename stem
 * @param summary - Build failure summary assembled by `buildFailureSummary`
 * @param verdict - Parsed recovery verdict from the recovery-analyst agent
 * @returns Absolute paths to the two written files
 */
export async function writeRecoverySidecar({
  failedPrdDir,
  prdId,
  summary,
  verdict,
}: {
  failedPrdDir: string;
  prdId: string;
  summary: BuildFailureSummary;
  verdict: RecoveryVerdict;
}): Promise<{ mdPath: string; jsonPath: string }> {
  const mdPath = join(failedPrdDir, `${prdId}.recovery.md`);
  const jsonPath = join(failedPrdDir, `${prdId}.recovery.json`);

  await mkdir(failedPrdDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const payload = buildRecoverySidecarPayload({ prdId, summary, verdict, generatedAt });

  const jsonTmp = jsonPath + '.tmp';
  await writeFile(jsonTmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  await rename(jsonTmp, jsonPath);

  const mdTmp = mdPath + '.tmp';
  await writeFile(mdTmp, renderRecoverySidecarMarkdown(payload), 'utf-8');
  await rename(mdTmp, mdPath);

  return { mdPath, jsonPath };
}
// --- eforge:endregion plan-02-concise-recovery-sidecar-contract ---
