import { getWorktreeDirtyFiles } from '../worktree-ops.js';

export type ValidationCommandFailure = { command: string; exitCode: number; output: string };

export async function detectValidationDirtyWorktree(
  mergeWorktreePath: string,
  command: string,
  reason: string,
  commandOutput?: string,
): Promise<ValidationCommandFailure | undefined> {
  const dirtyFiles = await getValidationDirtyFiles(mergeWorktreePath);
  if (dirtyFiles.length === 0) return undefined;

  const preview = dirtyFiles.slice(0, 10).join('\n');
  const suffix = dirtyFiles.length > 10 ? `\n... and ${dirtyFiles.length - 10} more files` : '';
  const outputPrefix = commandOutput?.trim() ? `${commandOutput.trim()}\n\n` : '';
  return {
    command,
    exitCode: 1,
    output: `${outputPrefix}Validation detected a dirty merge worktree ${reason}. Dirty files:\n${preview}${suffix}`,
  };
}

async function getValidationDirtyFiles(mergeWorktreePath: string): Promise<string[]> {
  try {
    return await getWorktreeDirtyFiles(mergeWorktreePath);
  } catch {
    return [];
  }
}
