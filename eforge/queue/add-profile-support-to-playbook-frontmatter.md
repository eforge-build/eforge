---
title: Add Profile Support to Playbook Frontmatter
created: 2026-05-19
depends_on: ["investigation-first-planning-playbook-invocation-semantics"]
profile: gpt-claude-combo
---

# Add Profile Support to Playbook Frontmatter

## Problem / Motivation

Users can create reusable playbooks for recurring work, but cannot bind a playbook to the agent runtime profile best suited for that workflow. When a playbook needs a specific backend/model/toolbelt mix, such as docs-heavy workflows, browser tooling, or cheaper/stronger models, the runner currently falls back to active-profile resolution or profile-router extensions.

Evidence gathered:

- `@eforge-build/input` owns playbook parsing/serialization in `packages/input/src/playbook.ts`.
- Current playbook frontmatter accepts `name`, `description`, `scope`, required `mode`, and optional `postMerge`; there is no `profile` field today.
- `playbookToBuildSource()` compiles autonomous playbooks to a `SessionPlanInput` with `source` and `postMerge`, but no profile metadata.
- The daemon playbook run route in `packages/monitor/src/server.ts` loads a playbook, compiles autonomous playbooks to build source, then calls `enqueuePrd({ ..., postMerge: plan.postMerge })`. It does not pass a `profile` value.
- The queue layer already supports per-build profile binding:
  - `packages/engine/src/prd-queue.ts` accepts `EnqueuePrdOptions.profile`.
  - It writes `profile: <name>` into queued PRD frontmatter.
  - The scheduler/engine respect queued PRD `frontmatter.profile` before profile routers or the active profile.
- The generic enqueue path already has `profile` request support:
  - `packages/client/src/routes.ts`
  - `eforge_build`
  - CLI `--profile`
- Playbook run request types currently only accept `name`, `afterQueueId`, `session`, and `topic`.
- Consumer-facing surfaces that must stay in sync include:
  - CLI: `packages/eforge/src/cli/playbook.ts`
  - MCP proxy: `packages/eforge/src/cli/mcp-proxy.ts`
  - Pi extension/skills: `packages/pi-eforge/...`
  - Claude plugin skills: `eforge-plugin/...`
- `AGENTS.md` explicitly requires Pi and Claude plugin parity for user-facing behavior.
- Docs currently describe playbooks in `docs/config.md` and public web docs generated from `web/content/` / reference artifacts.
- Adding a playbook frontmatter field is user-facing and should be documented.

Initial conclusion: this is a feature that extends the reusable input artifact schema and forwards the optional profile to existing queue/frontmatter behavior rather than inventing a new scheduling mechanism.

User impact: recurring workflows cannot be fully self-contained; users must remember to switch active profiles, rely on router extensions, or manually edit queued PRDs before dispatch.

## Goal

Add optional `profile` support to playbook frontmatter so reusable playbooks can bind to an agent runtime profile and forward that profile into existing queued PRD profile behavior.

For planning-mode playbooks, preserve the distinction between session workflow profile and agent runtime profile by carrying the playbook profile into session plans using a distinct field such as `agent_profile`.

## Approach

### Core design decisions

1. **Field name and meaning**
   - Add optional frontmatter field `profile: <profile-name>` to playbooks.
   - The value names an agent runtime profile, the same namespace used by:
     - `eforge build --profile`
     - active-profile markers
     - queued PRD `profile:` frontmatter
   - Rationale: reuses existing terminology and queue/engine behavior; avoids introducing a new `agentRuntime` or workflow-profile concept.

2. **Autonomous playbook precedence**
   - For autonomous playbooks, a playbook `profile:` is persisted to the queued PRD frontmatter and therefore has explicit-override precedence.
   - Effective order becomes:
     1. queued PRD profile from playbook
     2. profile router
     3. active profile marker
     4. defaults
   - Rationale: the user explicitly encoded the desired profile in the reusable artifact, so routers should not override it.
   - This matches existing scheduler behavior for explicit PRD frontmatter profile.

3. **Planning-mode propagation**
   - A planning-mode playbook’s `profile:` should carry into the seeded session plan and then into the later `/eforge:build` enqueue.
   - Do **not** reuse the session plan frontmatter key `profile` for this, because `packages/input/src/session-plan.ts` already uses `profile` for workflow profile:
     - `errand`
     - `excursion`
     - `expedition`
   - Add a distinct session-plan frontmatter key such as:
     - preferred: `agent_profile: <profile-name>`
     - alternative: `runtime_profile: <profile-name>`
   - When a session plan containing `agent_profile` is used as build source, the enqueue path should pass that value as the per-build profile override so the queued PRD receives `profile: <name>`.
   - Explicit user/build-time overrides, such as `/eforge:build --profile` or API `profile`, should win over the session plan’s inherited `agent_profile`.

4. **Validation timing**
   - Validate profile existence when the profile is about to affect execution:
     - autonomous playbook run: validate before writing the queued PRD;
     - planning playbook seed: preserve `agent_profile` without requiring local existence at seed time if possible;
     - later build of a session plan with `agent_profile`: validate before enqueueing/spawning the worker, consistent with generic profile override behavior.
   - Rationale: user-scoped playbooks and session plans can be portable/draft artifacts; run/build-time validation gives concrete errors when the profile actually matters.

5. **Boundary behavior for session plans**
   - Extend session-plan normalization/preprocessing to surface inherited agent profile metadata in addition to normalized build content.
   - The daemon `/api/enqueue` prevalidation path should inspect session-plan `agent_profile` and pass `--profile <name>` to the worker when the request body did not already include `profile`.
   - The CLI enqueue/build path should also honor session-plan `agent_profile` when no explicit `--profile` was provided, so daemon and direct CLI behavior remain consistent.

6. **No ephemeral playbook run override in MVP**
   - Do not add `eforge playbook run --profile` / `eforge_playbook.run profile` in the first slice unless implementation discovers it is trivial and consistent.
   - Rationale: the requested capability is persistent playbook frontmatter plus planning inheritance.
   - Existing generic `eforge build --profile` already covers one-off build overrides and should take precedence over inherited session plan profile.

7. **Backward compatibility**
   - `profile` on playbooks and `agent_profile` on session plans are optional.
   - Existing playbooks/session plans continue to parse and run unchanged.
   - Unknown/stale `agentRuntime` should not become the new API.
   - If necessary, either ignore `agentRuntime` as today or remove it from tool schemas as stale drift; do not document it.

8. **Consumer UX**
   - Create/Edit skills should offer an optional profile question after mode selection, with a clear “leave blank to use active profile/router defaults” option.
   - Planning-mode run output should mention when a profile was inherited into the session plan.
   - Listing may show the profile when present, but this is nice-to-have unless the UI already has a natural place for it.

### Code impact

#### Core input artifact layer

- `packages/input/src/playbook.ts`
  - Add optional `profile: z.string().min(1).optional()` or equivalent existing profile-name validation to `playbookFrontmatterSchema`.
  - Add `profile?: string` to `SessionPlanInput` and forward it from `playbookToBuildSource()`.
  - Include `profile` in `serializePlaybook()` when present.
  - Ensure `copyPlaybookToScope()` preserves profile when copying to another tier.
  - Extend `PlaybookPlanSeed` / `playbookToPlanSeed()` so planning-mode seeds carry the playbook profile.

- `packages/input/src/session-plan.ts`
  - Add an optional agent-runtime-profile field to session plan frontmatter, preferred `agent_profile?: string`, while preserving existing workflow `profile: errand|excursion|expedition|null`.
  - Update `createSessionPlanFromPlaybookSeed()` to set `agent_profile` from `playbook.profile` when present.
  - Update normalization types so `normalizeBuildSource()` can return both normalized `content` and inherited `profile`/`agentProfile` metadata for session-plan files.

- `packages/input/src/extension-normalize.ts`
  - Propagate session-plan inherited profile metadata through `preprocessBuildSource()` so CLI/worker enqueue can persist it.

#### Daemon/API run and enqueue paths

- `packages/monitor/src/server.ts`
  - In `POST /api/playbook/run`, after loading an autonomous playbook, validate `playbook.profile` if present using existing `loadProfile`/`getConfigDir` patterns, then pass `profile: plan.profile` to `enqueuePrd()`.
  - For planning-mode playbooks, session plan creation should write `agent_profile` via `createSessionPlanFromPlaybookSeed()`.
  - Run output may mention inherited profile.
  - In `POST /api/enqueue`, prevalidation already calls `normalizeBuildSource()` for session-plan files.
  - Capture returned profile metadata and, when request body lacks explicit `profile`, pass it as `--profile <name>` to the worker after validating existence.
  - Explicit request `profile` wins.

#### Shared client contract

- `packages/client/src/api/playbook.ts`
  - Add `profile?: string` and currently-missing `mode` to `PlaybookData` / `PlaybookFrontmatterFields` if not already generated elsewhere.
  - Add any optional response profile fields only if implementation chooses to surface them.

- `packages/client/src/routes.ts` / types
  - Update if session-plan or playbook run response shapes change.

- `packages/client/src/api-version.ts`
  - Bump daemon API version if the route/request/response wire contract or client expectations change.

#### CLI

- `packages/eforge/src/cli/index.ts`
  - Ensure file-based session plan enqueue/build honors `agent_profile` when no explicit `--profile` is supplied.
  - If needed, pre-read session-plan metadata before `EforgeEngine.create()` so dependency detection/enqueue setup uses the intended profile, and/or pass inherited profile to `engine.enqueue()`.

- `packages/eforge/src/cli/playbook.ts`
  - Preserve `mode` and new `profile` in `playbookDataToRaw()` and edit-save.
  - Current code inspection shows `playbookDataToRaw()` and edit-save preserve `postMerge` but not `mode`; this existing drift should be fixed while touching frontmatter preservation.
  - Consider adding `--profile <name>` to `eforge playbook new` so non-interactive scripts can create profiled playbooks.

- `test/cli-playbook.test.ts`
  - Update expectations for mode/profile preservation and new behavior.

#### MCP/Pi/Claude integration parity

- `packages/eforge/src/cli/mcp-proxy.ts`
  - Replace stale `agentRuntime` optional field with `profile?: string` in the `eforge_playbook` frontmatter schema, unless backwards compatibility needs an alias.

- `packages/pi-eforge/extensions/eforge/index.ts` / native tool declarations and `packages/pi-eforge/extensions/eforge/playbook-commands.ts`
  - Update tool schema/types and native overlay display if needed.
  - The native run overlay may not need a profile picker if the profile is stored in playbook frontmatter.

- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` and `eforge-plugin/skills/playbook/playbook.md`
  - Update Create/Edit flow to ask/suggest optional profile and explain precedence/planning inheritance.

- `eforge-plugin/.claude-plugin/plugin.json`
  - Bump plugin version because plugin files change.

#### Docs/reference/tests

- Update:
  - `docs/config.md`
  - public docs under `web/content/`
  - generated reference artifacts if applicable

- Add/update tests:
  - playbook parse/serialize/build-source forwarding of `profile`;
  - planning-mode playbook creates session plan with `agent_profile`;
  - `normalizeBuildSource()` returns inherited session-plan profile metadata;
  - enqueue/frontmatter path writes queued PRD `profile:` for autonomous and session-plan-derived builds;
  - explicit build-time profile overrides inherited `agent_profile`.

Evidence and caveats:

- Existing queued PRD profile behavior and profile-router precedence are covered in `test/profile-router-scheduler.test.ts`.
- `packages/input/src/session-plan.ts` currently uses `profile` for workflow profile (`errand` / `excursion` / `expedition`), so the implementation must not store agent runtime profile names in that field.
- `packages/eforge/src/cli/mcp-proxy.ts` currently exposes an `agentRuntime` field in the playbook tool schema that does not appear in the input schema; likely stale and should not be extended further without review.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Optional playbook `profile` is backward-compatible. | `playbookFrontmatterSchema` is the current gate; adding an optional field should not affect existing playbooks. Existing playbooks in `eforge/playbooks/` omit profile. | high | low | Add parse/validate tests for playbooks with and without `profile`. | Existing playbooks could fail validation if schema change is wrong. |
| Queued PRD `profile:` is the right execution mechanism. | `enqueuePrd()` already accepts `profile`; scheduler tests show explicit frontmatter profile bypasses routing and reaches child builds. | high | low | Add test that playbook run/enqueue writes PRD frontmatter `profile:`; rely on existing scheduler profile tests for downstream behavior. | If not forwarded correctly, playbook profile would appear saved but not affect builds. |
| Session plan `profile` cannot be used for inherited agent runtime profile. | `packages/input/src/session-plan.ts` defines `profile` as `errand \| excursion \| expedition \| null`; the planning skill also uses it for workflow profile signal. | high | low | Add schema/type tests for a distinct `agent_profile` field and ensure workflow `profile` still round-trips. | Overloading `profile` would corrupt workflow profile semantics and likely fail schema validation for arbitrary profile names. |
| Planning-mode inheritance should use a distinct frontmatter key such as `agent_profile`. | Session plan schema is `.passthrough()` and serializer preserves unknown/passthrough frontmatter fields; adding a typed optional field is straightforward. | high | low | Add `createSessionPlanFromPlaybookSeed()` and `parse/serializeSessionPlan()` tests. | If not typed/serialized correctly, the profile could be lost between playbook run and later build. |
| Profile should be validated at execution/enqueue time, not save/seed time. | Existing generic enqueue validates `body.profile` before worker spawn; playbooks can be user-scope/cross-project artifacts, so save-time validation would reduce portability. | medium-high | low | Mirror existing `loadProfile` validation path in daemon/CLI. | Invalid profile errors could happen too late, or valid portable playbooks could be rejected too early. |
| Daemon and CLI paths both need explicit propagation for session-plan `agent_profile`. | Daemon `/api/enqueue` currently calls `normalizeBuildSource()` only for prevalidation and discards the result before spawning the worker; worker CLI performs its own preprocessing. | high | medium | Update `normalizeBuildSource()`/`preprocessBuildSource()` result shapes and tests for daemon and direct CLI behavior. | Daemon and CLI behavior could diverge; a seeded profile might work in one path but not the other. |
| CLI/client frontmatter types have existing drift around `mode`. | `packages/eforge/src/cli/playbook.ts` raw reconstruction/save path omits `mode`; `packages/client/src/api/playbook.ts` `PlaybookData` also omitted mode in the inspected snippet, while daemon responses/tool output include mode. | high | low | Run `pnpm type-check` and update tests; add mode preservation test. | Touching profile without fixing mode could perpetuate broken CLI edit/new behavior or type drift. |
| MCP proxy `agentRuntime` is stale, not a hidden supported field. | `packages/eforge/src/cli/mcp-proxy.ts` exposes `agentRuntime`, but `@eforge-build/input` schema does not accept it and current profile terminology supersedes legacy `agentRuntime`. | medium-high | low | Search release notes/tests for `agentRuntime` playbook usage; if none, remove/replace with `profile`. | Backward compatibility risk for any unpublished users relying on this undocumented field. |

### Profile signal

Recommended build profile: **excursion**.

Rationale: this is a cohesive feature across the playbook input schema, daemon run path, shared client types, CLI/MCP/Pi/Claude plugin surfaces, docs, and tests. A single planner can enumerate the affected areas and dependencies without delegated module planning. It is broader than an errand because it touches multiple packages and public-facing behavior, but it does not require expedition-style independent module plans.

## Scope

### In scope

- Add optional `profile` support to playbook frontmatter.
- Parse, validate, serialize, list/show, edit-save, copy/promote/demote, and structured save paths must preserve the field.
- For autonomous playbooks, persist the playbook profile into the queued PRD `profile:` frontmatter by forwarding it to `enqueuePrd`.
- This should make the playbook profile take the same precedence as an explicit queued PRD profile: it bypasses profile routers and active-profile fallback.
- For planning-mode playbooks, carry the playbook profile into the seeded session plan using a distinct agent-runtime-profile field, preferred `agent_profile`, and then into the later `/eforge:build` enqueue.
- Preserve the existing session plan `profile` field for workflow profile:
  - `errand`
  - `excursion`
  - `expedition`
- Do not overload session plan `profile` with agent runtime profile names.
- Validate profile existence when the profile affects execution:
  - autonomous playbook run;
  - later session-plan build/enqueue.
- Avoid save-time validation unless implementation finds existing conventions require it.
- Update shared client API types and MCP/Pi tool schemas so `eforge_playbook` can create/edit/show/save playbooks with `profile`.
- Update CLI and both consumer integrations/skills to expose and preserve the field where applicable.
- Keep `eforge-plugin/` and `packages/pi-eforge/` in sync for consumer-facing behavior, per `AGENTS.md`.
- Bump plugin version if plugin files change.
- Update docs/reference docs and tests.

### Out of scope

- Do not change the meaning of workflow profile selection:
  - `errand`
  - `excursion`
  - `expedition`
- This feature is about agent runtime profile names.
- Do not replace profile routers or active-profile marker resolution.
- Do not require every playbook or session plan to declare an agent runtime profile.
- Do not add a new scheduling/orchestration concept beyond forwarding to existing queued PRD `profile:` behavior.
- Do not make profile metadata affect runtime behavior:
  - `description`
  - `whenToUse`
  - `tags`
- Do not add an ephemeral `playbook run --profile` override in the MVP unless it falls out naturally and preserves clear precedence.

## Acceptance Criteria

- A playbook markdown file can include optional frontmatter `profile: <name>` and passes playbook validation.
- Parsing and serialization round-trip `profile` without dropping existing fields:
  - `name`
  - `description`
  - `scope`
  - `mode`
  - `postMerge`
- Structured save/show/list/edit flows preserve `profile` when present.
- Running an autonomous playbook with `profile: <name>` validates that the named profile exists in normal profile lookup scopes before enqueueing.
- The queued PRD created from an autonomous playbook with `profile: <name>` contains `profile: <name>` in its frontmatter.
- Running a planning-mode playbook with `profile: <name>` creates a session plan that preserves the inherited agent runtime profile in a distinct frontmatter field, preferred `agent_profile: <name>`, without overwriting the session plan workflow `profile` field.
- Building/enqueueing a session plan with inherited `agent_profile: <name>` validates the named profile and writes `profile: <name>` into the queued PRD frontmatter when no explicit build-time profile override was supplied.
- Explicit build-time profile override wins over inherited session plan `agent_profile`.
- The resulting build uses existing explicit PRD profile precedence:
  - profile routers are skipped for that PRD;
  - active-profile fallback is not used.
- Running an autonomous playbook or building a session plan without inherited profile preserves current behavior:
  - profile routers may select a profile;
  - otherwise active profile/default resolution applies.
- If the inherited playbook/session profile does not exist at execution time, the daemon/CLI returns a clear user-facing error and does not enqueue a PRD.
- CLI, MCP/Claude plugin, and Pi integration schemas/types are updated consistently.
- Plugin version is bumped if plugin files change.
- Public/project docs describe:
  - the optional playbook `profile` field;
  - planning-mode inheritance via session plan `agent_profile`;
  - precedence;
  - validation behavior.
- Tests cover:
  - parse/serialize/build-source forwarding;
  - planning session seed propagation;
  - session-plan normalization metadata;
  - at least one enqueue/frontmatter path for profiled playbooks/session plans.
- `pnpm type-check` and relevant tests pass.
