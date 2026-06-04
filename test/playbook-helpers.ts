export function validPlaybookRaw(opts: {
  name?: string;
  description?: string;
  scope?: string;
  mode?: string;
  goal?: string;
  profile?: string;
  acceptanceCriteria?: string;
} = {}): string {
  const {
    name = 'my-feature',
    description = 'Add the my-feature capability',
    scope = 'project-team',
    mode = 'autonomous',
    goal = 'Implement the feature.',
    profile,
    acceptanceCriteria,
  } = opts;
  const lines = ['---', `name: ${name}`, `description: ${description}`, `scope: ${scope}`, `mode: ${mode}`];
  if (profile) lines.push(`profile: ${profile}`);
  lines.push('---', '', '## Goal', '', goal);
  if (acceptanceCriteria !== undefined) lines.push('', '## Acceptance Criteria', '', acceptanceCriteria);
  return lines.join('\n');
}
