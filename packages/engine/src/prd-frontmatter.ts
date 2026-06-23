import { z } from 'zod/v4';

const postMergeCommandSchema = z.string()
  .refine((command) => command.trim().length > 0, 'postMerge commands must be non-empty strings')
  .refine((command) => !/[\x00-\x1f\x7f]/.test(command), 'PRD frontmatter string values must not contain control characters or newlines');

export const prdFrontmatterSchema = z.object({
  title: z.string(),
  created: z.string().optional(),
  priority: z.number().int().optional(),
  depends_on: z.array(z.string()).optional(),
  skip_reason: z.string().optional(),
  held: z.boolean().optional(),
  hold_reason: z.string().optional(),
  held_at: z.string().optional(),
  profile: z.string().optional(),
  stack_id: z.string().optional(),
  stack_parent: z.string().optional(),
  stack_provider: z.literal('git-spice').optional(),
  landing: z.enum(['pr', 'merge', 'leave']).optional(),
  landing_auto_merge: z.boolean().optional(),
  postMerge: z.array(postMergeCommandSchema).optional(),
  resume_mode: z.literal('compiled').optional(),
  resume_from: z.string().min(1).optional(),
  resume_set_name: z.string().min(1).optional(),
  resume_feature_branch: z.string().min(1).optional(),
  resume_base_branch: z.string().min(1).optional(),
});

export type PrdFrontmatter = z.output<typeof prdFrontmatterSchema>;

export interface CompiledResumeFrontmatter {
  mode: 'compiled';
  sourcePrdId: string;
  setName: string;
  featureBranch: string;
  baseBranch: string;
}

export type QueuedPrdFrontmatterFieldValue = string | number | boolean | string[];

export function getCompiledResumeFrontmatter(frontmatter: PrdFrontmatter): CompiledResumeFrontmatter | undefined {
  const fields = {
    resume_mode: frontmatter.resume_mode,
    resume_from: frontmatter.resume_from,
    resume_set_name: frontmatter.resume_set_name,
    resume_feature_branch: frontmatter.resume_feature_branch,
    resume_base_branch: frontmatter.resume_base_branch,
  };
  const present = Object.values(fields).filter((value) => value !== undefined);
  if (present.length === 0) return undefined;
  if (present.length !== 5) {
    const missing = Object.entries(fields)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key)
      .join(', ');
    throw new Error(`Incomplete compiled resume frontmatter; missing: ${missing}`);
  }
  return {
    mode: fields.resume_mode,
    sourcePrdId: fields.resume_from,
    setName: fields.resume_set_name,
    featureBranch: fields.resume_feature_branch,
    baseBranch: fields.resume_base_branch,
  } as CompiledResumeFrontmatter;
}

/**
 * Extract YAML frontmatter from a markdown file.
 * Returns the parsed object or null if no frontmatter found.
 */
export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  // Simple YAML key-value parser (avoids full YAML dep for frontmatter)
  const lines = match[1].split('\n');
  const result: Record<string, unknown> = {};

  let currentListKey: string | undefined;
  for (const line of lines) {
    const listMatch = line.match(/^\s+-\s*(.*)$/);
    if (listMatch && currentListKey !== undefined) {
      (result[currentListKey] as unknown[]).push(parseFrontmatterScalar(listMatch[1].trim()));
      continue;
    }

    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)/);
    if (!kvMatch) {
      currentListKey = undefined;
      continue;
    }
    const [, key, rawValue] = kvMatch;
    const value = rawValue.trim();

    if (value === '') {
      result[key] = [];
      currentListKey = key;
      continue;
    }

    currentListKey = undefined;
    result[key] = parseFrontmatterScalar(value);
  }

  return result;
}

function parseFrontmatterScalar(value: string): unknown {
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    return inner ? inner.split(',').map((s) => parseFrontmatterScalar(s.trim())) : [];
  }
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (value === 'true' || value === 'false') return value === 'true';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Validate PRD frontmatter against the Zod schema.
 * Returns success/error result from safeParse.
 * Rejects the legacy `onSuccess` field with a migration error.
 */
export function validatePrdFrontmatter(data: unknown): z.ZodSafeParseResult<PrdFrontmatter> {
  if (data && typeof data === 'object' && 'onSuccess' in (data as object)) {
    return {
      success: false as const,
      error: new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ['onSuccess'],
        message:
          'PRD frontmatter "onSuccess" is removed. Use "landing: pr|merge|leave" instead. ' +
          'Replace onSuccess: merge-to-base-branch → landing: merge, ' +
          'onSuccess: issue-pr → landing: pr, ' +
          'onSuccess: leave-branch → landing: leave.',
      }]),
    } as z.ZodSafeParseResult<PrdFrontmatter>;
  }
  return prdFrontmatterSchema.safeParse(data);
}

export function serializeFrontmatterFieldValue(value: QueuedPrdFrontmatterFieldValue): string {
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(assertSafeFrontmatterString(item))).join(', ')}]`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return typeof value === 'number' ? String(value) : assertSafeFrontmatterString(value);
}

export function assertSafeFrontmatterString(value: string): string { if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('PRD frontmatter string values must not contain control characters or newlines'); return value; }

export function validatePostMergeCommands(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('postMerge must be an array of command strings');
  return value.map((command) => {
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new Error('postMerge commands must be non-empty strings');
    }
    return assertSafeFrontmatterString(command);
  });
}
