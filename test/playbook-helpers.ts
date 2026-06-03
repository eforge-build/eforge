export function validPlaybookRaw(opts: {
  name?: string;
  description?: string;
  scope?: string;
  mode?: string;
  goal?: string;
  profile?: string;
} = {}): string {
  const {
    name = 'my-feature',
    description = 'Add the my-feature capability',
    scope = 'project-team',
    mode = 'autonomous',
    goal = 'Implement the feature.',
    profile,
  } = opts;
  const lines = ['---', `name: ${name}`, `description: ${description}`, `scope: ${scope}`, `mode: ${mode}`];
  if (profile) lines.push(`profile: ${profile}`);
  lines.push('---', '', '## Goal', '', goal);
  return lines.join('\n');
}
