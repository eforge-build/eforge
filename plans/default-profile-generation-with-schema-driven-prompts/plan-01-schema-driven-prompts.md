---
id: plan-01-schema-driven-prompts
name: Schema-Driven Profile Prompts and Named Profiles
depends_on: []
branch: default-profile-generation-with-schema-driven-prompts/schema-driven-prompts
---

# Schema-Driven Profile Prompts and Named Profiles

## Architecture Context

Profile generation lets the planner synthesize custom workflow profiles. The hardcoded field list in `formatProfileGenerationSection()` can drift from the Zod schemas that validate profiles. This plan replaces the hardcoded list with schema-derived YAML documentation and adds named profile support.

## Implementation

### Overview

Three changes in one plan: (1) annotate Zod schemas with `.describe()` and export a cached `getProfileSchemaYaml()` function, (2) add `name` to `GeneratedProfileBlock` and its parser, (3) rewrite `formatProfileGenerationSection()` to use schema output and update the planner to prefer the generated name.

### Key Decisions

1. Use `z.toJSONSchema()` (available in zod v4) to convert schemas to JSON Schema, strip `$schema` and `~standard` keys, then serialize to YAML via the existing `yaml` package. Module-level cache since the schema is static.
2. The `name` field on `GeneratedProfileBlock` is optional - parser captures it when present, returns `undefined` when absent. The planner event emission prefers `generatedBlock.name ?? generatedBlock.extends ?? 'generated'`.
3. `.describe()` annotations go on `reviewProfileConfigSchema`, `agentProfileConfigSchema`, `resolvedProfileConfigSchema`, and `buildStageSpecSchema` fields - the schemas the planner prompt cares about. Descriptions are concise single-line strings explaining valid values.

## Scope

### In Scope
- Adding `.describe()` to Zod schema fields in `src/engine/config.ts`
- Exporting `getProfileSchemaYaml()` with module-level caching
- Adding `name?: string` to `GeneratedProfileBlock` in `src/engine/agents/common.ts`
- Updating `parseGeneratedProfileBlock()` to capture `name` in both extends and full-config branches
- Rewriting `formatProfileGenerationSection()` in `src/engine/agents/planner.ts` to use `getProfileSchemaYaml()`
- Updating the XML example in the prompt to include `"name"`
- Adding a rule about descriptive kebab-case names
- Updating profile event emission (line 245 in planner.ts) to prefer `generatedBlock.name`
- New tests for name capture, planner custom name usage, and `getProfileSchemaYaml()` output

### Out of Scope
- CLI flag changes (handled in plan-02)
- Queue mode changes (handled in plan-02)
- Changing profile validation logic
- Modifying built-in profile definitions

## Files

### Modify
- `src/engine/config.ts` — Add `.describe()` annotations to `reviewProfileConfigSchema`, `agentProfileConfigSchema`, `resolvedProfileConfigSchema`, and `buildStageSpecSchema` fields. Export `getProfileSchemaYaml()` function with module-level caching. Needs `import { stringify } from 'yaml'` and `import { z } from 'zod/v4'` (already imported).
- `src/engine/agents/common.ts` — Add optional `name?: string` to `GeneratedProfileBlock` interface. Update `parseGeneratedProfileBlock()` to capture `parsed.name` in both the extends and full-config return branches.
- `src/engine/agents/planner.ts` — Rewrite `formatProfileGenerationSection()` to call `getProfileSchemaYaml()` instead of hardcoding the field list. Update the XML example to include `"name"`. Add a rule about descriptive kebab-case names. Update line 245 to use `generatedBlock.name ?? generatedBlock.extends ?? 'generated'` for the profile event's `profileName`.
- `test/dynamic-profile-generation.test.ts` — Add tests: (1) `getProfileSchemaYaml()` returns valid YAML with key fields and descriptions, (2) caching returns same reference, (3) `parseGeneratedProfileBlock` captures `name` in extends mode, (4) captures `name` in full-config mode, (5) returns `undefined` when absent, (6) planner uses custom name as `profileName` in `plan:profile` event.

## Verification

- [ ] `getProfileSchemaYaml()` returns a string that `yaml.parse()` successfully parses into an object
- [ ] The parsed YAML object contains keys for `description`, `compile`, `build`, `agents`, and `review`
- [ ] Calling `getProfileSchemaYaml()` twice returns the exact same string reference (`===`)
- [ ] `parseGeneratedProfileBlock` with `{"extends":"excursion","name":"my-custom","overrides":{...}}` returns `{ extends: 'excursion', name: 'my-custom', overrides: {...} }`
- [ ] `parseGeneratedProfileBlock` with `{"config":{...},"name":"full-custom"}` returns `{ config: {...}, name: 'full-custom' }`
- [ ] `parseGeneratedProfileBlock` with `{"extends":"excursion","overrides":{}}` returns an object where `name` is `undefined`
- [ ] `runPlanner` with `generateProfile: true` and a `<generated-profile>` block containing `"name":"security-focused"` emits a `plan:profile` event with `profileName === 'security-focused'`
- [ ] `formatProfileGenerationSection()` output does not contain the old hardcoded string `"Available review fields:"`
- [ ] `pnpm test -- test/dynamic-profile-generation.test.ts` passes
- [ ] `pnpm type-check` passes
