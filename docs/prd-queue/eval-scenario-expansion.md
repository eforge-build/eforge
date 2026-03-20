---
title: Eval Scenario Expansion
created: 2026-03-20
status: pending
---

# Eval Scenario Expansion

## Problem / Motivation

The eval suite has only 3 scenarios across 2 fixtures. This covers basic end-to-end validation but doesn't exercise the planner's key decisions: scope selection (errand/excursion/expedition), build stage composition (when to include test stages, TDD, doc-update), review perspective selection (code/security/docs), or skip detection. Recently added tester agents and dynamic test strategy make this gap more pressing - we need scenarios where the planner should and shouldn't include test stages.

## Goal

Expand the eval suite to 9 scenarios across 3 fixtures with assertion infrastructure that validates planner decisions (scope, build stages, perspectives, skip detection) - not just whether eforge succeeds and validation commands pass.

## Approach

### Naming Convention

**Format: `<fixture>-<scope>-<slug>`**

- `<fixture>` - project name (todo-api, notes-api, workspace-api)
- `<scope>` - expected profile scope (errand, excursion, expedition)
- `<slug>` - short kebab-case descriptor of the change type

Examples: `todo-api-errand-health-check`, `notes-api-excursion-refactor-store`

Rename existing 3 scenarios to match:

| Old | New |
|-----|-----|
| `todo-api-health-check` | `todo-api-errand-health-check` |
| `todo-api-auth` | `todo-api-excursion-jwt-auth` |
| `workspace-api-engagement` | `workspace-api-excursion-engagement` |

Note: workspace-api engagement was observed to scope as excursion (not expedition) in practice - the shared foundation changes to types.ts/store.ts/app.ts make the planner treat the work as tightly coupled. This is correct behavior.

### Scenario Inventory (9 total)

#### Errand (2)

**1. `todo-api-errand-health-check`** (existing, renamed)
- PRD: `docs/add-health-check.md`
- Tests: simple single-endpoint addition
- Expected: errand scope, no test stages, `perspectives: [code]`

**2. `notes-api-errand-update-docs`**
- PRD: Update stale README and API reference to match current codebase
- Tests: doc-only work should omit test stages entirely
- Expected: errand scope, no test-cycle/test-write, `perspectives: [docs]`
- Validation: `pnpm type-check && pnpm test` (existing tests still pass, no code changed)

#### Excursion (5)

**3. `todo-api-excursion-jwt-auth`** (existing, renamed)
- PRD: `docs/add-jwt-auth.md`
- Tests: multi-file security feature, should include test stages and security perspective
- Expected: excursion scope, build includes test-cycle, `perspectives` includes `security`

**4. `workspace-api-excursion-engagement`** (existing, renamed)
- PRD: `docs/add-engagement-features.md`
- Tests: 3 features with shared foundation changes - excursion because type changes cascade
- Expected: excursion scope, build includes test-cycle

**5. `notes-api-excursion-refactor-store`**
- PRD: Extract generic `EntityStore<T>` from duplicated notes/tags store patterns
- Tests: architectural refactor where type changes cascade to consumers - excursion not expedition
- Expected: excursion scope, build includes implement + review-cycle. Existing tests validate correctness.
- Validation: `pnpm install && pnpm type-check && pnpm test`

**6. `notes-api-excursion-dead-code`**
- PRD: Remove unused `src/legacy/` files and dead functions in `src/utils/`
- Tests: cleanup work should omit test stages (removing dead code doesn't need new tests)
- Expected: errand or excursion scope, no test-cycle/test-write
- Validation: `pnpm type-check && pnpm test && ! test -f src/legacy/importer.ts && ! test -f src/legacy/migrator.ts`

**7. `notes-api-excursion-search`**
- PRD: Add `GET /notes/search?q=<query>` with well-specified test cases in the PRD
- Tests: feature with testable behavior and explicit test spec - should trigger test stages, possibly TDD
- Expected: excursion scope, build includes test-cycle (or test-write + test-cycle for TDD)
- Validation: `pnpm install && pnpm type-check && pnpm test`

#### Expedition (1)

**8. `workspace-api-expedition-extensions`** (new)
- PRD: `docs/add-extension-modules.md` - adds 3 truly independent feature modules that each create only new files, reading from existing entities but never modifying shared code
  - Module 1: **Message bookmarks** - users save messages for later (new store, routes, tests)
  - Module 2: **Channel categories** - organize channels into named groups (new store, routes, tests)
  - Module 3: **User activity log** - track read cursors and last-seen timestamps per user (new store, routes, tests)
- Why this is expedition: each module creates isolated files (`src/stores/`, `src/routes/`, `test/`), imports existing types/store for reads only, no shared foundation mutations. The only shared change is trivial router wiring in app.ts (3 import + 3 app.use lines).
- Expected: expedition scope, 3+ plans, architecture review + module planning + cohesion review
- Validation: `pnpm install && pnpm type-check && pnpm test`

#### Skip Detection (1)

**9. `todo-api-errand-skip`**
- PRD: Describes in-memory todo store with CRUD ops - exactly what `db.ts` already implements
- Tests: planner should detect work is already complete and emit `plan:skip`
- Expected: `plan:skip` event in monitor.db, no build phase
- Validation: none (no build runs). Assert skip event presence.

### Planning Decision Coverage Matrix

| Decision | Scenarios Testing It |
|----------|---------------------|
| Scope: errand | #1, #2, #9 |
| Scope: excursion | #3, #4, #5, #6, #7 |
| Scope: expedition | #8 |
| Test stages included | #3 (security feature), #4 (engagement), #7 (well-specified tests) |
| Test stages excluded | #1 (simple endpoint), #2 (doc-only), #6 (cleanup) |
| TDD potential | #7 (explicit test cases in PRD) |
| Security perspective | #3 (JWT auth) |
| Docs perspective | #2 (doc-only changes) |
| Skip detection | #9 (work already done) |
| Refactor scope (excursion not expedition) | #5 (type cascading) |
| Dead code removal | #6 |
| Expedition decomposition | #8 (independent modules, no shared foundation) |

### New Fixture: `notes-api`

A notes + tags Express API with intentional imperfections baked in for doc-only, dead-code, and refactor scenarios.

#### File structure

```
eval/fixtures/notes-api/
  .gitignore
  package.json              # Same deps as todo-api (express, vitest, tsx, typescript)
  tsconfig.json
  vitest.config.ts
  eforge.yaml               # Same hook config as other fixtures
  docs/
    README.md               # INTENTIONALLY STALE: mentions CSV import, omits tag endpoints
    api-reference.md         # INTENTIONALLY STALE: wrong response shapes, missing endpoints
    prd/
      update-docs.md         # Scenario #2: fix stale docs
      refactor-store.md      # Scenario #4: extract EntityStore<T>
      dead-code-cleanup.md   # Scenario #5: remove legacy/ and dead utils
      add-search.md          # Scenario #6: search endpoint with test spec
  src/
    app.ts                   # Express app, wires routes
    index.ts                 # Entry point
    types.ts                 # Note, Tag interfaces
    store.ts                 # In-memory store for notes + tags (duplicated patterns)
    routes/
      notes.ts               # Note CRUD (GET/POST/PATCH/DELETE /notes)
      tags.ts                # Tag CRUD (GET/POST/DELETE /tags)
    utils/
      format.ts              # formatDate(), truncate() (USED) + formatCsv() (DEAD)
      validate.ts            # validateTitle() (USED) + validateCsvRow() (DEAD)
    legacy/
      importer.ts            # DEAD: parseCSV(), importNotes() - imported by nothing
      migrator.ts            # DEAD: migrate() - only imported by importer.ts
  test/
    notes.test.ts
    tags.test.ts
    format.test.ts           # Tests for used format utils only
```

#### Design notes

- `store.ts` duplicates the same create/get/update/delete pattern for both notes and tags - gives the refactor scenario something real to extract
- `src/legacy/` is completely dead code - nothing in app.ts, routes, or tests imports it
- `src/utils/format.ts` has dead functions mixed with live ones - tests dead code cleanup within live files
- `docs/README.md` references the CSV import feature as if it still exists - gives the doc-update scenario real staleness to fix
- Fixture must pass `pnpm install && pnpm type-check && pnpm test` as-is before any eforge changes

### New PRD: `workspace-api/docs/add-extension-modules.md`

Three independent feature modules for workspace-api - designed to be unambiguously expedition-scoped. Each module creates only new files (store, routes, tests) and reads from existing entities without modifying shared code. The only shared change is router wiring in app.ts.

- **Message bookmarks**: `POST/GET/DELETE /users/:userId/bookmarks` - save messages for later reference. New files: `src/stores/bookmarks.ts`, `src/routes/bookmarks.ts`, `test/bookmarks.test.ts`
- **Channel categories**: `POST/GET/PATCH/DELETE /workspaces/:workspaceId/categories` + `PUT/DELETE /categories/:id/channels/:channelId` - organize channels into named groups. New files: `src/stores/categories.ts`, `src/routes/categories.ts`, `test/categories.test.ts`
- **User activity log**: `GET/PUT /users/:userId/activity` - track per-channel read cursors and last-seen timestamps. New files: `src/stores/activity.ts`, `src/routes/activity.ts`, `test/activity.test.ts`

### New PRD: `todo-api/docs/skip-already-done.md`

Describes exactly what `db.ts` already implements: a Todo interface with id/title/completed/createdAt, plus getAllTodos, getTodoById, createTodo, updateTodo, deleteTodo, clearTodos. The planner should recognize this is fully implemented and emit `<skip>`.

### Assertion Infrastructure

#### Add `expect` field to scenarios.yaml

```yaml
- id: notes-api-errand-update-docs
  fixture: notes-api
  prd: docs/prd/update-docs.md
  validate: [pnpm type-check, pnpm test]
  description: "Update stale README and API reference"
  expect:
    mode: errand                        # orchestration.yaml mode field
    buildStagesExclude: [test-cycle, test-write, test]
```

Expect fields (all optional):
- `mode` - expected orchestration.yaml mode (errand/excursion/expedition)
- `buildStagesContain` - stages that must appear in at least one plan's build config
- `buildStagesExclude` - stages that must NOT appear in any plan's build config
- `skip` - boolean, expect a `plan:skip` event (no build phase)

#### Preserve orchestration.yaml

In `run-scenario.sh`, after eforge completes and before workspace cleanup, copy `plans/*/orchestration.yaml` to the scenario output dir. This gives assertion checking direct access to the planner's decisions.

#### Create `eval/lib/check-expectations.ts`

Reads `result.json` + preserved `orchestration.yaml` + scenario expect config. Checks:
1. Mode matches `expect.mode` (from orchestration.yaml)
2. Build stages contain/exclude (from orchestration.yaml plan entries)
3. Skip event presence (from monitor.db `plan:skip` event)

Returns structured pass/fail per assertion. Results appended to `result.json` under an `expectations` key.

#### Integrate into runner

- `run-scenario.sh`: after `build-result.ts`, run `check-expectations.ts` if expect config is present
- `run.sh` summary table: add an "Expect" column showing assertion pass/fail alongside Eforge/Validate columns
- Summary counts: a scenario "passes" only if eforge succeeds AND validations pass AND expectations pass

#### Extract expectations from scenarios.yaml

Extend `parse_scenarios()` in `run.sh` to parse and pass the `expect` JSON to `run-scenario.sh`.

### Implementation Order

#### Step 1: Naming rename
Rename 3 existing scenario IDs in `scenarios.yaml`. No other changes needed - result dirs are timestamped and auto-pruned.

#### Step 2: Assertion infrastructure
- Add `expect` field parsing to `run.sh`'s `parse_scenarios()`
- Add orchestration.yaml preservation to `run-scenario.sh`
- Create `eval/lib/check-expectations.ts`
- Wire into runner and summary table

#### Step 3: `notes-api` fixture
Create all source files, tests, stale docs, dead code. Verify `pnpm install && pnpm type-check && pnpm test` passes.

#### Step 4: New PRDs
- `notes-api/docs/prd/update-docs.md`
- `notes-api/docs/prd/refactor-store.md`
- `notes-api/docs/prd/dead-code-cleanup.md`
- `notes-api/docs/prd/add-search.md`
- `workspace-api/docs/add-extension-modules.md`
- `todo-api/docs/skip-already-done.md`

#### Step 5: scenarios.yaml
Add all 6 new scenarios with expect configs. Add expect configs to 3 renamed scenarios.

#### Step 6: Dry-run validation
`eval/run.sh --dry-run` to verify fixtures copy and init correctly.

## Scope

### In Scope

- Rename 3 existing scenarios to match `<fixture>-<scope>-<slug>` convention
- Build assertion infrastructure (`expect` field in scenarios.yaml, `check-expectations.ts`, orchestration.yaml preservation, runner integration with Expect column)
- Create `notes-api` fixture (~15 files) with intentional imperfections (stale docs, dead code, duplicated store patterns)
- Create 4 new PRDs for notes-api scenarios (update-docs, refactor-store, dead-code-cleanup, add-search)
- Create `workspace-api/docs/add-extension-modules.md` expedition PRD
- Create `todo-api/docs/skip-already-done.md` skip detection PRD
- Add all 6 new scenarios to `scenarios.yaml` with expect configs
- Add expect configs to 3 renamed existing scenarios

### Out of Scope

N/A

## Acceptance Criteria

### Critical Files

**Modified:**
- `eval/scenarios.yaml` - rename existing + add new scenarios + expect fields
- `eval/lib/run-scenario.sh` - orchestration.yaml preservation + expectation checking
- `eval/run.sh` - parse expect config, summary table Expect column

**Created:**
- `eval/lib/check-expectations.ts` - assertion checker
- `eval/fixtures/notes-api/` - entire new fixture (~15 files)
- `eval/fixtures/todo-api/docs/skip-already-done.md` - skip detection PRD
- `eval/fixtures/workspace-api/docs/add-extension-modules.md` - expedition PRD
- `eval/fixtures/notes-api/docs/prd/*.md` - 4 new PRDs

### Verification

1. `eval/run.sh --dry-run` - all 9 scenarios initialize without errors
2. `cd eval/fixtures/notes-api && pnpm install && pnpm type-check && pnpm test` - fixture is self-consistent
3. `eval/run.sh todo-api-errand-health-check` - renamed scenario still works, expectation checking runs
4. Full suite: `eval/run.sh` - all 9 scenarios run end-to-end (this is expensive, ~60-120 min)
