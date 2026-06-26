import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod/v4';

export const playbookScopeSchema = z.enum(['user', 'project-team', 'project-local']);
export type PlaybookScope = z.output<typeof playbookScopeSchema>;

const frontmatterScalarSchema = z.string()
  .refine((value) => !/[\x00-\x1F\x7F]/.test(value), 'must not contain control characters or newlines');

const postMergeCommandSchema = z.string()
  .refine((command) => command.trim().length > 0, 'postMerge commands must be non-empty strings')
  .refine((command) => !/[\x00-\x1F\x7F]/.test(command), 'postMerge commands must not contain control characters or newlines');

export const playbookFrontmatterSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case'),
  description: frontmatterScalarSchema.refine((value) => value.trim().length > 0, 'description must be non-empty'),
  scope: playbookScopeSchema,
  mode: z.enum(['autonomous', 'planning']),
  profile: frontmatterScalarSchema.optional(),
  postMerge: z.array(postMergeCommandSchema).optional(),
});

export type PlaybookFrontmatter = z.output<typeof playbookFrontmatterSchema>;
export type PlaybookMode = z.output<typeof playbookFrontmatterSchema>['mode'];

export interface PlaybookBody {
  goal: string;
  outOfScope: string;
  acceptanceCriteria: string;
  plannerNotes: string;
}

export interface Playbook extends PlaybookFrontmatter, PlaybookBody {}

export class PlaybookModeMismatchError extends Error {
  constructor(name: string, expected: PlaybookMode, actual: PlaybookMode) {
    super(
      `Playbook "${name}" has mode "${actual}" but "${expected}" was expected. `
      + `Use ${actual === 'autonomous' ? 'playbookToBuildSource' : 'playbookToPlanSeed'} for this playbook.`,
    );
    this.name = 'PlaybookModeMismatchError';
  }
}

export function splitFrontmatter(raw: string): [Record<string, unknown>, string] {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)/);
  if (!match) return [{}, raw];
  const fm = parseYaml(match[1]);
  return [fm && typeof fm === 'object' ? (fm as Record<string, unknown>) : {}, match[2]];
}

const SECTION_MAP: Record<string, keyof PlaybookBody> = {
  goal: 'goal',
  'out of scope': 'outOfScope',
  'acceptance criteria': 'acceptanceCriteria',
  'notes for the planner': 'plannerNotes',
};

function parseBody(bodyText: string): PlaybookBody | { error: string } {
  const sections: Partial<PlaybookBody> = {};
  const lines = bodyText.split(/\r?\n/);
  let currentField: keyof PlaybookBody | null = null;
  const currentLines: string[] = [];

  function flush() {
    if (currentField !== null) sections[currentField] = currentLines.join('\n').trim();
    currentLines.length = 0;
  }

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentField = SECTION_MAP[headingMatch[1].trim().toLowerCase()] ?? null;
    } else if (currentField !== null) {
      currentLines.push(line);
    }
  }
  flush();

  if (sections.goal === undefined) return { error: 'Missing required section: ## Goal' };
  if (sections.goal.trim().length === 0) return { error: 'Required section must be non-empty: ## Goal' };
  return {
    goal: sections.goal,
    outOfScope: sections.outOfScope ?? '',
    acceptanceCriteria: sections.acceptanceCriteria ?? '',
    plannerNotes: sections.plannerNotes ?? '',
  };
}

function parsePlaybookInternal(raw: string): { ok: true; playbook: Playbook } | { ok: false; errors: string[] } {
  let fm: Record<string, unknown>;
  let bodyText: string;
  try {
    [fm, bodyText] = splitFrontmatter(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`Invalid YAML frontmatter: ${message}`] };
  }
  const fmResult = playbookFrontmatterSchema.safeParse(fm);
  if (!fmResult.success) {
    return {
      ok: false,
      errors: fmResult.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        return path + issue.message;
      }),
    };
  }
  const bodyResult = parseBody(bodyText);
  if ('error' in bodyResult) return { ok: false, errors: [bodyResult.error] };
  return { ok: true, playbook: { ...fmResult.data, ...bodyResult } };
}

export function parsePlaybook(raw: string): Playbook {
  const result = parsePlaybookInternal(raw);
  if (!result.ok) throw new Error(`Invalid playbook: ${result.errors.join('; ')}`);
  return result.playbook;
}

export function serializePlaybook(playbook: Playbook): string {
  const fm: Record<string, unknown> = {
    name: playbook.name,
    description: playbook.description,
    scope: playbook.scope,
    mode: playbook.mode,
  };
  if (playbook.profile !== undefined && playbook.profile.trim().length > 0) fm.profile = playbook.profile.trim();
  if (playbook.postMerge !== undefined && playbook.postMerge.length > 0) fm.postMerge = playbook.postMerge;
  const sections: string[] = [`## Goal\n\n${playbook.goal.trim()}`];
  if (playbook.outOfScope.trim()) sections.push(`## Out of scope\n\n${playbook.outOfScope.trim()}`);
  if (playbook.acceptanceCriteria.trim()) sections.push(`## Acceptance criteria\n\n${playbook.acceptanceCriteria.trim()}`);
  if (playbook.plannerNotes.trim()) sections.push(`## Notes for the planner\n\n${playbook.plannerNotes.trim()}`);
  return ['---', stringifyYaml(fm, { lineWidth: 0 }).trimEnd(), '---', '', sections.join('\n\n'), ''].join('\n');
}

export function validatePlaybook(raw: string): { ok: true; playbook: Playbook } | { ok: false; errors: string[] } {
  return parsePlaybookInternal(raw);
}
