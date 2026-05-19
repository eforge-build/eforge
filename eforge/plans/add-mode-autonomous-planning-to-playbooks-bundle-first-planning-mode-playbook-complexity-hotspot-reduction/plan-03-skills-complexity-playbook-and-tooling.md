---
id: plan-03-skills-complexity-playbook-and-tooling
name: Plugin skills, complexity-hotspot-reduction playbook, and complexity scan
  tooling
branch: add-mode-autonomous-planning-to-playbooks-bundle-first-planning-mode-playbook-complexity-hotspot-reduction/plan-03-skills-complexity-playbook-and-tooling
agents:
  builder:
    effort: high
    rationale: "Three orthogonal surfaces in one plan (markdown skill rewrites, a
      flat-config ESLint scan script, and a new planning-mode playbook). The
      skill rewrites are judgment-heavy: the playbook skill's Create branch must
      prompt for mode without breaking the existing auto-classify scope flow,
      and the plan skill's Step 1 must add a third path that lists/filters/seeds
      without making the resume vs new-vs-seed branching confusing."
---

# Plugin skills, complexity-hotspot-reduction playbook, and complexity scan tooling

## Architecture Context

plan-01 + plan-02 made planning-mode playbooks possible end-to-end at the wire level. This plan ships the user-visible surface that turns the new shape into something a user can actually invoke and that demonstrates real value:

1. The `/eforge:playbook` skill (Create/Edit/Run branches) becomes mode-aware so a user authoring a new playbook is asked which mode it is, and so the Run branch prints the right next-step text.
2. The `/eforge:plan` skill (Step 1: Session Setup) grows a third option alongside resume and new — "seed from a planning-mode playbook" — that lists playbooks filtered to `mode === 'planning'`, asks the user which to use, and calls `eforge_session_plan { action: 'create-from-playbook', playbook_name, session, topic }` before continuing into Step 2.
3. The first concrete planning-mode playbook ships: `complexity-hotspot-reduction`. Its body kicks off a planning conversation seeded by the output of `pnpm complexity:scan`, which is the second deliverable in this plan: a small Node script that runs `eslint-plugin-sonarjs`'s `cognitive-complexity` rule and combines it with git churn to produce a sorted markdown table.
4. The plugin version bumps per the `AGENTS.md` rule. The Pi npm package version explicitly does NOT bump (per `AGENTS.md`, it's versioned at publish time).

## Implementation

### Overview

1. **`/eforge:playbook` skill rewrites** (`eforge-plugin/skills/playbook/playbook.md`):
   - Document the `mode` frontmatter field with autonomous vs planning semantics in the introductory section (around lines 1-15).
   - In **Branch: Create (Step 3)**, after the scope-classification subflow (around the current line 70-150 area), add a `mode` question: "Is this an **autonomous** playbook (eforge builds it without further prompting — hand-off-and-forget) or a **planning** playbook (it seeds a `/eforge:plan` session that you finalize interactively)?" Pre-populate the question with a heuristic: if the description mentions "audit", "refactor decision", "choose", "per-target judgment", or similar judgment-heavy language, suggest `planning`. Otherwise default to `autonomous`. Write the chosen mode into the playbook frontmatter passed to `eforge_playbook { action: 'save' }`.
   - In **Branch: Run (Step 5)**, switch the post-run text by the discriminated response's `kind` field. For `'enqueued'`: keep the existing "enqueued as <id>" line and point at the monitor UI. For `'planning'`: print "Planning session ready at `<path>`. Open `/eforge:plan` to continue" and offer to launch `/eforge:plan` resume.
   - In **Branch: Edit (Step 4)**, allow editing `mode`. When the user switches mode mid-life, emit a one-line warning that the change does NOT alter any session plans previously seeded from this playbook (those are immutable on disk).
2. **`/eforge:plan` skill rewrites** (`eforge-plugin/skills/plan/plan.md`):
   - In **Step 1: Session Setup**, restructure the resume-vs-new branching to a three-option presentation: (a) resume, (b) new, (c) seed from a planning-mode playbook.
   - Option (c) workflow: call `mcp__eforge__eforge_playbook { action: 'list' }`, filter results to entries whose frontmatter `mode === 'planning'` (the `list` response already includes frontmatter — confirmed against the listing route output shape), ask the user which playbook to use, generate a session id `{YYYY-MM-DD}-{playbook-name}`, call `mcp__eforge__eforge_session_plan { action: 'create-from-playbook', playbook_name, session, topic, open: true }`. Then jump to Step 2 with the seeded plan as starting context.
   - Add a sub-note: when a session has `seeded_from_playbook` in its frontmatter, Step 2 (Gather Context) treats the pre-populated body headings (Goal / Out of scope / Acceptance criteria / Notes from playbook) as starting context — does NOT re-prompt for them, but allows the user to edit any of them as the conversation progresses.
3. **Plugin version bump** (`eforge-plugin/.claude-plugin/plugin.json`): bump the patch version one notch (currently `0.25.13`).
4. **Complexity scan script** (`scripts/scan-complexity.mjs`):
   - Node script (no transpile) that uses `node:child_process` and `node:fs/promises`.
   - Runs `node_modules/.bin/eslint --no-config-lookup --config scripts/complexity.eslint.config.mjs --format json packages/**/*.ts`.
   - Pre-flight check: imports `eslint-plugin-sonarjs` and asserts that `sonarjs/cognitive-complexity` is a registered rule key (per source R5). Fails fast with a clear error message if missing.
   - For each file with at least one violation, runs `git log --since='1 year ago' --pretty=format: --name-only -- <file> | grep -c .` (or a Node equivalent that counts non-empty lines from `git log`'s stdout) to compute `churn`.
   - For each violation message, extracts the cognitive-complexity number from the message text (sonarjs reports it like `Refactor this function to reduce its Cognitive Complexity from N to the 30 allowed.`) and stores the highest CC per file.
   - Sorts the file list by `churn × maxCC` descending, caps at 30 rows, prints a markdown table with columns `Rank | File:line | CC | Churn | churn × CC`, then a footer line: `Total addressable CC reduction: Σ(CC - 15) = N` summed across the printed rows.
   - A short header comment at the top of the script notes that ESLint is installed exclusively for this scan and is not a general-purpose linter for this repo (per source R4 mitigation).
5. **Complexity ESLint config** (`scripts/complexity.eslint.config.mjs`):
   - Flat config (ESLint 9). Single entry that targets `packages/**/*.ts`, ignores `**/node_modules/**`, `**/dist/**`, `**/test/**`, `**/*.test.ts`, `**/*.spec.ts`.
   - Imports `typescript-eslint` parser, sets `parser` and `parserOptions.project: false` (we don't need types for the cognitive-complexity rule, and skipping the project keeps the scan fast).
   - Registers `eslint-plugin-sonarjs` as a plugin and enables `'sonarjs/cognitive-complexity': ['warn', 30]`.
   - File placement under `scripts/` (not repo root) per source D12 so `eslint .` from the repo root finds no config.
6. **Root devDeps and script** (`package.json`):
   - Add to `devDependencies`: `"eslint": "^9"`, `"eslint-plugin-sonarjs": "^4"`, `"typescript-eslint": "^8"`.
   - Add to `scripts`: `"complexity:scan": "node scripts/scan-complexity.mjs"`.
7. **`complexity-hotspot-reduction` playbook** (`eforge/playbooks/complexity-hotspot-reduction.md`):
   - Frontmatter: `name: complexity-hotspot-reduction`, `description: Run a complexity audit, pick top hotspots, and plan focused refactors`, `scope: project-team`, `mode: planning`.
   - `## Goal`: instruct the planner to run `pnpm complexity:scan`, read the top 3 entries' source code, and produce a session plan whose acceptance criteria are specific function refactors. Use the explicit decision rule from source R9: single huge function (CC > 500) → one full run focused on that function; otherwise 2-3 medium hotspots in one session plan.
   - `## Out of scope`: speculative redesigns, refactors that change public API surface, performance tuning unrelated to complexity reduction.
   - `## Acceptance criteria`: per-hotspot — the refactor approach (table-driven dispatch / extract-helpers / split-by-discriminant) is chosen and named; each hotspot has a specific CC target; the resulting session plan's `code-impact` dimension lists every file the refactor touches.
   - `## Notes for the planner`: in the seeded session plan, this becomes `## Notes from playbook` per the mapping in plan-01. Include the decision-rule reminder, a pointer to `scripts/scan-complexity.mjs` for re-running the scan during planning, and a callout that `eforge-plugin-* skills must remain generic` (so this playbook can be reused by other repos that adopt the scan script).

### Key Decisions

1. **Mode prompt heuristic in Create.** Default to autonomous when the description reads mechanical ("audit X", "update Y", "keep Z synced"); default to planning when it reads judgment-heavy ("choose", "decide per-target", "pick the best refactor for each"). The user can always override. Surfacing the choice explicitly aligns with source D8.
2. **List-filter in the plan skill is client-side.** Per source D6, the existing `eforge_playbook { action: 'list' }` already returns frontmatter; the plan skill filters in markdown logic. No new MCP filter action.
3. **The complexity playbook is the one bundled use case.** Other domains can author their own planning-mode playbooks following its template; this PR doesn't try to bundle more.
4. **ESLint config lives in `scripts/` (D12).** Keeps `eslint .` from the repo root unconfigured so IDE plugins don't auto-load it.
5. **Threshold = 30, plugin = `eslint-plugin-sonarjs@^4`** per source D11 + the user's earlier in-session decision.
6. **No README changes.** The user-facing CLI surface name (`eforge playbook run`) is unchanged; per source's Documentation Impact, README stays.

## Scope

### In Scope
- Two skill rewrites (`playbook.md`, `plan.md`) and the plugin version bump.
- New `eforge/playbooks/complexity-hotspot-reduction.md`.
- New `scripts/scan-complexity.mjs` and `scripts/complexity.eslint.config.mjs`.
- Root `package.json` devDeps + new `complexity:scan` script.
- Regenerated reference docs (via `pnpm docs:generate` as part of doc-sync).
- Adding a vitest case to `test/playbook.test.ts` that loads `eforge/playbooks/complexity-hotspot-reduction.md` via `parsePlaybook` and asserts `mode === 'planning'` (referenced by the verification criterion below).

### Out of Scope
- Actually running the complexity playbook end-to-end to produce a real session plan. The smoke-test acceptance criterion confirms the wiring; the substantive complexity refactor is its own future cycle.
- A new "save plan as playbook" reverse flow (already exists; not changed).
- Migration tooling for out-of-tree playbooks.
- Bumping `packages/pi-eforge/package.json` (handled at npm publish).
- Daemon scheduling / cron for planning-mode playbooks (belongs in wrapper apps per `AGENTS.md`).

## Files

### Create
- `scripts/scan-complexity.mjs` — Node script described above.
- `scripts/complexity.eslint.config.mjs` — flat ESLint config described above.
- `eforge/playbooks/complexity-hotspot-reduction.md` — the first planning-mode playbook, content described in Implementation step 7.

### Modify
- `eforge-plugin/skills/playbook/playbook.md` — mode field documented; Create branch prompts for mode with heuristic default; Run branch dispatches by `kind`; Edit branch allows mode editing with a mid-life-warning callout.
- `eforge-plugin/skills/plan/plan.md` — Step 1 grows a third path (seed from planning-mode playbook); a sub-note added that `seeded_from_playbook` plans skip re-prompting for the pre-populated headings.
- `eforge-plugin/.claude-plugin/plugin.json` — bump `version` field (currently `0.25.13`) one patch level.
- `package.json` — add `eslint`, `eslint-plugin-sonarjs`, `typescript-eslint` to `devDependencies`. Add `"complexity:scan": "node scripts/scan-complexity.mjs"` to `scripts`.
- `test/playbook.test.ts` — add a case that loads `eforge/playbooks/complexity-hotspot-reduction.md` via `parsePlaybook` and asserts the parsed `mode` is `'planning'` (this is the test referenced by the verification criterion below; complements the parser/helper tests added in plan-01).

## Verification

- [ ] `pnpm install` succeeds with the three new devDeps. The lockfile updates accordingly.
- [ ] `pnpm complexity:scan` exits 0 and prints a markdown table sorted by `churn × CC` descending, capped at 30 rows, with a `Total addressable CC reduction:` footer line whose value equals `Σ(CC - 15)` across the printed rows. The output table includes a row whose `File:line` references `packages/monitor/src/server.ts` at or near rank 1 (the CC=924 outlier identified in the source).
- [ ] Running `node_modules/.bin/eslint .` from the repo root WITHOUT `--config` exits non-zero with a message indicating no ESLint configuration was found (confirming the scan config does not leak per source D12 / R4).
- [ ] `pnpm test` passes; no new test failures introduced.
- [ ] `pnpm type-check` passes.
- [ ] `pnpm docs:check` passes; if generated reference docs reference playbook frontmatter, they now include `mode` (verified by running `pnpm docs:generate` and inspecting the diff or by `pnpm docs:check` passing after generation).
- [ ] `eforge/playbooks/complexity-hotspot-reduction.md` parses via `parsePlaybook` (verified by a vitest case in `test/playbook.test.ts` that loads each bundled playbook and asserts it parses with the expected `mode`).
- [ ] `eforge-plugin/.claude-plugin/plugin.json` `version` field increments. `packages/pi-eforge/package.json` `version` field does NOT change.
- [ ] End-to-end smoke (manual or scripted in a separate CI job): from a clean worktree after `pnpm build && pnpm restart-daemon`, running `eforge playbook run complexity-hotspot-reduction` returns a response with `kind: 'planning'`; the file at `.eforge/session-plans/<id>.md` exists and contains `seeded_from_playbook: complexity-hotspot-reduction` in its frontmatter; the `## Goal`, `## Out of scope`, `## Acceptance criteria`, and `## Notes from playbook` headings are present in the body.
- [ ] `eforge-plugin/skills/playbook/playbook.md` contains the strings `mode: autonomous`, `mode: planning`, and a question prompt that contains both `autonomous` and `planning` (verified by file-content grep in a test or a manual review checklist).
- [ ] `eforge-plugin/skills/plan/plan.md` Step 1 section contains text referencing `seed`, `playbook`, and `create-from-playbook` (verified by grep).
