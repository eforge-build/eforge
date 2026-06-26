import { describe, expect, it } from 'vitest';
import { PlaybookModeMismatchError, type Playbook } from '../model.js';
import { playbookToBuildSource, playbookToPlanSeed } from '../compile.js';

const base: Playbook = { name: 'extract-domain', description: 'Extract domain', scope: 'project-local', mode: 'autonomous', profile: '  fast  ', postMerge: ['pnpm build'], goal: 'Move code.', outOfScope: 'Do not delete old APIs.', acceptanceCriteria: '- `pnpm type-check` exits 0.', plannerNotes: 'Use local modules.' };

describe('extension-owned playbook compiler', () => {
  it('compiles autonomous playbooks to build source', () => {
    const compiled = playbookToBuildSource(base);
    expect(compiled.source).toContain('# Extract domain');
    expect(compiled.source).toContain('## Goal\n\nMove code.');
    expect(compiled.source).toContain('## Out of scope\n\nDo not delete old APIs.');
    expect(compiled.source).toContain('## Acceptance criteria');
    expect(compiled.source).toContain('## Notes for the planner\n\nUse local modules.');
    expect(compiled).toMatchObject({ name: 'extract-domain', profile: 'fast', postMerge: ['pnpm build'] });
  });

  it('omits blank autonomous sections and blank profile from build source', () => {
    const compiled = playbookToBuildSource({ ...base, profile: '  ', outOfScope: ' ', acceptanceCriteria: '', plannerNotes: '\n' });
    expect(compiled.source).toContain('## Goal\n\nMove code.');
    expect(compiled.source).not.toContain('## Out of scope');
    expect(compiled.source).not.toContain('## Acceptance criteria');
    expect(compiled.source).not.toContain('## Notes for the planner');
    expect(compiled).not.toHaveProperty('profile');
  });

  it('rejects planning playbooks as autonomous build source', () => {
    expect(() => playbookToBuildSource({ ...base, mode: 'planning' })).toThrow(PlaybookModeMismatchError);
  });

  it('extracts planning seed data', () => {
    const seed = playbookToPlanSeed({ ...base, mode: 'planning' });
    expect(seed.sessionId).toMatch(/^\d{4}-\d{2}-\d{2}-extract-domain$/);
    expect(seed).toMatchObject({ topic: 'Extract domain', seededFrom: 'extract-domain', profile: 'fast' });
    expect([...seed.sections.keys()]).toEqual(['goal', 'out of scope', 'acceptance criteria', 'notes from playbook']);
    expect(seed.sections.get('goal')).toBe('Move code.');
    expect(seed.sections.get('notes from playbook')).toBe('Use local modules.');
  });

  it('rejects autonomous playbooks as planning seeds', () => {
    expect(() => playbookToPlanSeed(base)).toThrow(PlaybookModeMismatchError);
  });
});
