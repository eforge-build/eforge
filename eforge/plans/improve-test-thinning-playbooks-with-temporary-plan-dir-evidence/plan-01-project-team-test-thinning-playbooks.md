---
id: plan-01-project-team-test-thinning-playbooks
name: Project-Team Test-Thinning Playbooks
branch: improve-test-thinning-playbooks-with-temporary-plan-dir-evidence/plan-01-project-team-test-thinning-playbooks
---

# Project-Team Test-Thinning Playbooks

## Architecture Context

Eforge resolves playbooks through three tiers: project-local `.eforge/playbooks/`, project-team `eforge/playbooks/`, and user `~/.config/eforge/playbooks/`. Higher tiers shadow lower tiers. The repository currently has project-team playbooks in `eforge/playbooks/`, but no committed `test-thinning-audit` or `test-thinning-conservative` playbooks. The existing copies live at user scope and cannot be part of the PR.

Autonomous playbooks compile to ordinary build source. Planning playbooks guide the host-agent investigation workflow, which then creates a session plan. This change must only alter committed project-team playbook artifacts and focused tests; engine cleanup behavior is already in place through `cleanupPlanFiles`, which removes `eforge/plans/{planSet}/` during successful `pr` or `merge` cleanup.

## Implementation

### Overview

Create committed project-team playbooks that shadow the existing user-scope playbooks of the same names. Preserve the existing modes and conservative intent, while replacing vague final-tree or implementation-summary evidence with temporary, validator-visible plan-directory evidence at `eforge/plans/<plan-set>/deleted-test-coverage.md`.

Add a focused test file so the source-provided validation command `pnpm vitest run test/playbook.test.ts --reporter verbose` has a current target and verifies the new playbook guidance.

### Key Decisions

1. Use `eforge/playbooks/` because project-team playbooks are committed and shadow user-scope copies with the same names.
2. Use `eforge/plans/<plan-set>/deleted-test-coverage.md` as the named evidence artifact because that directory is removed by normal `cleanupPlanFiles` cleanup.
3. Keep evidence temporary. Do not require permanent committed documentation or final-tree summaries solely to justify deleted or consolidated tests.
4. Keep acceptance-criteria bullets standalone. Do not add nested acceptance-criteria bullets or bullets ending in `:`.

## Scope

### In Scope

- Create `eforge/playbooks/test-thinning-audit.md` with `scope: project-team` and `mode: planning`.
- Create `eforge/playbooks/test-thinning-conservative.md` with `scope: project-team` and `mode: autonomous`.
- Carry forward the intent of the current user-scope playbooks without editing `/Users/markschaake/.config/eforge/playbooks/`.
- Add temporary deleted-test coverage evidence requirements for deleted tests.
- Add temporary deleted-test coverage evidence requirements for consolidated tests.
- Add a focused `test/playbook.test.ts` file for parsing, acceptance-criteria quality, required wording, and project-team resolution checks.

### Out of Scope

- Do not edit user-scope playbooks under `/Users/markschaake/.config/eforge/playbooks/`.
- Do not change eforge engine cleanup behavior.
- Do not change acceptance-criteria extraction or validation semantics.
- Do not remove, consolidate, or audit tests as part of this playbook-guidance change.
- Do not add permanent documentation requirements for deleted or consolidated test coverage.

## Files

### Create

- `eforge/playbooks/test-thinning-audit.md` — project-team planning playbook for investigation-first test-thinning audits.
- `eforge/playbooks/test-thinning-conservative.md` — project-team autonomous playbook for conservative high-confidence test removals or consolidations.
- `test/playbook.test.ts` — focused tests for the new repository-owned playbooks and their resolution behavior.

### Modify

- None expected.

## Playbook Content Requirements

### `test-thinning-audit`

- Frontmatter contains `name: test-thinning-audit`, `scope: project-team`, and `mode: planning`.
- Preserve the audit/investigation goal from the user-scope playbook: find meaningful test-thinning opportunities and produce a prioritized plan before larger removals.
- Instruct the host-agent planning workflow to carry a deleted-test coverage evidence requirement into generated implementation session plans when deletion is in scope.
- Instruct the host-agent planning workflow to carry a deleted-test coverage evidence requirement into generated implementation session plans when consolidation is in scope.
- Name the evidence path exactly as `eforge/plans/<plan-set>/deleted-test-coverage.md`.
- State that the evidence file is created only when the generated implementation plan deletes or consolidates tests.
- State that the evidence file must live under the active plan set directory.
- State that the evidence file lists each deleted test.
- State that the evidence file lists each consolidated test.
- State that the evidence file lists the retained adjacent test or lower-level contract that still covers the behavior.
- State that the evidence file lists the validation command or evidence used to confirm coverage.
- State that the evidence file is a temporary plan artifact.
- State that the evidence file may be removed by normal `cleanupPlanFiles` cleanup.
- State that the evidence file must not require permanent committed documentation in the final tree.
- State that a generated plan must leave a test in place or record it as a future review candidate when retained coverage cannot be identified.
- Avoid requiring deleted or consolidated tests to be justified only through a vague "implementation summary".

### `test-thinning-conservative`

- Frontmatter contains `name: test-thinning-conservative`, `scope: project-team`, and `mode: autonomous`.
- Preserve the conservative autonomous goal from the user-scope playbook: remove only high-confidence low-value tests while preserving behavioral coverage.
- Instruct builders to create `eforge/plans/<plan-set>/deleted-test-coverage.md` when tests are deleted.
- Instruct builders to create `eforge/plans/<plan-set>/deleted-test-coverage.md` when tests are consolidated.
- State that the evidence file is created only when tests are deleted or consolidated.
- State that the evidence file must live under the active plan set directory.
- State that the evidence file lists each deleted test.
- State that the evidence file lists each consolidated test.
- State that the evidence file lists the retained adjacent test or lower-level contract that still covers the behavior.
- State that the evidence file lists the validation command or evidence used to confirm coverage.
- State that the evidence file is a temporary plan artifact.
- State that the evidence file may be removed by normal `cleanupPlanFiles` cleanup.
- State that the evidence file must not require permanent committed documentation in the final tree.
- State that builders must leave a test in place or record it as a future review candidate when retained coverage cannot be identified.
- Avoid requiring deleted or consolidated tests to be justified only through a vague "implementation summary".

## Test Guidance

Create `test/playbook.test.ts` with pure unit tests that use existing `@eforge-build/input` helpers. Do not call the daemon and do not mock the input package.

Recommended test coverage:

- Read both new Markdown files from `eforge/playbooks/`.
- Parse each file with `parsePlaybook`.
- Assert `test-thinning-audit` has `scope === 'project-team'` and `mode === 'planning'`.
- Assert `test-thinning-conservative` has `scope === 'project-team'` and `mode === 'autonomous'`.
- Run `analyzeAcceptanceCriteria` on each non-empty acceptance-criteria section and assert `valid === true`.
- Assert neither acceptance-criteria section contains a bullet line ending in `:`.
- Assert both files contain `eforge/plans/<plan-set>/deleted-test-coverage.md`.
- Assert both files contain wording for each deleted test, each consolidated test, retained adjacent test or lower-level contract, validation command or evidence, temporary plan artifact, normal `cleanupPlanFiles` cleanup, and no permanent committed documentation.
- Use a temporary `cwd` and temporary `XDG_CONFIG_HOME` with `configDir` set to the repository `eforge/` directory, then call `listPlaybooks` or `loadPlaybook` to assert both names resolve from `project-team`. This verifies the same resolution path used by `eforge_playbook` list/show without requiring a live daemon.
- Restore `process.env.XDG_CONFIG_HOME` after each test that changes it.

## Manual Verification Notes

After implementation, if the eforge MCP/Pi tool is available in the build host, run these checks:

- `eforge_playbook { action: "list" }` shows `test-thinning-audit` resolving from `project-team`.
- `eforge_playbook { action: "list" }` shows `test-thinning-conservative` resolving from `project-team`.
- `eforge_playbook { action: "show", name: "test-thinning-audit" }` returns the temporary plan-dir evidence guidance.
- `eforge_playbook { action: "show", name: "test-thinning-conservative" }` returns the temporary plan-dir evidence guidance.

## Verification

- [ ] `eforge/playbooks/test-thinning-audit.md` exists with `scope: project-team` and `mode: planning`.
- [ ] `eforge/playbooks/test-thinning-conservative.md` exists with `scope: project-team` and `mode: autonomous`.
- [ ] Both playbooks contain `eforge/plans/<plan-set>/deleted-test-coverage.md`.
- [ ] The audit playbook tells planners to require that evidence path when generated implementation plans delete tests.
- [ ] The audit playbook tells planners to require that evidence path when generated implementation plans consolidate tests.
- [ ] The conservative playbook tells builders to create that evidence path when tests are deleted.
- [ ] The conservative playbook tells builders to create that evidence path when tests are consolidated.
- [ ] Both playbooks state that the evidence file lists each deleted test, each consolidated test, the retained adjacent test or lower-level contract, and the validation command or evidence used to confirm coverage.
- [ ] Both playbooks state that the evidence file is a temporary plan artifact, may be removed by normal `cleanupPlanFiles` cleanup, and must not require permanent committed documentation in the final tree.
- [ ] Both playbooks state that a test remains in place or becomes a future review candidate when retained coverage cannot be identified.
- [ ] No acceptance-criteria bullet in either playbook ends with `:`.
- [ ] `test/playbook.test.ts` verifies parse, acceptance-criteria quality, required guidance snippets, and project-team resolution for both playbooks.
- [ ] `pnpm vitest run test/playbook.test.ts --reporter verbose` exits 0.
- [ ] `pnpm vitest run test/playbook-storage.test.ts --reporter verbose` exits 0.
