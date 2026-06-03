import { describe, it, expect } from 'vitest';
import { extractOwnerRepo, projectLabelFromContext } from '@/lib/selectors/project-label';

describe('extractOwnerRepo', () => {
  it('parses an https GitHub remote', () => {
    expect(extractOwnerRepo('https://github.com/eforge-build/eforge.git')).toBe('eforge-build/eforge');
  });

  it('parses an ssh GitHub remote without the .git suffix', () => {
    expect(extractOwnerRepo('git@github.com:eforge-build/eforge')).toBe('eforge-build/eforge');
  });

  it('returns null for a non-GitHub remote', () => {
    expect(extractOwnerRepo('https://gitlab.com/foo/bar.git')).toBeNull();
  });
});

describe('projectLabelFromContext', () => {
  it('returns null when context is absent', () => {
    expect(projectLabelFromContext(null)).toBeNull();
    expect(projectLabelFromContext(undefined)).toBeNull();
  });

  it('prefers owner/repo from the git remote', () => {
    expect(
      projectLabelFromContext({ cwd: '/home/me/projects/eforge', gitRemote: 'git@github.com:eforge-build/eforge.git' }),
    ).toBe('eforge-build/eforge');
  });

  it('falls back to the cwd basename when the remote is missing', () => {
    expect(projectLabelFromContext({ cwd: '/home/me/projects/eforge', gitRemote: null })).toBe('eforge');
  });

  it('falls back to the cwd basename when the remote is unrecognized', () => {
    expect(
      projectLabelFromContext({ cwd: '/home/me/projects/eforge', gitRemote: 'https://example.com/x/y.git' }),
    ).toBe('eforge');
  });

  it('returns null when neither remote nor cwd yields a label', () => {
    expect(projectLabelFromContext({ cwd: null, gitRemote: null })).toBeNull();
  });
});
