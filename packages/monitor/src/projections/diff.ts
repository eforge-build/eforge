import type { DiffResponse } from '@eforge-build/client';
import type { MonitorDB } from '../db.js';

export function buildDiffResponse(db: MonitorDB, sessionId: string, planId: string, filePath?: string): DiffResponse {
  if (filePath) {
    const record = db.getFileDiff(sessionId, planId, filePath);
    return { diff: record?.diffText ?? null };
  }
  return { files: db.getFileDiffs(sessionId, planId).map((r) => ({ path: r.filePath, diff: r.diffText })) };
}
