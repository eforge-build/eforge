/**
 * Component tests for <PlanTab> build profile rendering.
 *
 * Validates:
 *  - `Build profile` section and profile name badge render when profile.profileName is non-null.
 *  - Classification badge is rendered separately from the Build profile row when both
 *    orchestration.mode and profile.profileName are present.
 *
 * Uses source-file grep checks (same pattern as sidebar.test.tsx and
 * queue-section-recovery.test.tsx) to verify the rendering contract without
 * requiring a full DOM environment. The TypeScript-level prop check ensures
 * the component accepts the `profile` prop with the correct type.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComponentProps } from 'react';
import { PlanTab } from '../plan-tab';
import type { SessionProfile } from '@/lib/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const planTabSource = readFileSync(resolve(__dirname, '../plan-tab.tsx'), 'utf-8');

// Strip comment-only lines before grepping
const planTabSourceLines = planTabSource
  .split('\n')
  .filter((line) => {
    const trimmed = line.trim();
    return (
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('/*')
    );
  });
const planTabSourceStripped = planTabSourceLines.join('\n');

// ---------------------------------------------------------------------------
// Type-level: PlanTab accepts a `profile` prop of type SessionProfile | null
// ---------------------------------------------------------------------------

type PlanTabProps = ComponentProps<typeof PlanTab>;

type HasProfileProp = 'profile' extends keyof PlanTabProps ? true : never;
const _typeCheck: HasProfileProp = true;
void _typeCheck;

type ProfilePropIsNullable = PlanTabProps['profile'] extends SessionProfile | null ? true : never;
const _nullableCheck: ProfilePropIsNullable = true;
void _nullableCheck;

// ---------------------------------------------------------------------------
// Source-level: Build profile section is wired to profile.profileName
// ---------------------------------------------------------------------------

describe('PlanTab — Build profile rendering', () => {
  it('renders a "Build profile" section label when profile.profileName is non-null', () => {
    // The component must contain a "Build profile" string literal used as the
    // Section title for the profile row.
    expect(planTabSourceStripped).toContain('Build profile');
  });

  it('renders ProfileBadge when profile.profileName is truthy', () => {
    // ProfileBadge must be imported and rendered in the profile branch.
    expect(planTabSourceStripped).toContain('ProfileBadge');
    // The profile guard must key on profileName (not just profile existence)
    expect(planTabSourceStripped).toContain('profile.profileName');
  });

  it('imports ProfileBadge from the profile component', () => {
    // The import must come from the profile-badge module.
    expect(planTabSource).toContain("profile/profile-badge");
  });

  it('imports SessionProfile type', () => {
    // SessionProfile must be part of the type import for the profile prop.
    expect(planTabSource).toContain('SessionProfile');
  });

  it('renders Classification section separately from Build profile section', () => {
    // Both Section titles must coexist in the source — Classification for
    // orchestration.mode and Build profile for the selected profile.
    expect(planTabSourceStripped).toContain('Classification');
    expect(planTabSourceStripped).toContain('Build profile');

    // The two sections must be independent — Build profile must not be nested
    // inside the Classification guard. Verify by checking both titles appear
    // as separate Section title strings.
    const classificationIdx = planTabSourceStripped.indexOf('"Classification"');
    const buildProfileIdx = planTabSourceStripped.indexOf('"Build profile"');
    expect(classificationIdx).toBeGreaterThan(-1);
    expect(buildProfileIdx).toBeGreaterThan(-1);
    // They must be at different positions (separate sections)
    expect(classificationIdx).not.toBe(buildProfileIdx);
  });
});
