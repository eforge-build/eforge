import { PlaybookModeMismatchError, type Playbook } from './model.js';

export interface CompiledPlaybookBuildSource {
  name: string;
  source: string;
  goal: string;
  outOfScope: string;
  acceptanceCriteria: string;
  plannerNotes: string;
  postMerge?: string[];
  profile?: string;
}

export interface PlaybookPlanSeed {
  sessionId: string;
  topic: string;
  sections: Map<string, string>;
  seededFrom: string;
  profile?: string;
}

export function playbookToBuildSource(playbook: Playbook): CompiledPlaybookBuildSource {
  if (playbook.mode !== 'autonomous') throw new PlaybookModeMismatchError(playbook.name, 'autonomous', playbook.mode);
  const sections: string[] = [`## Goal\n\n${playbook.goal.trim()}`];
  if (playbook.outOfScope.trim()) sections.push(`## Out of scope\n\n${playbook.outOfScope.trim()}`);
  if (playbook.acceptanceCriteria.trim()) sections.push(`## Acceptance criteria\n\n${playbook.acceptanceCriteria.trim()}`);
  if (playbook.plannerNotes.trim()) sections.push(`## Notes for the planner\n\n${playbook.plannerNotes.trim()}`);
  return {
    name: playbook.name,
    source: [`# ${playbook.description}`, '', ...sections].join('\n\n'),
    goal: playbook.goal,
    outOfScope: playbook.outOfScope,
    acceptanceCriteria: playbook.acceptanceCriteria,
    plannerNotes: playbook.plannerNotes,
    postMerge: playbook.postMerge,
    ...(playbook.profile !== undefined && playbook.profile.trim().length > 0 ? { profile: playbook.profile.trim() } : {}),
  };
}

export function playbookToPlanSeed(playbook: Playbook): PlaybookPlanSeed {
  if (playbook.mode !== 'planning') throw new PlaybookModeMismatchError(playbook.name, 'planning', playbook.mode);
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const dd = now.getDate().toString().padStart(2, '0');
  const sections = new Map<string, string>();
  sections.set('goal', playbook.goal);
  sections.set('out of scope', playbook.outOfScope);
  sections.set('acceptance criteria', playbook.acceptanceCriteria);
  sections.set('notes from playbook', playbook.plannerNotes);
  return {
    sessionId: `${yyyy}-${mm}-${dd}-${playbook.name}`,
    topic: playbook.description,
    sections,
    seededFrom: playbook.name,
    ...(playbook.profile !== undefined && playbook.profile.trim().length > 0 ? { profile: playbook.profile.trim() } : {}),
  };
}
