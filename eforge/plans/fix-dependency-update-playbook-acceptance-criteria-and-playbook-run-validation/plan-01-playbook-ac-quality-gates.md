---
id: plan-01-playbook-ac-quality-gates
name: Dependency-Update Playbook AC Quality Gates
branch: fix-dependency-update-playbook-acceptance-criteria-and-playbook-run-validation/plan-01-playbook-ac-quality-gates
---

# Dependency-Update Playbook AC Quality Gates

## Architecture Context

Autonomous playbooks compile to PRD-style build source through `playbookToBuildSource()` in `@eforge-build/input`. Normal standalone enqueue applies the acceptance-criteria quality gate before queue mutation, but the daemon playbook run route currently formats an autonomous playbook and calls `enqueuePrd()` directly. The monitor package already depends on `@eforge-build/input`, which exports `analyzeAcceptanceCriteria`, `analyzeAcceptanceCriteriaInBody`, and `formatAcDiagnostics`, so the daemon can reuse the shared analyzer rather than adding route-local validation logic.

The bundled `eforge/playbooks/dependency-update.md` must also stop using nested/grouped acceptance criteria and command-only bullets because the analyzer flattens nested list items into independent criteria.

## Implementation

### Overview

Update the dependency-update playbook's acceptance criteria to be flat, standalone, and durable. Then add daemon-side AC-quality gates to `POST /api/playbook/save` and `POST /api/playbook/run` before any filesystem queue/playbook mutation occurs. Add route-level regression tests plus a bundled-playbook regression test.

### Key Decisions

1. Reuse `@eforge-build/input` analyzer exports in `packages/monitor/src/server.ts`. This keeps the daemon save/run gates aligned with the existing session-plan and engine enqueue gates.
2. Use HTTP 400 with `formatAcDiagnostics()` text in the JSON `error` field for AC-quality failures. This matches the route's existing invalid-request pattern and avoids a daemon API version bump because success wire shapes do not change.
3. Validate save payload acceptance criteria after constructing the typed playbook object and before `writePlaybook()`. This prevents both new-file creation and overwrites on invalid AC content.
4. Validate autonomous run source immediately after `const plan = playbookToBuildSource(playbook)` and before profile validation, dependency validation, `enqueuePrd()`, and `notifyQueueMutation()`. This makes invalid autonomous playbooks fail before queue state changes.

## Scope

### In Scope

- Rewrite `eforge/playbooks/dependency-update.md` acceptance criteria as a flat list of standalone, objectively verifiable bullets.
- Add dependency-update criteria requiring a tracked evidence artifact in the implementation diff.
- Require that evidence artifact to record `pnpm audit` exit status and findings; manifest and lockfile diff-review conclusions; unexpected package findings; lifecycle-script, repository, maintainer, and native/build-behavior inspection for newly introduced, major-version, or suspicious package changes; and `npm diff` conclusions or an explicit statement that no risky/high-impact package changes required `npm diff`.
- Convert validation command bullets to outcome statements: `` `pnpm build` exits 0. ``, `` `pnpm type-check` exits 0. ``, and `` `pnpm test` exits 0. ``.
- Add AC-quality validation to `POST /api/playbook/save` before playbook writes.
- Add AC-quality validation to `POST /api/playbook/run` before queue writes and queue notifications.
- Add route-level tests for invalid save payloads and invalid autonomous playbook runs.
- Add bundled-playbook AC-quality regression coverage.

### Out of Scope

- Redesigning the PRD formatter, AC extractor, or acceptance validator semantics.
- Changing `unknown` acceptance-validation verdict behavior.
- Adding a new evidence-artifact subsystem.
- Adding route-level validation to endpoints not listed in this plan.
- Duplicating analyzer unit coverage already present in `test/acceptance-criteria-quality.test.ts`.
- Bumping `DAEMON_API_VERSION`.

## Files

### Create

- None expected.

### Modify

- `eforge/playbooks/dependency-update.md` — Replace nested/grouped acceptance criteria and bare command bullets with a flat criteria list; add durable tracked evidence-artifact requirements.
- `packages/monitor/src/server.ts` — Import analyzer helpers from `@eforge-build/input` inside the save/run handlers; reject invalid AC content with HTTP 400 before mutation.
- `test/playbook-api.test.ts` — Add daemon route tests for save-time AC rejection, no create, no overwrite, run-time AC rejection, no queue markdown files, and no auto-build wake.
- `test/playbook.test.ts` — Extend bundled playbook coverage so every bundled playbook with an acceptance-criteria section passes `analyzeAcceptanceCriteria()`.

## Implementation Notes

### Dependency-update playbook wording

Use standalone bullets similar to the following shape; adjust prose only if the analyzer still reports diagnostics:

- Dependencies are updated using this repo's workspace-aware pnpm workflow.
- `package.json` files and `pnpm-lock.yaml` are updated consistently.
- Workspace/internal `workspace:*` dependencies remain intact.
- A tracked dependency-update evidence artifact is added or updated in the implementation diff.
- The tracked dependency-update evidence artifact records `pnpm audit` exit status.
- The tracked dependency-update evidence artifact records `pnpm audit` findings.
- The tracked dependency-update evidence artifact records manifest diff-review conclusions.
- The tracked dependency-update evidence artifact records lockfile diff-review conclusions.
- The tracked dependency-update evidence artifact records whether unexpected new packages were found.
- The tracked dependency-update evidence artifact records lifecycle-script inspection for newly introduced, major-version, or suspicious package changes.
- The tracked dependency-update evidence artifact records repository inspection for newly introduced, major-version, or suspicious package changes.
- The tracked dependency-update evidence artifact records maintainer inspection for newly introduced, major-version, or suspicious package changes.
- The tracked dependency-update evidence artifact records native/build-behavior inspection for newly introduced, major-version, or suspicious package changes.
- The tracked dependency-update evidence artifact records `npm diff` review conclusions for risky or high-impact package changes.
- The tracked dependency-update evidence artifact states that no package changes required `npm diff` when no risky or high-impact package changes are present.
- `pnpm build` exits 0.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- Any dependency-related breakages are fixed with minimal, targeted changes.

### Save route gate

In `POST /api/playbook/save`:

1. Extend the existing dynamic import from `@eforge-build/input` to include `analyzeAcceptanceCriteria` and `formatAcDiagnostics`.
2. After constructing `playbook`, run `const acQuality = analyzeAcceptanceCriteria(playbook.acceptanceCriteria);`.
3. If `!acQuality.valid`, return HTTP 400 before `getConfigDir()`/`writePlaybook()` with an error string containing `Playbook acceptance criteria quality gate failed:` and `formatAcDiagnostics(acQuality.diagnostics)`.
4. Keep existing frontmatter and missing-goal validation behavior unchanged.

### Run route gate

In the autonomous branch of `POST /api/playbook/run`:

1. Extend the dynamic import from `@eforge-build/input` to include `analyzeAcceptanceCriteriaInBody` and `formatAcDiagnostics`.
2. Compute `const plan = playbookToBuildSource(playbook);` at the start of the autonomous branch.
3. Run `const acQuality = analyzeAcceptanceCriteriaInBody(plan.source);` immediately after formatting.
4. If `acQuality && !acQuality.valid`, return HTTP 400 before profile validation, `validateDependsOnExists()`, `enqueuePrd()`, or `notifyQueueMutation()`.
5. Keep planning-mode playbook behavior unchanged.

### Tests

Add tests in `test/playbook-api.test.ts` using the existing in-process server helpers:

- Save create rejection: POST a playbook payload with acceptance criteria containing a grouping label, a bare command, and a vague criterion. Assert status 400; JSON error text includes `Acceptance criteria quality issues`, `[grouping-label]`, `[bare-command]`, `[vague]`, and representative criterion text; the target playbook file does not exist.
- Save overwrite rejection: create an existing playbook file, POST a save payload with the same name and invalid acceptance criteria, assert status 400, and assert file contents equal the sentinel original content.
- Run rejection: write an invalid autonomous playbook directly to `eforge/playbooks/`, call `POST /api/playbook/run`, assert status 400 and diagnostic text, assert `.eforge/queue` contains zero markdown files or does not exist, and assert `autoBuildWakeReasons` remains `[]`.
- Run validation ordering: call `POST /api/playbook/run` for an invalid autonomous playbook with `afterQueueId: 'missing-upstream'`; assert the route returns the AC-quality 400 rather than the missing-dependency 404.

Extend `test/playbook.test.ts` bundled-playbook tests:

- Import `analyzeAcceptanceCriteria` from `@eforge-build/input`.
- For every markdown file in `eforge/playbooks/`, parse it, skip empty `acceptanceCriteria`, and assert `analyzeAcceptanceCriteria(parsed.acceptanceCriteria).valid` is true. Include formatted diagnostic details in assertion messages to make failures actionable.

## Verification

- [ ] `eforge/playbooks/dependency-update.md` has no AC-quality diagnostics from `analyzeAcceptanceCriteria()`.
- [ ] The dependency-update playbook contains a tracked dependency-update evidence artifact criterion.
- [ ] The dependency-update playbook evidence artifact criteria cover `pnpm audit`, manifest diffs, lockfile diffs, unexpected packages, lifecycle scripts, repository metadata, maintainers, native/build behavior, and `npm diff` conclusions or the no-risky-change statement.
- [ ] `POST /api/playbook/save` returns HTTP 400 for invalid acceptance criteria and includes formatted AC diagnostics in the JSON response.
- [ ] `POST /api/playbook/save` leaves no new playbook file after invalid create input.
- [ ] `POST /api/playbook/save` leaves existing playbook file contents unchanged after invalid overwrite input.
- [ ] `POST /api/playbook/run` returns HTTP 400 for invalid autonomous playbook acceptance criteria and includes formatted AC diagnostics in the JSON response.
- [ ] `POST /api/playbook/run` writes no queue markdown files and records no `notifyQueueMutation()` wake after AC-quality rejection.
- [ ] Bundled playbooks with acceptance criteria pass AC-quality analysis.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
