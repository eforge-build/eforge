import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RunInfo } from '@eforge-build/client';
import { parseAcceptSuccessAppliedMetadata } from '@eforge-build/engine/recovery/applied-sidecar';

function readAcceptedSuccessCompletedRuns(queueDir: string): Map<string, string> {
  const completedBySetName = new Map<string, string>();
  const failedDir = resolve(queueDir, 'failed');
  let entries: string[];
  try { entries = readdirSync(failedDir); } catch { return completedBySetName; }
  for (const file of entries.filter((entry) => entry.endsWith('.recovery.json'))) {
    try {
      const parsed = JSON.parse(readFileSync(resolve(failedDir, file), 'utf-8')) as { summary?: { setName?: unknown }; applied?: unknown };
      const setName = parsed.summary?.setName;
      const applied = parseAcceptSuccessAppliedMetadata(parsed.applied);
      if (typeof setName === 'string' && applied?.landing.status === 'complete') {
        completedBySetName.set(setName, applied.acceptedAt);
      }
    } catch {
      // Ignore malformed sidecars in read-time projections.
    }
  }
  return completedBySetName;
}

export function projectRunsForAcceptedSuccess(runs: RunInfo[], queueDir?: string): RunInfo[] {
  if (!queueDir) return runs;
  const completedBySetName = readAcceptedSuccessCompletedRuns(queueDir);
  if (completedBySetName.size === 0) return runs;
  return runs.map((run) => {
    const completedAt = completedBySetName.get(run.planSet);
    if (!completedAt || run.status !== 'failed' || !['build', 'resume', 'run'].includes(run.command)) return run;
    return { ...run, status: 'completed', completedAt };
  });
}
