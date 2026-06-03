---
id: plan-04-config-profile-tests
name: Split Config and Profile Wiring Tests
branch: reduce-and-refactor-oversized-test-files/plan-04-config-profile-tests
---

# Split Config and Profile Wiring Tests

## Architecture Context

Configuration and profile tests cover project/user/local profile scopes, schema validation, runtime profile metadata, and consumer-facing profile wiring across the Claude Code plugin and Pi extension. This plan is test-only and must not change plugin package versions, Pi package versions, config schema behavior, or consumer-facing command behavior.

## Implementation

### Overview

Split `config-backend-profile.test.ts`, `config.test.ts`, and `profile-wiring.test.ts` by config responsibility, profile scope, migration concern, and consumer surface. Extract temporary-directory and source-assertion helpers into test-only modules when repeated setup dominates the files.

### Key Decisions

1. Separate backend profile tests by project scope, user scope, migration, three-tier local resolution, metadata, and legacy parsing.
2. Separate config tests by resolving/merging/defaults, schema validation, file discovery, SDK/thinking/role schemas, extension/Pi/tier schemas, waiver config, and stack sync config.
3. Separate profile wiring tests by plugin/Pi metadata and skills, MCP/native command registration, toolbelt source assertions, docs/README assertions, and enqueue dependency/forwarding parity.

## Scope

### In Scope

- Reduce `test/config-backend-profile.test.ts`, `test/config.test.ts`, and `test/profile-wiring.test.ts` to 1,000 lines or fewer.
- Create focused helper modules for profile temp directories and source-text assertions.
- Preserve all current profile scope, metadata, migration, schema, plugin, Pi, MCP, native command, and docs assertions.

### Out of Scope

- Changes to config schemas, profile migration behavior, plugin metadata, Pi extension behavior, skills, README content, or docs content.
- Version bumps in `eforge-plugin/` or `packages/pi-eforge/`.

## Files

### Create

- `test/config-backend-profile-project.test.ts` — project-scope profile load/list/set/create/delete and config integration tests.
- `test/config-backend-profile-user.test.ts` — user-scope profile load/list/set/create/delete and edge-case tests.
- `test/config-backend-profile-migration.test.ts` — backend-to-profile auto-migration tests for project and user scopes.
- `test/config-backend-profile-local-metadata.test.ts` — three-tier local resolution, metadata parsing/listing/creation, and legacy raw config tests.
- `test/config-backend-profile-helpers.ts` — shared project/user config directory fixtures.
- `test/config-resolve.test.ts` — resolve config, merge/default, discovery, and monitor/build-field tests.
- `test/config-schema.test.ts` — strict schema, SDK/thinking/roles, extension/Pi/tier, legacy rejection, and profile name sanitization tests.
- `test/config-validation-waivers.test.ts` — validation waiver schema, merge, and acceptance/committed-changes waiver tests.
- `test/config-stacking-sync.test.ts` — stacking sync after-build config tests.
- `test/config-helpers.ts` — shared config fixture builders.
- `test/profile-wiring-plugin-pi.test.ts` — plugin metadata, profile skills, Pi skills, init parity, and scope/metadata parity tests.
- `test/profile-wiring-mcp-native.test.ts` — MCP proxy, Pi extension registration, native command modules, and skill-forwarding removal tests.
- `test/profile-wiring-toolbelt-docs.test.ts` — toolbelt preset/config source assertions and docs/README native command assertions.
- `test/profile-wiring-forwarding.test.ts` — `/eforge:init` redesign and enqueue dependency/forwarding parity tests.
- `test/profile-wiring-helpers.ts` — shared source-reading and assertion helpers.

### Modify

- `test/config-backend-profile.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/config.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/profile-wiring.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.

## Verification

- [ ] `pnpm vitest run 'test/config*.test.ts' 'test/profile-wiring*.test.ts'` exits 0.
- [ ] `find test -maxdepth 1 -type f \( -name 'config*.ts' -o -name 'profile-wiring*.ts' \) -print0 | xargs -0 wc -l | awk '$2 != "total" && $1 > 1000 { found=1; print } END { exit found }'` exits 0.
- [ ] Every original `describe(` title from the three source files appears exactly once across the resulting split files.
- [ ] The plan changes no production files and no plugin or Pi package version files.