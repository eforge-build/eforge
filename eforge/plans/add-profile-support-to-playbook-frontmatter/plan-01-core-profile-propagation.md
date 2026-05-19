---
id: plan-01-core-profile-propagation
name: Core Playbook Profile Propagation
branch: add-profile-support-to-playbook-frontmatter/plan-01-core-profile-propagation
---

# Core Playbook Profile Propagation

## Architecture Context

Playbooks and session plans are reusable input artifacts owned by `@eforge-build/input`. The engine queue already has explicit PRD profile semantics through `enqueuePrd({ profile })`, and the scheduler already treats queued PRD `frontmatter.profile` as the highest-precedence runtime profile signal. This plan extends the input artifact schemas and daemon/CLI enqueue boundary so playbook profile metadata lands in that existing queue path.

Key constraints:
- Playbook `profile` names an agent runtime profile, not the session workflow profile.
- Session plan `profile` remains the planning workflow profile (`errand`, `excursion`, `expedition`, or `null`).
- Inherited agent runtime profile metadata in session plans uses `agent_profile`.
- Profile existence is validated when enqueue/build/run execution uses the profile, not when a playbook or draft session plan is saved.

## Implementation

### Overview

Add `profile?: string` to playbook parsing/serialization/build-source output and add `agent_profile?: string` to session-plan frontmatter. Make autonomous playbook runs validate and pass the profile to `enqueuePrd()`. Make session-plan normalization and preprocessing surface inherited `agent_profile` metadata, and make daemon + CLI enqueue/build paths pass that metadata as the same per-build profile override used by existing explicit profile support.

### Key Decisions

1. Use `profile` in playbook frontmatter because it matches existing runtime profile terminology (`eforge enqueue --profile`, queued PRD `profile:` frontmatter, active profile markers, and profile routers).
2. Use `agent_profile` in session-plan frontmatter because `profile` is already the workflow profile signal in `packages/input/src/session-plan.ts`.
3. Explicit request/CLI profile overrides win over inherited session-plan `agent_profile`; inherited profile is used only when no explicit override is provided.
4. `normalizeBuildSource()` returns metadata rather than embedding profile text into the normalized PRD body, keeping engine queue frontmatter as the single execution signal.

## Scope

### In Scope

- Parse, validate, serialize, list, load, copy, and save playbooks with optional `profile`.
- Forward autonomous playbook `profile` to `enqueuePrd()` after validating the profile exists.
- Add session-plan `agent_profile` parsing/serialization and seed it from planning-mode playbooks.
- Extend session-plan create helpers/routes so investigation-first playbook flows can create a session plan with `agent_profile` without requiring profile existence at draft time.
- Return inherited profile metadata from `normalizeBuildSource()` and `preprocessBuildSource()`.
- Use inherited profile metadata in daemon `/api/enqueue`, CLI `enqueue`, and CLI `build` when no explicit profile was supplied.
- Add `--profile` support to direct `eforge build` if absent, and ensure daemon delegation passes explicit profile requests.
- Bump `DAEMON_API_VERSION` because wire shapes gain optional profile fields.
- Core tests for parsing, serialization, normalization, daemon enqueue, autonomous playbook run, and explicit override precedence.

### Out of Scope

- No `eforge playbook run --profile` or `eforge_playbook.run profile` override.
- No changes to profile-router selection behavior beyond relying on existing explicit queued PRD profile precedence.
- No save-time validation for playbook `profile` or session-plan `agent_profile`.
- No change to the meaning or allowed values of session-plan workflow `profile`.

## Files

### Create

- None expected.

### Modify

- `packages/input/src/playbook.ts` — add optional `profile` to `playbookFrontmatterSchema`, `PlaybookEntry`, and `SessionPlanInput`; serialize it when present; include it in `playbookToBuildSource()`; carry it in `PlaybookPlanSeed`; ensure copy/write paths preserve it through object spreading.
- `packages/input/src/session-plan.ts` — add `agent_profile?: string` to `sessionPlanFrontmatterSchema`; add `agentProfile?: string` to `CreateSessionPlanOpts`; set `agent_profile` in `createSessionPlan()` and `createSessionPlanFromPlaybookSeed()`; add `agentProfile?: string` to `NormalizeBuildSourceResult` and return it for session-plan file paths.
- `packages/input/src/extension-normalize.ts` — add `agentProfile?: string` to `PreprocessingResult`; propagate `normalizeBuildSource(...).agentProfile` for file-based session-plan sources.
- `packages/input/src/index.ts` — export any new public types if the existing barrel export list requires explicit additions.
- `packages/monitor/src/server.ts` — factor/reuse profile lookup validation; in `/api/playbook/run`, validate `playbook.profile` for autonomous playbooks and pass it to `enqueuePrd()`; in `/api/session-plan/create`, accept optional `agent_profile` and write it without existence validation; in `/api/session-plan/create-from-playbook`, rely on `createSessionPlanFromPlaybookSeed()` to write `agent_profile`; in `/api/enqueue`, capture `normalizeBuildSource()` metadata, validate inherited profile when `body.profile` is absent, and append `--profile <name>` to worker args for explicit or inherited profile.
- `packages/client/src/routes.ts` — add optional `agent_profile` to session-plan wire/request data and keep `PlaybookRunRequest` unchanged unless a response field is added.
- `packages/client/src/api/playbook.ts` — add optional `profile` and ensure required `mode` is preserved in `PlaybookListEntry`, `PlaybookData`, and `PlaybookFrontmatterFields` wherever those types represent persisted playbook frontmatter.
- `packages/client/src/api-version.ts` — bump daemon API version and summarize optional playbook/session-plan profile wire additions.
- `packages/eforge/src/cli/index.ts` — add `--profile <name>` to `build` if missing and thread it into `runOrDelegate`; update `enqueue` command to choose `options.profile ?? inheritedAgentProfile` and pass the effective value to `EforgeEngine.create({ profileOverride })` and `engine.enqueue({ profile })`.
- `packages/eforge/src/cli/run-or-delegate.ts` — add profile to `BuildRunOpts`; when delegating to daemon, include explicit `profile`; for in-process build, pre-detect session-plan `agent_profile` before `EforgeEngine.create()`, run build-source preprocessing before `engine.enqueue()`, emit preprocessing diagnostics, and pass the effective profile to `engine.enqueue()`.
- `test/playbook.test.ts` — add profile parse/serialize/list/build-source/plan-seed coverage.
- `test/session-plan-from-playbook.test.ts` and `test/session-plan-helpers.test.ts` — add `agent_profile` schema, helper, create-from-playbook, and round-trip coverage.
- `test/normalize-build-source.test.ts` — assert `agentProfile` is returned for session-plan paths and omitted for non-session-plan paths.
- `test/input-extension-normalization.test.ts` — assert `preprocessBuildSource()` exposes `agentProfile` for session-plan file inputs.
- `test/playbook-api.test.ts` — assert autonomous playbook profile writes queued PRD `profile:`, missing profile returns 400 before enqueue, and show/list/save round-trip includes both `profile` and required `mode`.
- `test/daemon-session-plan-routes.test.ts` — assert create/create-from-playbook writes `agent_profile`, `/api/enqueue` passes inherited `--profile`, explicit request `profile` overrides inherited `agent_profile`, and missing inherited profile returns 400 without spawning a worker.
- Existing CLI/daemon tests that assert build/enqueue argument shapes — update for optional profile fields only where needed.

## Verification

- [ ] `validatePlaybook()` accepts a playbook containing `profile: docs-heavy` and rejects no existing playbook fixture.
- [ ] `serializePlaybook(parsePlaybook(rawWithProfile))` contains `profile: docs-heavy`, `mode:`, and `postMerge:` when present.
- [ ] `playbookToBuildSource()` returns `profile: 'docs-heavy'` for an autonomous profiled playbook.
- [ ] `createSessionPlanFromPlaybookSeed()` sets `profile` to `null` and `agent_profile` to the playbook profile when present.
- [ ] `normalizeBuildSource()` returns normalized content plus `agentProfile: 'docs-heavy'` for `.eforge/session-plans/*.md` containing `agent_profile: docs-heavy`.
- [ ] `/api/playbook/run` for an autonomous profiled playbook creates a queued PRD whose frontmatter contains `profile: docs-heavy`.
- [ ] `/api/playbook/run` returns HTTP 400 and does not create a queue file when the playbook profile is absent from all profile scopes.
- [ ] `/api/enqueue` for a session-plan file containing `agent_profile: docs-heavy` spawns the worker with `--profile docs-heavy` when the request body has no `profile`.
- [ ] `/api/enqueue` for the same session-plan file spawns the worker with the request body profile when both request `profile` and session `agent_profile` exist.
- [ ] `eforge build --profile other .eforge/session-plans/plan.md` sends `other` as the effective profile instead of the inherited `agent_profile`.
- [ ] A direct CLI enqueue/build path for a session-plan file containing `agent_profile: missing-profile` exits non-zero before creating a queued PRD and reports that the profile was not found.
- [ ] `pnpm type-check` passes after the optional wire fields and result shapes are added.
