import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ROUTES, buildProfileListPath } from '@eforge-build/client';

const REPO_ROOT = process.cwd();
const EFORGE_PLAN_DIR = join(REPO_ROOT, 'eforge', 'extensions', 'eforge-plan');
const PI_EFORGE_DIR = join(REPO_ROOT, 'packages', 'pi-eforge', 'extensions', 'eforge');

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_SOURCE_EXTENSIONS = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const IGNORED_PARTS = new Set(['node_modules', 'dist', '.next', 'coverage', '__tests__', 'workstation-assets', '.storybook', 'storybook-static', 'stories', 'fixtures']);

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  function visit(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (IGNORED_PARTS.has(entry)) continue;
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) visit(path);
      else if (SOURCE_EXTENSIONS.test(entry) && !TEST_SOURCE_EXTENSIONS.test(entry)) files.push(path);
    }
  }
  visit(root);
  return files;
}

function readSource(files: string[]): Array<{ path: string; source: string }> {
  return files.map((path) => ({ path: relative(REPO_ROOT, path), source: readFileSync(path, 'utf-8') }));
}

describe('profile-list client contract boundary', () => {
  it('centralizes profile-list route construction in @eforge-build/client', () => {
    expect(API_ROUTES.profileList).toBe('/api/profile/list');
    expect(buildProfileListPath()).toBe(API_ROUTES.profileList);
    expect(buildProfileListPath({ scope: 'local' })).toBe(`${API_ROUTES.profileList}?scope=local`);
    expect(buildProfileListPath({ scope: 'all' })).toBe(`${API_ROUTES.profileList}?scope=all`);
  });

  it('keeps eforge-plan product code away from private profile discovery and wire DTOs', () => {
    const sources = readSource(listSourceFiles(EFORGE_PLAN_DIR));
    const forbidden = [
      /['"]\/api\/profile(?:\/list)?['"]/,
      /profile\/list/,
      /\b(?:listProfiles|loadProfile|loadUserProfile|getConfigDir|getConventionalConfigDir|resolveActiveProfileName|resolveUserActiveProfile)\b/,
      /^\s*(?:export\s+)?(?:interface|type)\s+(?:AgentRuntimeProfileInfo|ProfileListResponse|ProfileListData|ProfileEntry)\b(?=\s*(?:=|extends|\{))/m,
      /(?:['"`][^'"`]*(?:\.?eforge\/profiles|\.config\/eforge\/profiles)[^'"`]*['"`])|(?:\b(?:readdir|glob|fastGlob|fg)\b[\s\S]{0,200}\bprofiles\b)|(?:\bprofiles\b[\s\S]{0,200}\b(?:readdir|glob|fastGlob|fg)\b)/,
    ];

    for (const { path, source } of sources) {
      for (const pattern of forbidden) {
        expect(source, `${path} must consume the shared client profile-list contract instead of ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('keeps the Pi extension from declaring local profile-list wire DTOs or hand-building list URLs', () => {
    const sources = readSource(listSourceFiles(PI_EFORGE_DIR));
    for (const { path, source } of sources) {
      expect(source, `${path} must use profile-list wire types from @eforge-build/client instead of declaring local DTOs`).not.toMatch(/^\s*(?:export\s+)?(?:interface|type)\s+(?:ProfileListData|ProfileEntry|AgentRuntimeProfileInfo|ProfileListResponse)\b(?=\s*(?:=|extends|\{))/m);
      expect(source, `${path} must use buildProfileListPath for profile-list query URLs`).not.toMatch(/API_ROUTES\.profileList\s*(?:[+?;:]|\?\?|&&|\|\||`|\$\{|\.concat)|profile\/list/);
      expect(source, `${path} must not hard-code profile API route literals`).not.toMatch(/['"]\/api\/profile(?:\/list)?['"]/);
    }
  });
});
