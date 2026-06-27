import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function eventuallyNotRunning(
  pid: number,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 1000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await delay(intervalMs);
    } catch {
      return true;
    }
  }
  return false;
}

export async function eventuallyReadNumberFile(
  filePath: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<number> {
  const timeoutMs = options.timeoutMs ?? 250;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = (await readFile(filePath, 'utf-8')).trim();
      // A writer's `> file` redirection creates an empty file before the value
      // is written; Number('') coerces to 0, so guard against blank reads.
      if (raw !== '') {
        const value = Number(raw);
        if (Number.isFinite(value)) return value;
      }
    } catch {
      // Writers and filesystem visibility can race with test assertions.
    }
    await delay(intervalMs);
  }
  throw new Error(`number file was not written: ${filePath}`);
}

export function makeDeadPid(): number {
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    if (result.error) throw result.error;
    if (typeof result.pid !== 'number' || result.pid <= 0) {
      throw new Error('spawnSync did not return a positive child pid');
    }

    try {
      process.kill(result.pid, 0);
    } catch {
      return result.pid;
    }
  }
  throw new Error('could not create a definitely dead pid for lock tests');
}
