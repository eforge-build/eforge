---
id: plan-02-acceptance-unknown-resolution
name: Acceptance Unknown Resolution
branch: complete-acceptance-criteria-lifecycle-hardening/plan-02-acceptance-unknown-resolution
agents:
  builder:
    effort: high
    rationale: This plan adds fail-closed agent parsing, read-only command safety,
      dirty-worktree enforcement, and orchestrator acceptance-gate wiring.
  reviewer:
    effort: high
    rationale: Review must check subprocess safety and fail-closed acceptance-gate
      behavior.
---

# Acceptance Unknown Resolution

## Architecture Context

Final PRD validation already runs after post-merge validation succeeds and rejects acceptance verdicts that contain `fail` or `unknown`. The PRD validator receives deterministic command evidence, but it can still produce `unknown` when the implementation is not provable from the bounded diff alone. This plan adds a targeted read-only resolver that gets only the unresolved criteria plus bounded evidence, can inspect files or run safe read-only comparison commands, and remains fail-closed when uncertainty remains.

`packages/engine/src/eforge.ts` and `packages/engine/src/orchestrator/phases.ts` are oversized. Use bounded exact edits in those files and place new logic in small helper files.

## Implementation

### Overview

Add an acceptance-unknown resolver agent and wire it into the `prdValidate` phase. The resolver runs only after deterministic validation and PRD validation have passed, only for expected criteria with `unknown` verdicts, and only when no acceptance verdict is `fail`. It may replace unknown verdicts with `pass` or `fail` only through validated, non-empty evidence. Any malformed resolver output, empty output, unsafe command request, resolver crash, dirty worktree, or remaining unknown keeps the build failed.

### Key Decisions

1. Use the existing `prd-validator` agent role/config for the resolver run to avoid a wire-protocol role expansion; implement the logic in a new `acceptance-unknown-resolver` agent module and prompt.
2. Buffer the acceptance validation event in `prdValidate()` long enough to synthesize missing expected verdicts and optionally run the resolver before yielding the final acceptance event.
3. Expose read-only command capability through a purpose-built custom tool that accepts an argv array and executes only allowlisted inspection/comparison commands with `execFile()`. Unsafe requests throw and fail the resolver run.
4. Require pass verdicts from the resolver to include a non-empty file or command evidence type. Resolver entries can target only criteria that were unknown before the pass.
5. Check `git status --porcelain --untracked-files=all` before and after the resolver. Any dirty tracked or untracked file fails the build.

## Scope

### In Scope

- New resolver prompt that forbids file mutation, PRD editing, waivers, and optimistic conversion of unknowns.
- New resolver runner/parser that fails on empty output, malformed JSON, unknown criterion references, pass verdicts without file or command evidence, and verdicts for non-unknown criteria.
- Safe read-only command custom tool for resolver inspection.
- Orchestrator gating based on post-merge validation evidence, PRD validation result, expected acceptance verdicts, absence of failures, and dirty-worktree checks.
- Unit tests for resolver parsing, command safety, gating, unknown-to-pass, unknown-to-fail, unresolved-unknown, malformed-output, no-output, crash, and dirty-worktree behavior.

### Out of Scope

- User approval workflows or console UI for editing acceptance criteria.
- PRD mutation or hidden inventory mutation during unknown resolution.
- Waiving acceptance criteria.
- Converting explicit `fail` verdicts to `pass`.
- Running the resolver after failed deterministic validation commands or timeout evidence.

## Files

### Create

- `packages/engine/src/agents/acceptance-unknown-resolver.ts` — resolver agent runner, custom read-only command tool wiring, output accumulation, and structured parsing entry point.
- `packages/engine/src/prompts/acceptance-unknown-resolver.md` — prompt that receives only unknown criteria, existing verdict evidence, deterministic command evidence, implementation diff context, and read-only inspection permission.
- `packages/engine/src/validation/acceptance-unknown-resolution.ts` — pure helpers for resolver gating, output validation, matching resolver verdicts to expected unknown criteria, and merging resolved verdicts back into the acceptance event.
- `test/acceptance-unknown-resolver.test.ts` — parser and safe-command-tool tests using `StubHarness` and real temporary git fixtures where needed.

### Modify

- `packages/engine/src/orchestrator.ts` — add an `AcceptanceUnknownResolver` callback type and carry it through `OrchestratorOptions` into `PhaseContext`.
- `packages/engine/src/orchestrator/phases.ts` — run the resolver from `prdValidate()` only under the required gate; merge resolver results; emit the final acceptance event; fail closed on resolver errors, unsafe commands, dirty worktree, and unresolved unknowns.
- `packages/engine/src/eforge.ts` — construct the resolver callback for PRD builds, build bounded implementation diff context, pass deterministic command evidence, run the new resolver agent with the `prd-validator` harness/config, and forward it to the orchestrator.
- `test/prd-validate-phase.test.ts` — add direct phase tests for run/no-run gates, unknown-to-pass, unknown-to-fail, unresolved unknown, malformed/no-output failures, validation timeout evidence, explicit fail verdicts, and dirty-worktree rejection.
- `test/orchestration-validation-gates.test.ts` or `test/prd-validator.test.ts` — add an integration-style regression using `StubHarness` showing PRD validation pass plus unknown acceptance verdict invokes the resolver and the final build stays failed if any unknown remains.

## Verification

- [ ] The resolver callback is invoked when validation command evidence contains only exit code 0 entries, PRD validation passes, at least one expected criterion is unknown, and no acceptance verdict is fail.
- [ ] The resolver callback is not invoked when any acceptance verdict is fail.
- [ ] The resolver callback is not invoked when any validation command evidence has a non-zero exit code or timeout exit code 124.
- [ ] An unknown criterion becomes `pass` only when the resolver output contains non-empty file or command evidence for that criterion.
- [ ] Resolver output that leaves any expected criterion unknown yields an acceptance event with `passed: false` and the build state becomes failed.
- [ ] Empty resolver output, malformed JSON, resolver crash, unsafe command request, and dirty merge worktree all set the build state to failed.
- [ ] After a resolver-assisted pass, `git status --porcelain --untracked-files=all` in the merge worktree returns an empty string.
