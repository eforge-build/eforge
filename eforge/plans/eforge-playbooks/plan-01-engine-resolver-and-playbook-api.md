---
id: plan-01-engine-resolver-and-playbook-api
name: "Engine: generalized set-artifact resolver and playbook API"
branch: eforge-playbooks/engine-resolver
---

# Engine: generalized set-artifact resolver and playbook API

## Architecture Context

The three-tier config resolver foundation has already shipped (commit 288db4c on this branch): `~/.config/eforge/` (user), `eforge/` (project-team, checked in), and `.eforge/` (project-local, gitignored) are all recognized tiers, with precedence project-local → project-team → user. Profile loading already implements this with shadow tracking in `packages/engine/src/config.ts` (`loadProfile`, `listProfiles`).

The profile loader is, however, hardcoded to the `profiles/` directory. The playbooks PRD requires a *generalized* set-artifact resolver so playbooks can plug in as a new `set` kind (alongside the existing `profiles` set), with all three-tier loading, shadow reporting, and source labeling provided automatically. This plan extracts the generalized resolver and wires playbooks on top of it. No public API of the existing config/profile surface changes; profile loaders are refactored in-place to delegate to the new resolver.

## Implementation

### Overview

1. Extract a generic set-artifact resolver from the current profile-specific code: `packages/engine/src/set-resolver.ts` exporting `listSetArtifacts(kind, opts)` and `loadSetArtifact(kind, name, opts)`. A `kind` is `{ name: 'profiles' | 'playbooks', dirSegment: string, fileExtension: string }`. The resolver scans the three tier directories, returns a merged list with `source: 'project-local' | 'project-team' | 'user'` labels and a `shadows: Array<'project-team' | 'user'>` array per item describing every shadow relationship (not just the immediate one).
2. Refactor `loadProfile` and `listProfiles` in `packages/engine/src/config.ts` to delegate to the new resolver. Public function signatures must not change — existing callers (skills, daemon routes, CLI) keep working.
3. Define the playbook file shape and Zod schema in `packages/engine/src/playbook.ts`:
   - Frontmatter (Zod): `name` (kebab-case string, required), `description` (string, required), `scope` (`'user' | 'project-team' | 'project-local'`, required), `agentRuntime` (string, optional), `postMerge` (array of strings, optional).
   - Body sections parsed by heading: `## Goal`, `## Out of scope`, `## Acceptance criteria`, `## Notes for the planner`. Missing optional sections are returned as empty strings; missing `## Goal` is a validation error.
   - The frontmatter `scope` value must match the storage tier the file was loaded from; mismatch is a validation error surfaced in `listPlaybooks` warnings.
4. Engine API in `packages/engine/src/playbook.ts`:
   - `listPlaybooks(opts: { configDir, cwd }): Promise<{ playbooks: PlaybookEntry[]; warnings: string[] }>` — merged list with source labels and full shadow chains. Each entry: `{ name, description, scope, source, shadows, path }`.
   - `loadPlaybook(opts: { configDir, cwd, name }): Promise<{ playbook: Playbook; source; shadows }>` — highest-precedence wins; throws `PlaybookNotFoundError` when no tier has it.
   - `playbookToSessionPlan(playbook: Playbook): SessionPlanInput` — produces the structured prompt fed to the existing planner agent. Open Question 1 in the PRD is resolved as: feed the playbook body to `planner` as the user prompt (preserving planning rigor); this function is the formatter, not a planner replacement. The result includes the goal, out-of-scope, acceptance criteria, and planner notes wrapped in a stable schema the existing planner stage already accepts.
   - `validatePlaybook(raw: string): { ok: true; playbook } | { ok: false; errors: string[] }` — pure schema validation used by the daemon's `/api/playbook/validate` endpoint in plan-02.
   - `writePlaybook(opts: { configDir, cwd, scope, playbook })` — writes the file to the tier directory matching `scope`, using the same direct-write + atomic-rename pattern that `createAgentRuntimeProfile` uses (see `config.ts:1591`). Does not invoke `forgeCommit` — that is the Promote action's responsibility (plan-03/04). Creates the tier directory if missing.
   - `movePlaybook(opts: { configDir, cwd, name, fromScope, toScope })` — used by Promote/Demote. Uses `git mv` when both tiers are inside the repo working tree; otherwise plain rename. Returns the destination path so the CLI can stage it.
5. Tier path helpers: extend the existing `localProfilePath`, `profilePath`, `userProfilePath` pattern with `localPlaybookDir`, `playbookDir`, `userPlaybookDir`. Keep them in `config.ts` so all tier-aware paths share one home, or in `set-resolver.ts` if computed from the registered kinds — pick the location that requires the smaller diff.
6. Re-export `listPlaybooks`, `loadPlaybook`, `playbookToSessionPlan`, `validatePlaybook`, `writePlaybook`, `movePlaybook`, and the `Playbook` / `PlaybookEntry` types from `packages/engine/src/index.ts`.

### Key Decisions

1. **Generalize, do not duplicate.** Profile and playbook resolvers share one underlying scanner; the rest of the system continues to call `listProfiles` / `loadProfile`. This keeps the feedback-no-backward-compat-cruft principle (no parallel implementations) while honoring the PRD's directive that playbooks register with the shared resolver.
2. **`scope` field is informational and must match storage location.** A mismatch produces a warning in the merged listing, not a load failure. This protects users who hand-edit a file or move it between tiers without updating the frontmatter, while still surfacing the inconsistency.
3. **Body parsing by heading, not template substitution.** The PRD explicitly defers parameterization to a later phase; we treat the body as a fixed-structure document and feed it to the planner verbatim.
4. **Direct file writes, no `forgeCommit` for authoring.** Authoring a playbook does not produce engine commits. The Promote action's git-staging step lives in the CLI/skill layer (plan-03/04), keeping `playbook.ts` pure I/O.

## Scope

### In Scope
- Generic set-artifact resolver covering the three tiers with full shadow-chain reporting.
- Refactor of profile loaders to delegate to the new resolver, preserving public API.
- Playbook types, Zod schema, parser, list/load/validate/write/move APIs, and `playbookToSessionPlan`.
- Tier path helpers for playbook directories.
- Unit tests for resolver, schema, parser, shadow tracking, and `playbookToSessionPlan` shape.

### Out of Scope
- Daemon HTTP routes, MCP tool registration, CLI commands, skills (subsequent plans).
- Piggyback queue scheduling (plan-05).
- Playbook execution / handoff to the build pipeline (the existing planner stage consumes `SessionPlanInput` unchanged).
- Parameterization, templating, cross-playbook composition (out of scope per PRD v1).

## Files

### Create
- `packages/engine/src/set-resolver.ts` — generic three-tier set-artifact resolver: `listSetArtifacts`, `loadSetArtifact`, kind registration helpers, `SetArtifactSource` and `SetArtifactEntry` types.
- `packages/engine/src/playbook.ts` — playbook types, Zod schema, parser, `listPlaybooks`, `loadPlaybook`, `validatePlaybook`, `writePlaybook`, `movePlaybook`, `playbookToSessionPlan`.
- `test/set-resolver.test.ts` — fixtures-free tier-merging tests using a temp dir builder; covers single-tier, all-three-tiers, partial overlap, full shadow chain reporting, and mismatched-scope warnings.
- `test/playbook.test.ts` — schema validation (valid frontmatter, missing required fields, bad enum values), body parsing (all sections present, missing optional sections, missing `## Goal` errors), `playbookToSessionPlan` output shape stability, and round-trip via `writePlaybook` then `loadPlaybook`.

### Modify
- `packages/engine/src/config.ts` — extract tier-scanning logic, replace direct directory walks in `loadProfile` and `listProfiles` with calls to `loadSetArtifact('profiles', ...)` and `listSetArtifacts('profiles', ...)`. Keep public function signatures and return types identical.
- `packages/engine/src/index.ts` — re-export new playbook public API and `SetArtifactEntry` type.
- `test/config.test.ts` and `test/profile-wiring.test.ts` (if internals shift) — update only if the refactor changes observable test fixtures; do not loosen assertions.

## Verification

- [ ] `pnpm type-check` passes.
- [ ] `pnpm test` passes; new tests in `test/set-resolver.test.ts` and `test/playbook.test.ts` execute and pass.
- [ ] `listPlaybooks` returns three entries with correct `source` labels when one playbook exists at each of `~/.config/eforge/playbooks/<name>.md`, `eforge/playbooks/<name>.md`, and `.eforge/playbooks/<name>.md` for distinct names.
- [ ] When the same playbook name exists at all three tiers, `listPlaybooks` returns one entry with `source: 'project-local'` and `shadows: ['project-team', 'user']` (full chain, not just immediate parent).
- [ ] `loadPlaybook` returns the project-local copy when present, project-team next, then user, matching precedence.
- [ ] `validatePlaybook` returns `{ ok: false, errors: [...] }` for input missing `name`, missing `description`, missing `scope`, missing `## Goal`, and for invalid `scope` enum values; returns `{ ok: true, playbook }` for a valid sample.
- [ ] `playbookToSessionPlan` produces an object whose schema matches what the existing planner stage already accepts (referenced from session-plan tests / fixtures).
- [ ] Existing profile tests still pass after the loader refactor — no public API regression.
- [ ] `writePlaybook` creates the target tier directory if missing and writes via temp + rename atomically.
