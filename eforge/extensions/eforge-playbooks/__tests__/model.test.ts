import { describe, expect, it } from 'vitest';
import { parsePlaybook, serializePlaybook, validatePlaybook } from '../model.js';
import { rawPlaybook } from './helpers.js';

describe('extension-owned playbook model', () => {
  it('parses valid playbooks and defaults optional sections', () => {
    const playbook = parsePlaybook(rawPlaybook({ name: 'demo-plan', scope: 'project-local', mode: 'planning', profile: 'team' }));
    expect(playbook).toMatchObject({ name: 'demo-plan', description: 'demo-plan description', scope: 'project-local', mode: 'planning', profile: 'team', outOfScope: '', goal: 'Ship demo-plan.' });
  });

  it('reports invalid frontmatter and missing goal through validatePlaybook', () => {
    for (const raw of [
      rawPlaybook({ name: 'bad', scope: 'project-local' }).replace('name: bad\n', ''),
      rawPlaybook({ name: 'bad', scope: 'project-local' }).replace('description: bad description\n', ''),
      rawPlaybook({ name: 'bad', scope: 'project-local' }).replace('scope: project-local\n', ''),
      rawPlaybook({ name: 'bad', scope: 'project-local' }).replace('mode: autonomous\n', ''),
      rawPlaybook({ name: 'bad', scope: 'project-local' }).replace('## Goal', '## Objective'),
    ]) expect(validatePlaybook(raw).ok).toBe(false);
  });

  it('returns validation errors for malformed YAML frontmatter', () => {
    const raw = rawPlaybook({ name: 'bad-yaml', scope: 'project-local' }).replace('description: bad-yaml description', 'description: [unterminated');
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected');
    expect(result.errors[0]).toContain('Invalid YAML frontmatter');
    expect(() => parsePlaybook(raw)).toThrow(/Invalid playbook: Invalid YAML frontmatter/);
  });

  it('rejects malformed scalar and postMerge values', () => {
    expect(validatePlaybook(rawPlaybook({ name: 'BadName', scope: 'project-local' })).ok).toBe(false);
    expect(validatePlaybook(rawPlaybook({ name: 'bad-scalar', scope: 'project-local' }).replace('description: bad-scalar description', 'description: "bad\\nvalue"')).ok).toBe(false);
    expect(validatePlaybook(rawPlaybook({ name: 'empty-post', scope: 'project-local', postMerge: [''] })).ok).toBe(false);
    expect(validatePlaybook(rawPlaybook({ name: 'bad-post', scope: 'project-local' }).replace('mode: autonomous', 'mode: autonomous\npostMerge:\n  - "bad\\nvalue"')).ok).toBe(false);
  });

  it('serializes and round-trips modes, profile trimming, and postMerge', () => {
    const raw = serializePlaybook({ name: 'round-trip', description: 'Round trip', scope: 'user', mode: 'autonomous', profile: '  fast  ', postMerge: ['pnpm build'], goal: 'Ship.', outOfScope: '', acceptanceCriteria: '', plannerNotes: 'Notes.' });
    expect(raw).toContain('profile: fast');
    expect(raw).toContain('postMerge:');
    expect(parsePlaybook(raw)).toMatchObject({ name: 'round-trip', mode: 'autonomous', profile: 'fast', postMerge: ['pnpm build'] });
    expect(serializePlaybook({ name: 'planning-one', description: 'Planning', scope: 'user', mode: 'planning', profile: ' ', goal: 'Plan.', outOfScope: '', acceptanceCriteria: '', plannerNotes: '' })).not.toContain('profile:');
  });
});
