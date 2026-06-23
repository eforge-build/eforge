import { PlaybookModeMismatchError, type Playbook } from './playbook.js';

/**
 * Structured seed data extracted from a planning-mode playbook.
 * Returned by `playbookToPlanSeed` and consumed by `createSessionPlanFromPlaybookSeed`.
 */
export interface PlaybookPlanSeed {
  /** Suggested session ID derived from the current date and playbook name. */
  sessionId: string;
  /** Suggested topic derived from the playbook description. */
  topic: string;
  /**
   * Section content keyed by lowercase heading slug:
   * - `'goal'` — playbook goal text
   * - `'out of scope'` — playbook out-of-scope text
   * - `'acceptance criteria'` — playbook acceptance-criteria text
   * - `'notes from playbook'` — playbook planner-notes text (heading renamed)
   */
  sections: Map<string, string>;
  /** The playbook name; used as the `seeded_from_playbook` frontmatter field. */
  seededFrom: string;
  /** Optional agent runtime profile name forwarded from playbook frontmatter. */
  profile?: string;
}

/**
 * Extract plan-seed data from a planning-mode `Playbook`.
 *
 * Throws `PlaybookModeMismatchError` when called on an `autonomous` playbook —
 * use `playbookToBuildSource` for that mode instead.
 *
 * Returns a `PlaybookPlanSeed` with a suggested session ID, topic, and a
 * sections Map keyed by lowercase heading slugs matching the session-plan
 * `parseSections` convention.
 */
export function playbookToPlanSeed(playbook: Playbook): PlaybookPlanSeed {
  if (playbook.mode !== 'planning') {
    throw new PlaybookModeMismatchError(playbook.name, 'planning', playbook.mode);
  }

  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const dd = now.getDate().toString().padStart(2, '0');
  const sessionId = `${yyyy}-${mm}-${dd}-${playbook.name}`;

  const sections = new Map<string, string>();
  sections.set('goal', playbook.goal);
  sections.set('out of scope', playbook.outOfScope);
  sections.set('acceptance criteria', playbook.acceptanceCriteria);
  sections.set('notes from playbook', playbook.plannerNotes);

  return {
    sessionId,
    topic: playbook.description,
    sections,
    seededFrom: playbook.name,
    ...(playbook.profile !== undefined && playbook.profile.trim().length > 0
      ? { profile: playbook.profile.trim() }
      : {}),
  };
}
