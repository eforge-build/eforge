import { describe, expect, it } from 'vitest';
import { extractChangelogReleaseNotes } from '../.pi/extensions/eforge-dev/release-notes.js';

describe('eforge-dev release notes', () => {
  it('extracts the complete current changelog section', () => {
    const changelog = `# Changelog

## [0.8.0] - 2026-07-12

### Features

- First feature
- Second feature

### Fixes

- Release fix

## [0.7.21] - 2026-05-20

Older release
`;

    expect(extractChangelogReleaseNotes(changelog, '0.8.0')).toBe(`### Features

- First feature
- Second feature

### Fixes

- Release fix`);
  });

  it('extracts the final section when no older release follows it', () => {
    const changelog = `# Changelog

## [0.8.0] - 2026-07-12

Maintenance release
`;

    expect(extractChangelogReleaseNotes(changelog, '0.8.0')).toBe('Maintenance release');
  });
});
