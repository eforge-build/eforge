import type { ShardScope } from '../../config.js';

export function shardClaimsFile(shard: ShardScope, file: string): boolean {
  if (shard.roots) {
    for (const root of shard.roots) {
      const prefix = root.endsWith('/') ? root : `${root}/`;
      if (file.startsWith(prefix) || file === root) return true;
    }
  }
  if (shard.files) {
    for (const f of shard.files) {
      if (file === f) return true;
    }
  }
  return false;
}

/**
 * Enforce that all staged files are claimed by exactly one shard.
 * Returns ok:true when all files match exactly one shard.
 * Returns ok:false with reason and offending files when:
 * - 'unclaimed': a file is not claimed by any shard
 * - 'overlap': a file is claimed by multiple shards (includes claiming shard IDs)
 */
export function enforceShardScope(
  stagedFiles: string[],
  shards: ShardScope[],
): { ok: true } | { ok: false; reason: 'unclaimed' | 'overlap'; files: string[]; shardIds?: string[][] } {
  const unclaimedFiles: string[] = [];
  const overlappingFiles: string[] = [];
  const overlappingShardIds: string[][] = [];

  for (const file of stagedFiles) {
    const claimingShards = shards.filter((s) => shardClaimsFile(s, file));
    if (claimingShards.length === 0) {
      unclaimedFiles.push(file);
    } else if (claimingShards.length > 1) {
      overlappingFiles.push(file);
      overlappingShardIds.push(claimingShards.map((s) => s.id));
    }
  }

  if (unclaimedFiles.length > 0) return { ok: false, reason: 'unclaimed', files: unclaimedFiles };
  if (overlappingFiles.length > 0) return { ok: false, reason: 'overlap', files: overlappingFiles, shardIds: overlappingShardIds };
  return { ok: true };
}
