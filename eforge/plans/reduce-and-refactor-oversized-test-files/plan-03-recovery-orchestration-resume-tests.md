---
id: plan-03-recovery-orchestration-resume-tests
name: Split Recovery, Orchestration, and Resume Tests
branch: reduce-and-refactor-oversized-test-files/plan-03-recovery-orchestration-resume-tests
agents:
  builder:
    effort: high
    rationale: Recovery and resume tests contain integration-style setup, sidecar
      assertions, and deterministic verdict paths that require careful helper
      extraction without changing engine behavior.
---

# Split Recovery, Orchestration, and Resume Tests

## Architecture Context

Recovery, orchestration state mutation, daemon recovery routes, and resume-build tests exercise failure handling across the engine and monitor daemon. State mutation discipline and decision emission discipline remain production constraints; this plan only moves tests and extracts test-only fixtures.

## Implementation

### Overview

Split `recovery.test.ts`, `orchestration-logic.test.ts`, `daemon-recovery.test.ts`, and `resume-compiled-build-engine.test.ts` into parser/schema, sidecar, summary, engine, route, resume seed, and eligibility suites. The line-count scan found `test/resume-compiled-build-engine.test.ts` at 1,002 lines, so it is included even though the source target list did not name it explicitly.

### Key Decisions

1. Keep recovery verdict parsing/schema tests separate from sidecar movement, failure-summary reconstruction, analyst wiring, and `EforgeEngine.recover` behavior.
2. Split orchestration logic by helper functions, executePlans failure handling, model/concurrency state, validation/gap-close gates, and resume seed application.
3. Split daemon recovery route tests from sidecar path behavior, DB fallback scenarios, deterministic metadata, and inline queue finalization.
4. Keep resume build tests grouped by seed derivation, event synthesis, prompt context, eligibility/artifact projection, and compile-free engine resume execution.

## Scope

### In Scope

- Reduce `test/recovery.test.ts`, `test/orchestration-logic.test.ts`, `test/daemon-recovery.test.ts`, and `test/resume-compiled-build-engine.test.ts` to 1,000 lines or fewer.
- Extract recovery, daemon recovery, orchestration, and resume test helpers under `test/`.
- Preserve sidecar, event database, failure-summary, deterministic verdict, and compile-free resume assertions.

### Out of Scope

- Changes to recovery verdict schemas, engine recovery logic, daemon route constants, queue finalization behavior, or resume production code.
- Adding test-only exports to production modules unless an existing production export already exists for that helper.

## Files

### Create

- `test/recovery-verdict-schema.test.ts` — verdict block parsing, verdict schema, and schema YAML tests.
- `test/recovery-sidecars.test.ts` — sidecar writing and movement tests.
- `test/recovery-failure-summary.test.ts` — failure summary and multi-plan reconstruction tests.
- `test/recovery-analyst-wiring.test.ts` — recovery analyst harness wiring tests.
- `test/recovery-engine.test.ts` — `EforgeEngine.recover`, count-field schema rejection, and deterministic verdict path tests.
- `test/recovery-helpers.ts` — shared recovery fixtures, event builders, and sidecar helpers.
- `test/orchestration-state-helpers.test.ts` — propagate failure, merge skipping, concurrency, initialize state, and model tracking tests.
- `test/orchestration-execute-plans.test.ts` — executePlans build-failure behavior tests.
- `test/orchestration-validation-gates.test.ts` — validation no-command, post-gap rerun, gap-close, and PRD validator gate tests.
- `test/orchestration-resume-seed.test.ts` — resume state seeding tests.
- `test/orchestration-helpers.ts` — orchestration plan/state/context fixtures.
- `test/daemon-recovery-routes.test.ts` — API route constant and recover/sidecar route tests.
- `test/daemon-recovery-sidecars.test.ts` — failed PRD sidecar movement and path tests.
- `test/daemon-recovery-engine-fallback.test.ts` — DB-backed and no-state recovery fallback scenarios.
- `test/daemon-recovery-queue-finalization.test.ts` — deterministic metadata and inline queue finalization tests.
- `test/daemon-recovery-helpers.ts` — daemon recovery server, database, and sidecar fixtures.
- `test/resume-seed-state.test.ts` — resume seed derivation, event synthesis, and state seeding tests.
- `test/resume-eligibility.test.ts` — resume eligibility and read-only projection tests.
- `test/resume-artifacts-projection.test.ts` — resume artifact projection and sidecar-aware set-name tests.
- `test/resume-compiled-build-helpers.ts` — shared resume build fixtures.

### Modify

- `test/recovery.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/orchestration-logic.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/daemon-recovery.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/resume-compiled-build-engine.test.ts` — retain `EforgeEngine.resumeBuild` compile-free execution tests or shrink after moved suites; final file must be 1,000 lines or fewer.

## Verification

- [ ] `pnpm vitest run 'test/recovery*.test.ts' 'test/daemon-recovery*.test.ts' 'test/orchestration*.test.ts' 'test/resume*.test.ts'` exits 0.
- [ ] `find test -maxdepth 1 -type f \( -name 'recovery*.ts' -o -name 'daemon-recovery*.ts' -o -name 'orchestration*.ts' -o -name 'resume*.ts' \) -print0 | xargs -0 wc -l | awk '$2 != "total" && $1 > 1000 { found=1; print } END { exit found }'` exits 0.
- [ ] Every original `describe(` title from the four source files appears exactly once across the resulting split files.
- [ ] Daemon recovery route tests continue to use `API_ROUTES` and typed path helpers; no new inline `/api/...` literals are added.