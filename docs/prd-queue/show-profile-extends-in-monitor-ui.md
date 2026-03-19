---
title: Show profile `extends` in monitor UI
created: 2026-03-19
status: pending
---

## Problem / Motivation

Custom workflow profiles extend one of the built-in tiers (errand, excursion, expedition) or another custom profile. Currently the `extends` field is resolved away during config loading - `ResolvedProfileConfig` doesn't carry it, so the monitor UI has no way to show which base profile was extended. This makes it hard to understand a custom profile's lineage at a glance.

## Goal

Preserve the `extends` field through profile resolution and display it in the monitor UI so users can see a custom profile's lineage at a glance.

## Approach

1. **Add `extends` to `ResolvedProfileConfig` schema** (`src/engine/config.ts`) - add an optional `extends` field to `resolvedProfileConfigSchema`:

   ```typescript
   export const resolvedProfileConfigSchema = z.object({
     extends: z.string().optional().describe('Name of the profile this extends (absent for built-in profiles)'),
     description: z.string().min(1)...,
     // ... rest unchanged
   });
   ```

2. **Preserve `extends` during resolution** (`src/engine/config.ts:553-559`) - in `resolveProfileExtensions()`, set `extends` on the result object. The value comes from `partial.extends`, or implicitly from the fallback logic (built-in of same name → `'excursion'`):

   ```typescript
   const result: ResolvedProfileConfig = {
     extends: partial.extends ?? (builtins[name] ? undefined : 'excursion'),
     description: partial.description ?? base.description,
     // ... rest unchanged
   };
   ```

   Built-in profiles (when not overridden by a partial) return as-is with no `extends` field, which is correct.

3. **Add `extends` to monitor UI types** (`src/monitor/ui/src/lib/types.ts:65-71`):

   ```typescript
   export interface ProfileConfig {
     extends?: string;
     description: string;
     // ... rest unchanged
   }
   ```

4. **Display `extends` in `ProfileHeader`** (`src/monitor/ui/src/components/pipeline/thread-pipeline.tsx:232-246`) - show the extends info next to the profile badge, styled as a subtle "extends X" label using the tier color of the base profile:

   ```tsx
   <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border cursor-default ${tier.bg} ${tier.text} ${tier.border}`}>
     {profileInfo.profileName}
   </span>
   {profileInfo.config.extends && (
     <span className="text-[11px] text-text-dim">
       extends <span className={`font-medium ${getTierColor(profileInfo.config.extends).text}`}>{profileInfo.config.extends}</span>
     </span>
   )}
   <span className="text-[11px] text-text-dim">{profileInfo.config.description}</span>
   ```

## Scope

**In scope:**
- Adding optional `extends` field to `resolvedProfileConfigSchema`
- Preserving `extends` through `resolveProfileExtensions()` resolution logic
- Adding `extends` to the monitor UI `ProfileConfig` type
- Rendering the extends label in `ProfileHeader` with tier-colored styling

**Out of scope:**
- N/A

## Acceptance Criteria

- `pnpm type-check` passes with no type errors
- `pnpm test` passes - existing profile resolution tests continue to pass
- `pnpm build` produces a clean build
- Running a build with a custom profile shows "extends excursion" (or whichever base) next to the profile badge in the monitor UI
- Built-in profiles show no extends label in the monitor UI

**Files to modify:**
- `src/engine/config.ts` — schema + resolution logic
- `src/monitor/ui/src/lib/types.ts` — `ProfileConfig` interface
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` — `ProfileHeader` rendering
