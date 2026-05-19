---
title: Add `mode: autonomous | planning` to playbooks; bundle first planning-mode playbook (complexity-hotspot-reduction)
created: 2026-05-19
---

# Add `mode: autonomous | planning` to playbooks; bundle first planning-mode playbook (complexity-hotspot-reduction)

## Problem / Motivation

eforge's user contract is "hand off and forget" — the user enqueues work and trusts the build will land at a quality bar they don't have to audit closely. Today's playbook model assumes every playbook produces a finalized PRD ready for the planner. That works for routine, mechanical audits (the two existing playbooks: `docs-implementation-sync`, `plugin-pi-parity-audit`) but fails for any playbook where target selection or per-target approach is itself the load-bearing decision.

The motivating use case is a complexity-reduction audit. An earlier scan in this conversation produced churn × LOC hotspots, then ran `eslint-plugin-sonarjs` against the top 10 files and surfaced **49 cognitive-complexity violations**, including outliers at CC=924 (`packages/monitor/src/server.ts:1677` — the HTTP request handler), CC=192 (`packages/eforge/src/cli/display.ts:126` — `renderEvent`), and CC=136 (`packages/pi-eforge/extensions/eforge/index.ts:581`). Refactor approach (table-driven dispatch / extract-helpers / split-by-discriminant) varies per function and requires reading the function — exactly the kind of judgment that shouldn't be delegated to autonomous build.

### Symptom

Playbooks today only support an "autonomous PRD" shape: the body is treated as a finalized PRD that goes straight to the planner, which produces plans, which the engine builds — no human in the loop after enqueue. This is the right model for routine, mechanical audits (`docs-implementation-sync`, `plugin-pi-parity-audit`), where target list and approach are well-defined by the playbook body alone.

It is the wrong model for any playbook where **target selection or per-target approach is the load-bearing decision**. The motivating concrete example: a complexity-reduction audit. After scanning the codebase (churn × LOC + cognitive complexity via `eslint-plugin-sonarjs`), we found 49 violations with outliers at CC=924, 192, and 136. Each requires reading the function to choose between table-driven dispatch, extract-helpers, or split-by-discriminant. That judgment can't be delegated to autonomous build without violating eforge's "hand off and forget" quality bar.

### Who is affected

- **Playbook authors** who want to capture recurring audit-and-refactor workflows that involve judgment per-target. Today they either (a) hand-write a one-off session plan each time, defeating reuse, or (b) author an autonomous playbook that eforge will execute blind, defeating quality.
- **eforge's "hand off and forget" guarantee.** Each time a user is tempted to push a judgment-heavy playbook through the autonomous path, the quality contract weakens.

### Why now

The user is sitting on a real backlog of complexity hotspots they want to address on a cadence, and asked for a playbook to capture that workflow. While designing it, the gap surfaced: there's no shape in the playbook system for "interactive planning seeded by a template." Without the new mode, the complexity-reduction playbook either stays autonomous (wrong) or doesn't exist as a playbook at all (loses reuse).

### Codebase evidence (validated via reads)

- **Playbook frontmatter Zod schema**: `packages/input/src/playbook.ts:53-62`. Required: `name`, `description`, `scope`. Optional: `postMerge`. To add: `mode: z.enum(['autonomous', 'planning'])` — required per `no-backward-compat` memory.
- **Playbook body** (`packages/input/src/playbook.ts:70-79`): four parsed sections — `goal`, `outOfScope`, `acceptanceCriteria`, `plannerNotes`. Headings are `## Goal`, `## Out of scope`, `## Acceptance criteria`, `## Notes for the planner`.
- **`playbookToBuildSource()`** (`packages/input/src/playbook.ts:566-598`): produces `SessionPlanInput` for the planner. Today every caller assumes the playbook is autonomous. After this change, this function asserts `mode === 'autonomous'` and a parallel `playbookToPlanSeed()` handles planning mode.
- **Session plan schema** (`packages/input/src/session-plan.ts:64-78`): uses Zod `.passthrough()` so adding `seeded_from_playbook` is non-breaking at the parser level, but should still be added to the schema for type-safety. Dimensions parsed from body as `Map<string, string>` keyed by lowercase `## heading`.
- **Daemon HTTP routes**: playbook routes at `packages/monitor/src/server.ts:3207-3506` (list, show, save, enqueue, promote, demote, validate, copy); session-plan routes referenced from `packages/client/src/routes.ts:173-181`. Route literals are owned by `@eforge-build/client` per `AGENTS.md`.
- **MCP tools** (must stay in sync per `AGENTS.md`): `eforge_playbook` at `packages/eforge/src/cli/mcp-proxy.ts:1067-1140` and Pi mirror at `packages/pi-eforge/extensions/eforge/index.ts:2095-2247`. `eforge_session_plan` has 9 actions today; `create-from-playbook` will be the 10th.
- **Skills**: `eforge-plugin/skills/playbook/playbook.md` (Create/Edit/Run/List/Promote/Demote branches) and `eforge-plugin/skills/plan/plan.md` (Step 1 is the natural place to add a "seed from playbook" option).
- **Existing playbooks**: `eforge/playbooks/docs-implementation-sync.md`, `eforge/playbooks/plugin-pi-parity-audit.md`. Both will get `mode: autonomous` added explicitly (per `no-backward-compat`, no default).
- **Tests**: `test/playbook.test.ts`, `test/playbook-api.test.ts`, `test/cli-playbook.test.ts`, `test/session-plan.test.ts` (and siblings) all need extension.
- **Wire-version bump required** (`packages/client/src/api-version.ts`): this is a breaking API change (route rename `playbookEnqueue` → `playbookRun`; new `session-plan/create-from-playbook` route; new required field in playbook frontmatter wire shape).
- **Plugin version bump required** (`eforge-plugin/.claude-plugin/plugin.json`) per `AGENTS.md`. Do NOT bump `packages/pi-eforge/package.json` (versioned at npm publish time).

### Roadmap alignment

Read `docs/roadmap.md`. No specific "playbook modes" item exists; nothing in the roadmap conflicts. The change fits the **Extensibility** theme (making playbooks a richer extension point). The roadmap also notes **TypeBox schema unification** is in-progress, with playbook/session-plan schemas on the "remains Zod until follow-up" list — so we stay in Zod here.

### Mapping question (early assumption)

Playbook body sections are `Goal | Out of scope | Acceptance criteria | Notes for the planner`. Session-plan dimensions for a typical feature/refactor are `problem-statement | scope | acceptance-criteria | code-impact | design-decisions | assumptions-and-validation | ...`. These don't align 1:1.

**Assumption (medium confidence)**: When `create-from-playbook` seeds a session plan, the cleanest mapping is `Goal → problem-statement`, `Out of scope → scope` (as a "NOT changing" stub the user fills in), `Acceptance criteria → acceptance-criteria`, `Notes for the planner → preserved as a `## Notes from playbook` free-form section`. Other dimensions (`code-impact`, `design-decisions`, etc.) stay empty for the planning skill to drive.

To validate cheaply: read the `set-section` handler to confirm it writes any heading slug into the body section map. Defer the mapping choice to `design-decisions`.

### Open questions

- ~~How exactly to map playbook body sections onto session-plan dimensions~~ → resolved in `design-decisions` D4 (preserve headings; only `## Acceptance criteria` slug-matches a dimension, others stay as context).
- ~~Whether the planning skill should pre-classify a seeded session's `planning_type`~~ → resolved in `design-decisions` D5 (leave as `unknown`; user reclassifies per-instance).

## Goal

Introduce a **planning-mode** playbook that seeds an interactive `/eforge:plan` session instead of enqueuing a build, by adding a required `mode: 'autonomous' | 'planning'` field to the playbook schema and bundling the first real planning-mode playbook (`complexity-hotspot-reduction`) along with its measurement tooling. The playbook body becomes the kickoff context for human-in-the-loop planning; once the session plan is finalized, hand-off proceeds normally via `/eforge:build`.

## Approach

### Profile Signal

**Recommendation: excursion.**

This is multi-package, cross-cutting work with a clear sequential dependency chain (schema → routes → daemon handlers → MCP tools → skills → playbook content). The plan above enumerates every file, every change, and every cross-file interaction in a single coherent pass — there's no subsystem that needs delegated module planning to reach quality.

Why not **expedition**: per the plan-skill guidance, expedition is for work where "a single planner session cannot fully plan all modules/subsystems with quality." The schema change here cascades mechanically through each layer; there are no independent module-level design questions that warrant their own planner sessions. The skill explicitly cautions against choosing expedition just because a change is cross-cutting or touches many files.

Why not **errand**: this is not a mechanical single-fix change. The discriminated response shape, the new seed action, the skill updates, and the wire version bump each require deliberate design choices captured above.

### Code Impact

#### `packages/input/src/playbook.ts`

- Add `mode: z.enum(['autonomous', 'planning'])` to `playbookFrontmatterSchema` (line 53). Required, no default.
- Export `PlaybookMode` type alongside `PlaybookFrontmatter`.
- `playbookToBuildSource()` (line 566): add a guard at the top — throw a typed error if `playbook.mode !== 'autonomous'`. Body unchanged.
- Remove the `playbookToSessionPlan` alias (line 604) per `no-backward-compat`. Audit usages with `grep -rn 'playbookToSessionPlan' .` and switch each to `playbookToBuildSource`.
- Add a new exported helper `playbookToPlanSeed(playbook: Playbook): { sessionId: string; topic: string; sections: Map<string, string>; seededFrom: string }`. Asserts `mode === 'planning'`. Maps body sections into a `Map<string, string>` keyed by lowercase heading slug (matching `SessionPlan.sections`). Exact mapping is captured in `design-decisions`.

#### `packages/input/src/session-plan.ts`

- Add optional `seeded_from_playbook: z.string().optional()` to `sessionPlanFrontmatterSchema` (line 64). Schema already uses `.passthrough()` so existing files are unaffected.
- No change to `parseSessionPlan` / `serializeSessionPlan` — the field round-trips through the existing path.
- Add a helper `createSessionPlanFromPlaybookSeed({ playbook, session?, topic? }): SessionPlan` that uses existing `createSessionPlan` plus `playbookToPlanSeed` to build the initial frontmatter and body. Pre-populates `status: 'planning'`, `planning_type: 'unknown'` (user re-classifies in Step 3 of the plan skill), `planning_depth: 'focused'`.

#### `packages/client/src/routes.ts`, `packages/client/src/api/`, `packages/client/src/api-version.ts`

- Rename `API_ROUTES.playbookEnqueue` → `API_ROUTES.playbookRun`. Route path: `'/api/playbook/run'` (rename `/api/playbook/enqueue`).
- Add `API_ROUTES.sessionPlanCreateFromPlaybook` = `'/api/session-plan/create-from-playbook'`.
- Add Zod request schema `SessionPlanCreateFromPlaybookRequest = { playbook_name, scope?, session?, topic? }` and response schema mirroring `SessionPlanCreateResponse` plus `kind: 'planning'`.
- Update `apiPlaybookEnqueue` → `apiPlaybookRun` in `packages/client/src/api/playbook.ts`. Response type becomes discriminated union `{ kind: 'enqueued'; id: string } | { kind: 'planning'; session: string; path: string }`.
- Add `apiSessionPlanCreateFromPlaybook` in `packages/client/src/api/session-plan.ts`.
- Bump `DAEMON_API_VERSION` in `packages/client/src/api-version.ts`.

#### `packages/monitor/src/server.ts`

- Rename handler block at line 3323 to use `API_ROUTES.playbookRun`. Dispatch by `playbook.mode`:
  - `'autonomous'`: existing path (`playbookToBuildSource` → `enqueuePrd` → `commitEnqueuedPrd`). Response shape becomes `{ kind: 'enqueued', id }`.
  - `'planning'`: load playbook, validate mode, build a session plan via `createSessionPlanFromPlaybookSeed`, atomically write to `.eforge/session-plans/<session>.md`, return `{ kind: 'planning', session, path }`.
- Add a new handler block for `API_ROUTES.sessionPlanCreateFromPlaybook` (mirror of the planning branch above but standalone — takes an explicit `playbook_name`). Reject 400 with a clear message when the named playbook has `mode === 'autonomous'`. Reject 409 if `session` already exists (no overwrite).

#### `packages/eforge/src/cli/mcp-proxy.ts` (lines 1066-1140)

- Update `eforge_playbook` schema:
  - Rename action enum value `'enqueue'` → `'run'`.
  - Add `mode: z.enum(['autonomous', 'planning'])` to the nested `playbook.frontmatter` schema (line 1078-1085).
  - Update tool description string to document `mode` and the new action name.
- Update the `'run'` action handler to call `API_ROUTES.playbookRun` and surface the discriminated response.
- Add a new `'create-from-playbook'` action to `eforge_session_plan` (line 1146). Schema gains `playbook_name: z.string().optional()` (required for the new action). Handler routes to the new daemon route.

#### `packages/pi-eforge/extensions/eforge/index.ts` (lines 2095-2247)

- Mirror every change from `mcp-proxy.ts` above (`AGENTS.md` parity rule). Same schemas, same action names, same handler logic.

#### `packages/eforge/src/cli/playbook.ts` (lines 131-394)

- `eforge playbook run <name>` (with `play` alias): parse the discriminated response from `apiPlaybookRun` and print:
  - `kind: 'enqueued'`: existing text, "enqueued as `<id>`".
  - `kind: 'planning'`: "planning session ready at `<path>`. Open with `/eforge:plan` to continue."
- No other CLI changes needed (list, new, edit, promote, demote, validate handlers all stay the same since they don't care about mode).

#### `eforge-plugin/skills/playbook/playbook.md`

- Document the `mode` frontmatter field with explanations of autonomous vs planning.
- Create branch: ask the user which mode interactively when creating a new playbook; emit to frontmatter.
- Run branch: dispatch by mode and print mode-specific next-step text.
- Edit branch: allow editing `mode`, warn on switch.

#### `eforge-plugin/skills/plan/plan.md`

- Step 1 "Session Setup": add a third option alongside "resume" and "create new" — "seed from a planning-mode playbook." Calls `eforge_playbook { action: 'list' }`, filters results to `mode === 'planning'`, asks user to pick one, then calls `eforge_session_plan { action: 'create-from-playbook', playbook_name, session, topic }`.
- Add a note that when a session was seeded from a playbook, the skill should preserve `seeded_from_playbook` in frontmatter and treat the pre-populated sections as starting context (not re-prompt for them, but allow editing).

#### `eforge-plugin/.claude-plugin/plugin.json`

- Bump version per `AGENTS.md`.

#### Playbook files

- `eforge/playbooks/docs-implementation-sync.md`: add `mode: autonomous` to frontmatter.
- `eforge/playbooks/plugin-pi-parity-audit.md`: add `mode: autonomous` to frontmatter.
- `eforge/playbooks/complexity-hotspot-reduction.md` (NEW): see the body in `assumptions-and-validation` / `design-decisions`; `scope: project-team`, `mode: planning`.

#### `scripts/` + root `package.json`

- `scripts/scan-complexity.mjs` (new): runs ESLint via `node_modules/.bin/eslint` with `scripts/complexity.eslint.config.mjs`, parses JSON output, computes `churn` via `git log --since='1 year ago' --pretty=format: --name-only -- <file>`, sorts by `churn × CC` desc, caps 30, prints markdown table + total CC-reduction footer.
- `scripts/complexity.eslint.config.mjs` (new): flat config with single rule `'sonarjs/cognitive-complexity': ['warn', 30]`, scoped to `packages/**/*.ts`, excludes tests/dist/node_modules. Placed in `scripts/` (not repo root) to avoid leaking lint behavior.
- Root `package.json`: add devDeps `eslint@^9`, `eslint-plugin-sonarjs@^4`, `typescript-eslint@^8`. Add `"complexity:scan": "node scripts/scan-complexity.mjs"`.

#### Tests (extend existing + small new file)

- `test/playbook.test.ts`: missing `mode` → parse error; invalid `mode` value → parse error; both modes round-trip; `playbookToBuildSource` throws on planning; `playbookToPlanSeed` throws on autonomous; mapping correctness for the body-to-sections transform.
- `test/playbook-api.test.ts`: `apiPlaybookRun` returns `kind: 'enqueued'` for autonomous playbook; returns `kind: 'planning'` for planning playbook; `apiPlaybookEnqueue` no longer exists (route 404 on the old path).
- `test/cli-playbook.test.ts`: CLI prints mode-specific post-run text (StubHarness or direct CLI invocation).
- `test/session-plan.test.ts` (or new `test/session-plan-from-playbook.test.ts`): `apiSessionPlanCreateFromPlaybook` populates `seeded_from_playbook`, sections present, rejects autonomous playbook, rejects duplicate session id.
- Update any existing fixtures that build playbooks programmatically without `mode` — add explicit `mode: 'autonomous'` (per `no-backward-compat`, no default to fall back to).

#### Patterns to reuse / existing utilities

- `playbookFrontmatterSchema` + `parsePlaybook` / `validatePlaybook` already handle Zod-based frontmatter validation — adding a field is a one-line extension.
- `createSessionPlan` / `serializeSessionPlan` already handle session-plan file I/O — the new seed helper composes them.
- `daemonRequest` (used throughout MCP handlers) handles the client-server transport.
- `forgeCommit` in `packages/engine/src/git.ts` for any commits eforge itself makes (not used directly here since this is plain code changes, but the complexity playbook references it for the eventual refactor work).
- `sendJson` / `sendJsonError` already standardize daemon HTTP responses.

#### Dependency relationships

- Schema (input pkg) is upstream of routes (client pkg), routes upstream of daemon (monitor pkg), daemon upstream of MCP tools (eforge + pi-eforge), MCP upstream of skills (eforge-plugin). Implementation order should respect this.

### Design Decisions

#### D1 — `mode` is required, no default

Add `mode: 'autonomous' | 'planning'` as a required field in `playbookFrontmatterSchema`. Update the two existing playbooks explicitly. Per the `no-backward-compat` memory: no default, no shim. A playbook missing `mode` is invalid.

**Trade-off**: one-time migration burden vs. clean schema. Memory wins. Two existing playbook files get the field added in this PR; any out-of-tree playbook would error until updated.

#### D2 — Rename `playbook/enqueue` → `playbook/run`

The current verb is autonomous-specific. After this change, the same call may either enqueue or open a planning session. Rename the route, the MCP action, the client helper, and the CLI subcommand handler. No alias kept.

**Trade-off**: breaks any caller of the v30 wire shape (mitigated by bumping `DAEMON_API_VERSION`; clients with a stale daemon already see clear version-mismatch errors). Matches `no-backward-compat`.

#### D3 — Response is a discriminated union

`apiPlaybookRun` returns `{ kind: 'enqueued'; id: string } | { kind: 'planning'; session: string; path: string }`. CLI, MCP wrappers, and Pi all branch on `kind`.

**Why this shape**: every consumer needs to surface different next-step text. A flat shape with optional fields hides the variant; a discriminator forces handling.

#### D4 — Playbook → session-plan section mapping: preserve headings

When `create-from-playbook` seeds a session plan, the playbook body sections are written into the session plan body under their **original headings**:

```
## Goal           → ## Goal in session plan body (key: 'goal')
## Out of scope   → ## Out of scope                   (key: 'out of scope')
## Acceptance criteria → ## Acceptance criteria       (key: 'acceptance criteria')
## Notes for the planner → ## Notes from playbook     (key: 'notes from playbook')
```

The session-plan readiness check uses `dimensionToSectionKey(dim).toLowerCase().replace(/-/g, ' ')` (verified at `packages/input/src/session-plan.ts:167-169`). Two consequences:

1. `## Acceptance criteria` keys to `'acceptance criteria'`, which matches the required `acceptance-criteria` dimension's section key. So the playbook's acceptance criteria **auto-covers** that dimension on seed. Net: 1 of 6 required dimensions starts covered.
2. Other playbook sections keep their original headings as **context** in the session plan body. They don't match any dimension slug, so they don't accidentally satisfy a required dimension; they're just bonus reading the user has when entering Step 2 of the plan skill.

Rename `## Notes for the planner` → `## Notes from playbook` in the seeded session plan so the heading reads sensibly in context (it was authored as a note for the planner agent; in the session plan it's a note from the source playbook).

**Trade-off**: no auto-coverage of `problem-statement` or `scope` from playbook Goal / Out-of-scope. Considered explicitly. Goal answers "what to achieve recurrently"; problem-statement answers "what's wrong now in this instance" — different questions for the planning skill. Scope answers "what's changing in this specific instance"; Out of scope is the playbook's standing non-goals. Forcing a mapping is lossy. Better to keep them as context and let the user write fresh dimension content in the planning conversation.

#### D5 — Planning playbooks start unclassified

Seeded session plans get `planning_type: 'unknown'` and `planning_depth: 'focused'` initially. The plan skill's Step 3 re-classifies per-instance with the user. Reasoning: a planning playbook is recurring; the same playbook may be a `refactor/focused` instance one quarter and an `architecture/deep` instance the next (e.g., the complexity playbook could be either depending on the top hit).

#### D6 — List filtering for planning playbooks is client-side

The plan skill's "seed from playbook" option calls the existing `eforge_playbook { action: 'list' }` and filters results to `mode === 'planning'`. No new MCP action.

**Why**: the `list` response already includes frontmatter; filtering in the skill (or the CLI/UI) is a one-liner. Adding a server-side filter creates one more thing to keep in sync.

#### D7 — Validate / promote / demote are mode-agnostic

These operate on file identity and location, not playbook content semantics. `validate` exercises the schema (which now requires `mode`); `promote` / `demote` move files between scopes. No mode-specific branching in their handlers.

#### D8 — Skills surface mode explicitly to the user

When the user creates a new playbook via `/eforge:playbook`, the skill asks: "Autonomous (hand-off and forget, eforge builds it) or planning (seeds an interactive `/eforge:plan` session)?" When the user runs a playbook, the skill prints the right post-run text based on the discriminator. The mode is never hidden.

#### D9 — Remove `playbookToSessionPlan` alias while we're here

`packages/input/src/playbook.ts:604` has `export const playbookToSessionPlan = playbookToBuildSource` as a "backward-compatible alias." Per `no-backward-compat`, remove it. Grep usages and rename to `playbookToBuildSource`. Confirmed one usage in `packages/monitor/src/server.ts:3346` — fix in the same handler block where we add mode dispatch.

#### D10 — `seeded_from_playbook` is the only new session-plan frontmatter field

Optional string. Carries the source playbook name. Useful for telemetry / traceability and for the plan skill to know "this session has playbook context above the dimensions." Don't add an enum for source mode (it's always a playbook seed when this field is set).

#### D11 — Measurement script bundled, not a separate PR

Per the user decision earlier in this conversation (bundle the playbook with the feature). The complexity playbook is unusable without `pnpm complexity:scan`, so ship them together. Future planning playbooks can introduce their own scripts the same way.

#### D12 — ESLint config lives in `scripts/`, not at repo root

Placed at `scripts/complexity.eslint.config.mjs` and only referenced by `scripts/scan-complexity.mjs`. Keeps `eslint .` from the repo root unconfigured (returns "no config found") so the lint behavior doesn't leak into IDE plugins or other tooling. Threshold = 30 (user decision earlier).

### Assumptions And Validation

| # | Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| 1 | `## Acceptance criteria` heading from a playbook seed auto-covers the `acceptance-criteria` required dimension via slug match | Read `dimensionToSectionKey` at `packages/input/src/session-plan.ts:167-169` and `checkReadiness` at `:509-527`. The map key is lowercase heading text; `'acceptance-criteria'.toLowerCase().replace(/-/g,' ')` = `'acceptance criteria'` which matches the section parser's key for `## Acceptance criteria`. | high | n/a | already validated | One required dimension is unexpectedly missing on first load; the user notices and refills. Low blast radius. |
| 2 | `sessionPlanFrontmatterSchema` is permissive enough to accept `seeded_from_playbook` without explicit schema change | Read the schema at `packages/input/src/session-plan.ts:64-78`. It uses `.passthrough()`. | high | n/a | already validated | None — the field would still round-trip even without an explicit schema entry. |
| 3 | Only one in-repo caller of `playbookToSessionPlan` (besides re-exports and self-references) | Grep confirmed: `packages/monitor/src/server.ts:3346`. Plus the alias export at `packages/input/src/index.ts:49`. No other consumers. | high | n/a | already validated | If a missed caller exists in some out-of-tree consumer (e.g., a user extension), they break on import; mitigated by typed compile error. |
| 4 | `eforge-plugin/` and `packages/pi-eforge/` MCP tool definitions are the only two places where MCP tool schemas live | Read both at the lines reported. Inspected `mcp-proxy.ts:1066-1140` and assume the Pi mirror is structurally equivalent based on the prior Explore agent's report. | medium | low | Read `packages/pi-eforge/extensions/eforge/index.ts:2095-2247` directly during implementation to confirm exact action enum and schema shape. | If there's a third place we miss (e.g., a separate plugin), users hit Zod parse errors invoking the renamed action there. |
| 5 | `eslint-plugin-sonarjs@^4` + `eslint@^9` + `typescript-eslint@^8` is a working triple | Validated earlier in this session by installing into a temp dir and running against the top 10 files; produced clean JSON output with cognitive-complexity messages. | high | n/a | already validated | If the dependency triple breaks in the repo's pnpm context (e.g., peer-dep conflict), `pnpm complexity:scan` errors out; fix is straightforward (pin a different minor). |
| 6 | ESLint's flat-config discovery doesn't pick up `scripts/complexity.eslint.config.mjs` from outside the `scripts/` directory | Inferred from observed behavior earlier: ESLint 9 emitted "File ignored because outside of base path" when the config was in `/tmp` and files were elsewhere. The reverse is also true — running ESLint from the repo root without `--config` won't auto-discover a config in a subdirectory. | medium | low | After landing, run `node_modules/.bin/eslint .` from the repo root with no `--config` flag; expect "no config found". | If wrong, ESLint behavior leaks into IDE/CI tooling unintentionally. Mitigation: explicit `--config` flag in the scan script. |
| 7 | Bumping `DAEMON_API_VERSION` is sufficient signaling for the route rename (no per-route deprecation period needed) | The user explicitly accepted `no-backward-compat` in saved memory. We just observed the version-mismatch error path during this session — clear and actionable. | high | n/a | already validated by the version-mismatch UX we saw earlier | If a stale client expects the old route, it gets a clear "restart daemon" error rather than a silent 404 mystery. |
| 8 | The MCP `eforge_playbook` tool's pre-existing `agentRuntime: z.string().optional()` field at `mcp-proxy.ts:1083` is an existing-and-tolerable divergence from `playbookFrontmatterSchema` | I read both schemas. `agentRuntime` is in the MCP tool schema but not in the canonical Zod schema in `packages/input/`. This is pre-existing drift unrelated to our change. | high | medium | Decide separately whether to surface `agentRuntime` in the canonical schema. **Out of scope for this PR** but flagged for future cleanup. | None for this PR (orthogonal). |
| 9 | `pnpm docs:check` will detect any drift in generated reference docs caused by the new `mode` field | Inferred from `AGENTS.md` documentation of `docs:check`. Not directly validated for the playbook schema specifically. | medium | low | Run `pnpm docs:check` during implementation; update the docs-gen inputs if it fails. | If wrong, the gate doesn't catch drift; docs reference doesn't show `mode` until manually fixed. Mitigation: visual diff of `packages/docs-gen` output. |
| 10 | The session-plan tool's `'create-from-playbook'` action can compose `createSessionPlan` + `setSessionPlanSection` to build the seeded plan rather than needing a new low-level constructor | Read `createSessionPlan` at `session-plan.ts:590` and `setSessionPlanSection` at `:621`. Both are public and composable. | high | n/a | already validated | If the existing helpers don't accept all the fields we need (e.g., `seeded_from_playbook`), we add a thin wrapper. No blocking risk. |
| 11 | LLM agents calling MCP tools recover gracefully when an action is renamed | Speculative — depends on the agent surface and client cache behavior. Renaming `'enqueue'` → `'run'` means an LLM that learned the old name from a prior conversation may attempt the old action and get a Zod validation error from the action enum. | low | medium | Could not validate this in-session. | Impact is a single failed tool call followed by an automatic retry with the corrected enum (the LLM sees the enum values in the error). Tolerable. |
| 12 | The complexity playbook's `pnpm complexity:scan` is genuinely useful as the "first thing the planner runs" — i.e., the script's output is a good kickoff for an interactive planning conversation | Inferred from the earlier scan in this session: the top entries are unambiguously the right refactor candidates (CC=924 server.ts, CC=192 display.ts, CC=136 pi-eforge index.ts). | high | n/a | already validated | Low — if the script's output is noisy, the planning conversation will surface that and we iterate. |

#### Summary

- All material assumptions validated as `high` confidence except #4 (medium, cheap-to-validate-during-impl), #6 (medium, cheap-post-impl), #9 (medium, cheap-during-impl), and #11 (low — but the impact is bounded to one wasted tool call).
- No low-confidence/high-impact assumptions are deferred without a validation path.
- Pre-existing divergence noted (#8: `agentRuntime` field) is explicitly out of scope and flagged for follow-up.

### Architecture Impact

#### Module boundaries

No new boundaries. Every change stays within existing packages (input, monitor, client, eforge, pi-eforge, eforge-plugin). The split between "playbook as input artifact" (`packages/input/`) and "playbook as orchestrated build" (`packages/monitor/` daemon dispatch + `packages/engine/` execution) is preserved.

#### Contract changes (breaking)

- **Playbook frontmatter wire shape** (Zod-validated): adds a new required field `mode`. Clients with the old shape fail validation. Mitigated by `DAEMON_API_VERSION` bump.
- **HTTP route rename**: `POST /api/playbook/enqueue` → `POST /api/playbook/run`. Old route returns 404.
- **HTTP route added**: `POST /api/session-plan/create-from-playbook`.
- **Response shape change**: `playbook/run` returns a discriminated union (`{ kind: 'enqueued' | 'planning', ... }`) instead of the flat `{ id }`.
- **MCP action enum**: `eforge_playbook.action` enum drops `'enqueue'` and adds `'run'`. Adds `mode` to nested `playbook.frontmatter` schema.
- **MCP action enum**: `eforge_session_plan.action` adds `'create-from-playbook'`.
- **Public TS exports**: `playbookToSessionPlan` (backward-compat alias) is removed. `playbookToPlanSeed` is added.

#### Control flow change

The `playbook/run` request now has two terminal flows:

- **Autonomous**: load playbook → `playbookToBuildSource` → `enqueuePrd` → `commitEnqueuedPrd` → return `{ kind: 'enqueued', id }`. The daemon emits queue-mutation events as today.
- **Planning**: load playbook → `playbookToPlanSeed` → `createSessionPlan` + write seeded sections → atomic write to `.eforge/session-plans/<id>.md` → return `{ kind: 'planning', session, path }`. **The daemon does NOT enqueue anything** and does not emit queue-mutation events.

The planning branch is purely a file-creation operation that uses no engine code. It's deliberately lightweight — the heavy lifting happens in the subsequent `/eforge:plan` conversation and eventual `/eforge:build` enqueue.

#### Public API surface

- Adds typed exports: `PlaybookMode`, `playbookToPlanSeed`, `SessionPlanCreateFromPlaybookRequest`, `SessionPlanCreateFromPlaybookResponse`, the discriminated `PlaybookRunResponse` union.
- Removes: `playbookToSessionPlan`, the `PlaybookEnqueueResponse` type (replaced by `PlaybookRunResponse`).

#### Deployment / operations

No change. The daemon restart story is unchanged — a `DAEMON_API_VERSION` bump triggers the existing version-mismatch UX, which already directs users to `eforge daemon restart`.

#### Engine boundary

The engine (`packages/engine/`) does NOT reference playbooks directly today (only via `playbookToBuildSource` output passed through the daemon enqueue path). That stays true after this change — planning-mode playbooks never enter the engine; only their post-planning session-plan outputs do, and those use the existing session-plan-to-build-source flow which is unchanged. This is consistent with the `engine-vs-wrapper-app` guardrail in `AGENTS.md`.

### Documentation Impact

#### Files that go stale and need updates in this PR

- **`eforge-plugin/skills/playbook/playbook.md`** — currently documents Create/Edit/Run/List/Promote/Demote branches without a `mode` concept. Must add: explanation of autonomous vs planning, prompt-the-user-for-mode in Create, mode-aware Run dispatch with two distinct post-run messages, mode-aware Edit (allow editing, warn on switch). Pin lines: the frontmatter shape block (around lines 122-129), and the validation/save section (around lines 140-150).
- **`eforge-plugin/skills/plan/plan.md`** — Step 1 "Session Setup" (lines 26-42) currently has two paths (resume vs new). Must add a third: "seed from a planning-mode playbook." Must also add a note that when a session's frontmatter has `seeded_from_playbook`, the skill should treat the pre-populated body content as starting context rather than re-prompting for the same material.

#### Generated reference docs

- **`packages/docs-gen/`** outputs (regenerated by `pnpm docs:generate`) include playbook frontmatter reference. The new `mode` field must appear in the generated reference. Verify with `pnpm docs:check` — if it fails, update the docs-gen inputs.
- The web docs site under `web/` consumes the generated artifacts via `pnpm docs:build`. No manual edits expected; regeneration handles it.

#### Files explicitly NOT changing

- **`README.md`** — playbooks are mentioned at the README level only briefly; the CLI surface name (`eforge playbook run`) is unchanged. No README update needed.
- **`CLAUDE.md`, `AGENTS.md`** — these document repo conventions (commit helpers, engine vs wrapper-app boundary, MCP parity rule). None of those conventions change. No edits.
- **`docs/roadmap.md`** — per `AGENTS.md`, the roadmap is "future only — remove items once they ship." This feature isn't a roadmap item and shouldn't be added retroactively. No edits.
- **PRDs in `docs/`** — per `AGENTS.md`, "delete PRDs after implementation — `docs/` should reflect current state and planned work only." No new PRD authored for this work; the session plan and the implementor's commit messages carry the rationale.

#### Skill docs that may need light touch-ups

- **`eforge-plugin/skills/build/build.md`** (if it exists) — verify it doesn't reference `playbook/enqueue` by name. If it does, update to `playbook/run`.
- **`eforge-plugin/skills/init/init.md`** — verify no playbook-related drift. Almost certainly clean.

#### Drift gates that will catch us

- **`pnpm docs:check`** — fails if generated reference docs are out of date relative to source schemas.
- **`pnpm test`** — including the test suite extensions in `code-impact`.
- **`pnpm type-check`** — catches stale type imports anywhere in the workspace.

#### What's NOT covered by docs in this PR

The complexity playbook itself includes user-facing instructions in its body (Goal, Out of scope, etc.), so its content is its own documentation. No separate doc page is needed for it.

### Risks

#### R1 — Stale clients see the version-mismatch wall

After `DAEMON_API_VERSION` bumps, any client (CLI, plugin MCP, Pi extension) loaded before the daemon restart will fail every call with `kind: version-mismatch`. We already hit this exact issue mid-session today (the plugin was at v30 against a v32 daemon). Impact: brief friction at deploy time; users may need to restart Claude Code (or their Pi session) to reload the plugin's bundled client. **Mitigation**: the version-mismatch error message already says "Restart the daemon … eforge daemon restart" — keep that text accurate and consider whether it should also suggest restarting the plugin. Low blast radius once the user reads the message; medium friction in the first 5 minutes after upgrade.

#### R2 — Out-of-tree playbooks without `mode` fail to load

A user with locally authored playbooks at `~/.eforge/playbooks/` or in another repo will see Zod validation errors after upgrading until they add `mode: autonomous` to each file. Per the `no-backward-compat` memory this is accepted. **Mitigation in this PR**: a clear error message from the parser (Zod default includes field name and message — confirmed by reading `playbookFrontmatterSchema`). Could be improved with a one-shot migration script, but that's explicitly out of scope.

#### R3 — Mode-switch mid-life is undefined for already-seeded sessions

If a user edits a playbook to switch from `autonomous` to `planning` (or vice versa) after some prior usage, no automatic invalidation flows backward to existing session plans seeded from that playbook. **In practice**: session plans are immutable artifacts on disk once created; they only carry `seeded_from_playbook: <name>` as a pointer. Changing the source playbook later doesn't (and shouldn't) alter past session plans. The risk surfaces only if a user expects "edit playbook re-seeds my open session" — which they shouldn't. Worth a one-line note in the playbook skill's Edit branch.

#### R4 — `eslint .` from repo root silently does nothing

By placing the ESLint config in `scripts/` (D12), running `node_modules/.bin/eslint .` from the repo root with no `--config` flag returns "no config found" — intentional, to avoid IDE leakage. **But**: a future contributor expecting "we have ESLint installed, just run it" will be confused. **Mitigation**: a one-line note in `scripts/scan-complexity.mjs`'s header (or `AGENTS.md`) explaining that ESLint is installed exclusively for the complexity scan and is not a general-purpose linter for this repo. Cheap, prevents confusion.

#### R5 — `eslint-plugin-sonarjs` major version may diverge over time

We pin `^4`. If the plugin's rule API changes between minors, the scan script breaks silently (warnings disappear, the script reports "no violations"). **Mitigation**: the script asserts at startup that `sonarjs/cognitive-complexity` is a known rule before parsing output; if missing, fail fast with a clear error. Low cost, catches the failure mode.

#### R6 — The planning-mode playbook UX is still novel; users may not discover it

The two existing playbooks are autonomous. A new user might not realize playbooks can also drive interactive planning. **Mitigation in this PR**: the playbook skill's Create branch surfaces the choice explicitly when authoring a new playbook; the plan skill's Step 1 surfaces "seed from playbook" alongside the existing options. Beyond that, discoverability is a follow-up concern (e.g., highlighting in `eforge playbook list` which playbooks are which mode), not blocking.

#### R7 — Tests for the seeded-session flow are fragile

`apiSessionPlanCreateFromPlaybook` writes to `.eforge/session-plans/` on disk. Tests touching real disk are brittle (parallel tests, leftover files, CI sandboxing). **Mitigation**: write to a temp directory in the test (use `fs.mkdtemp`); the existing playbook-API tests already do this (`test/playbook-api.test.ts`). Follow the same pattern.

#### R8 — Discriminated union response may confuse legacy CLI callers

If a user has scripted against `eforge playbook run <name>` and parses the printed `id` line, the planning-mode output won't include an `id` and may break their script. **Per the `no-backward-compat` memory**: accept. Document in the PR description that machine-consumers should pivot to the daemon HTTP API directly (which returns structured JSON with a discriminator).

#### R9 — The complexity playbook may produce a session plan that's hard to act on

If the top complexity hotspot is genuinely a redesign (e.g., the CC=924 monster in `server.ts`), the interactive planning may produce a session plan whose acceptance criteria require multiple PRs to land. **Mitigation**: the playbook's "Notes for the planner" specifies the decision rule (single huge function = full run; otherwise 2-3 medium ones). The planning skill enforces concrete code-impact / acceptance-criteria before marking `ready`. If the planner stalls because the work doesn't fit a single PR, that's a user-visible signal to scope down, not a quiet failure.

#### R10 — Performance: none material

Loading a playbook + writing a single session plan file is O(KB). The scan script (`pnpm complexity:scan`) runs ESLint over ~50K LOC of TS — observed in this session at sub-second to a few seconds. No regression risk.

## Scope

### In scope

1. **Schema**: add required `mode: 'autonomous' | 'planning'` field to `playbookFrontmatterSchema` in `packages/input/src/playbook.ts`. Add a parallel `playbookToPlanSeed()` helper alongside `playbookToBuildSource()`.
2. **Session-plan seed action**: new `create-from-playbook` action on `eforge_session_plan` (MCP + HTTP route + client helper). Adds an optional `seeded_from_playbook` field to `sessionPlanFrontmatterSchema`.
3. **Mode-aware playbook run**: rename `playbook/enqueue` route + handler + client helper to `playbook/run`. Handler dispatches by `playbook.mode` and returns a discriminated union `{ kind: 'enqueued', ... } | { kind: 'planning', ... }`. CLI/MCP/Pi surface the right post-run text.
4. **Skill updates**: `eforge-plugin/skills/playbook/playbook.md` (Create asks for mode; Run dispatches by mode) and `eforge-plugin/skills/plan/plan.md` (Step 1 gets a "seed from playbook" option).
5. **Existing playbooks**: add explicit `mode: autonomous` frontmatter to `eforge/playbooks/docs-implementation-sync.md` and `eforge/playbooks/plugin-pi-parity-audit.md`.
6. **New playbook**: author `eforge/playbooks/complexity-hotspot-reduction.md` (scope: project-team, mode: planning) as the first real planning-mode playbook + proof of the design.
7. **Measurement tooling** for that playbook: `scripts/scan-complexity.mjs`, `scripts/complexity.eslint.config.mjs`, root devDeps (`eslint`, `eslint-plugin-sonarjs`, `typescript-eslint`), and `pnpm complexity:scan` script in root `package.json`.
8. **Wire version bump** (`packages/client/src/api-version.ts`): increment `DAEMON_API_VERSION` per `AGENTS.md`.
9. **Plugin version bump** (`eforge-plugin/.claude-plugin/plugin.json`) per `AGENTS.md`.
10. **MCP tool parity** across `packages/eforge/src/cli/mcp-proxy.ts` and `packages/pi-eforge/extensions/eforge/index.ts` per `AGENTS.md`.
11. **Tests**: extend `test/playbook.test.ts`, `test/playbook-api.test.ts`, `test/cli-playbook.test.ts`, `test/session-plan.test.ts` (or new sibling) for mode field, dispatch behavior, and seed action.

### Explicitly NOT in scope

- **Actually doing any complexity refactor.** The new complexity playbook ships; running it produces a session plan; landing real CC reductions is a separate cycle.
- **Migration tooling for existing playbooks** beyond the two in this repo. If users out there have authored playbooks against the no-`mode` schema, they'll need to add `mode: autonomous` manually. Per the `no-backward-compat` memory, we don't ship a shim.
- **TypeBox migration of playbook/session-plan schemas.** Stays Zod per the roadmap.
- **Conversion of existing autonomous playbooks to planning mode.** `docs-implementation-sync` and `plugin-pi-parity-audit` remain autonomous.
- **A new "save plan as playbook" reverse flow.** That flow already exists in the playbook skill's Create branch (`eforge-plugin/skills/playbook/playbook.md` lines 60-64) and we don't change it.
- **Daemon scheduling / cron triggers for planning-mode playbooks.** Per `AGENTS.md`, scheduling belongs in wrapper apps, not the engine/daemon.

### Natural boundaries

- **Input/storage layer**: `packages/input/src/playbook.ts` and `session-plan.ts` (schema + helpers).
- **Daemon HTTP layer**: `packages/monitor/src/server.ts` (route rename + new route + dispatch).
- **Client wire layer**: `packages/client/src/` (routes, types, helpers, version).
- **CLI / MCP / Pi surface**: parity-required pair (`packages/eforge/src/cli/` ⟷ `packages/pi-eforge/extensions/eforge/`).
- **Plugin skills**: `eforge-plugin/skills/`.
- **Playbook content**: `eforge/playbooks/` + new `scripts/` tooling.

### Roadmap relation

Aligns with the **Extensibility** theme (playbooks become a richer extension point). No conflicts. The complexity-reduction playbook itself is not a roadmap item but is the first concrete example of the new shape.

## Acceptance Criteria

### Schema and validation

- `playbookFrontmatterSchema` rejects playbook files missing `mode`. Parse error names the missing field.
- `playbookFrontmatterSchema` rejects `mode` values other than `'autonomous'` or `'planning'`.
- The two existing playbooks (`docs-implementation-sync.md`, `plugin-pi-parity-audit.md`) carry `mode: autonomous` in frontmatter and `parsePlaybook` loads them clean.
- `playbookToBuildSource()` throws a typed error when called on a `mode: 'planning'` playbook.
- `playbookToPlanSeed()` throws a typed error when called on a `mode: 'autonomous'` playbook.

### Mode-aware run

- POST `/api/playbook/run` on an `autonomous` playbook enqueues a build (current behavior) and returns `{ kind: 'enqueued', queueItemId }`.
- POST `/api/playbook/run` on a `planning` playbook creates a session plan via the seed path and returns `{ kind: 'planning', session, path }`. It does NOT enqueue a build.
- The old `/api/playbook/enqueue` route returns 404 (renamed, no alias) per `no-backward-compat`.
- MCP `eforge_playbook` action `'enqueue'` is renamed to `'run'` in both `mcp-proxy.ts` and the Pi extension. The MCP response surfaces the discriminated kind so callers can branch on it.
- CLI `eforge playbook run <name>` (with existing `play` alias) prints autonomous post-run text ("enqueued as ...") or planning post-run text ("planning session ready at .eforge/session-plans/<id>.md — open with /eforge:plan to continue") based on `kind`.

### Session-plan seed action

- POST `/api/session-plan/create-from-playbook` with a `mode: 'planning'` playbook returns `{ session, path }` and the file on disk has:
  - `seeded_from_playbook: <name>` in frontmatter.
  - The playbook body content placed under the correct headings according to the mapping decision in `design-decisions`.
- The same route called with a `mode: 'autonomous'` playbook returns 400 with a message pointing to `playbook/run` for the autonomous flow.
- The same route returns 409 (or equivalent) if `session` is already used (does not overwrite an existing session).
- MCP `eforge_session_plan` exposes a new `'create-from-playbook'` action in both `mcp-proxy.ts` and the Pi extension with parity (same args, same response).

### Skill behavior

- `/eforge:playbook` Create branch prompts the user to choose `mode` (autonomous or planning) and writes it to frontmatter.
- `/eforge:playbook` Run branch dispatches by mode and prints the right next-step text.
- `/eforge:plan` Step 1 offers a "seed from a planning-mode playbook" option alongside "resume" and "create new." Choosing it lists `mode: 'planning'` playbooks (filtered from the regular list action), calls `create-from-playbook`, and continues into Step 2 of the plan flow.

### Existing playbook and version hygiene

- `eforge/playbooks/docs-implementation-sync.md` and `eforge/playbooks/plugin-pi-parity-audit.md` carry `mode: autonomous` in this PR.
- `DAEMON_API_VERSION` in `packages/client/src/api-version.ts` is incremented in this PR.
- `eforge-plugin/.claude-plugin/plugin.json` version is incremented in this PR.
- `packages/pi-eforge/package.json` version is NOT changed in this PR (handled at npm publish per `AGENTS.md`).

### Complexity playbook + measurement tooling

- `eforge/playbooks/complexity-hotspot-reduction.md` exists with `scope: project-team`, `mode: planning`, frontmatter validates, body parses.
- `pnpm complexity:scan` runs to exit-0 and prints a markdown table sorted by `churn × CC` descending, capped at 30 rows, with a "total addressable CC reduction" footer = `Σ (CC - 15)`. Output includes the CC=924 entry from `packages/monitor/src/server.ts` at or near rank 1.
- ESLint config lives at `scripts/complexity.eslint.config.mjs`; running ESLint from the repo root WITHOUT pointing at this config (i.e., `node_modules/.bin/eslint .`) fails with "no config found" — confirming the lint setup does not leak into IDE/general tooling.

### Tests

- `pnpm test` green. New cases include:
  - Playbook parser rejects missing/invalid `mode`.
  - `playbookToBuildSource` / `playbookToPlanSeed` mode assertions.
  - `apiPlaybookRun` discriminated union for both modes.
  - `apiSessionPlanCreateFromPlaybook` populates `seeded_from_playbook` and the correct body sections; rejects autonomous playbooks.
  - CLI `eforge playbook run` prints mode-specific post-run text.
- `pnpm type-check` clean.

### End-to-end smoke

- After `pnpm build && pnpm restart-daemon`, running the complexity playbook end-to-end completes the planning-mode flow: `eforge playbook run complexity-hotspot-reduction` returns the planning-mode response → file appears at `.eforge/session-plans/<id>.md` with playbook content → `/eforge:plan` resumes the session → marking it ready → `/eforge:build` enqueues from it without errors. Smoke level: confirm wiring works, not that a real complexity refactor lands.

### Documentation

- Generated reference docs reflect the new `mode` frontmatter field on playbooks. `pnpm docs:check` passes.
- `eforge-plugin/skills/playbook/playbook.md` documents the mode field and its semantics.
- `eforge-plugin/skills/plan/plan.md` documents the "seed from playbook" Step 1 option.
- No README changes required for this PR (user-facing CLI surface is unchanged in name).
