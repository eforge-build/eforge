---
id: plan-02-unknown-resolution
name: Acceptance Unknown Resolution
branch: harden-acceptance-criteria-lifecycle/plan-02-unknown-resolution
agents:
  builder:
    effort: high
    rationale: Adds a guarded read-only evidence pass in the final validation gate
      and must preserve fail-closed semantics.
  reviewer:
    effort: high
    rationale: The resolver may inspect files and request commands, so review must
      examine command auditing, dirty-worktree failure, and acceptance gate
      interactions.
  tester:
    effort: high
    rationale: Needs phase-level coverage for trigger/no-trigger paths, malformed
      output, dirty worktree, and crash handling.
---

# Acceptance Unknown Resolution

## Architecture Context

After plan-01, queued PRD builds consume a persisted canonical acceptance inventory. The final validation gate still fails when the PRD validator returns `unknown` verdicts. This plan inserts a narrow second-pass evidence collector for unknown-only acceptance failures while keeping explicit failures terminal and keeping `acceptanceEventPassed(...)` as the final pass predicate.

This plan also avoids new `AgentRole` literals and new event variants. The resolver helper runs through the existing `prd-validator` role configuration and emits ordinary `agent:*` events plus a final `acceptance_validation:complete` event.

## Implementation

### Overview

Create a resolver agent helper and orchestrator integration that triggers only after deterministic validation passes, PRD validation passes, the acceptance event contains at least one unknown expected criterion, and no expected criterion has a fail verdict. The resolver receives only unknown criteria, existing verdicts, deterministic command evidence, PRD prose, and implementation diff context. It may turn unknowns into pass or fail verdicts with evidence. Any unresolved unknown, malformed output, crash, unsafe command request, or dirty merge worktree keeps the build failed.

### Key Decisions

1. Emit only the final acceptance event on the resolver path. Do not emit an intermediate failed acceptance event before the resolver, because the outer build status tracker treats failed acceptance events as terminal for the run summary.
2. Merge resolver verdicts by stable `ac-###` ID. Omitted or malformed resolver verdicts leave the original unknown verdict in place.
3. Keep explicit `fail` verdicts outside the resolver path. Existing acceptance conflict waiver policy remains the only path that can handle explicit acceptance conflicts.
4. Use the existing `prd-validator` role and agent event stream instead of adding a new role or client schema change.
5. Run a merge-worktree dirty check after the resolver and fail closed on any tracked or untracked file.

## Scope

### In Scope

- Structured unknown resolver prompt and runner.
- Resolver output parser and evidence validation.
- Orchestrator callback type and phase integration.
- Trigger guards for PRD validation success, validation command success with no timeout evidence, unknown-only acceptance verdicts, and expected criteria presence.
- Dirty-worktree failure after resolver execution.
- Unsafe command request detection when the resolver asks for shell execution.
- Phase and agent tests for pass, fail, unknown, crash, no output, malformed output, no-trigger, and dirty-worktree cases.

### Out of Scope

- Waiving explicit failed criteria outside the existing conflict policy.
- Mutating source files, editing PRDs, or adding manual approval UI.
- New daemon routes, event variants, client schema changes, or host integration commands.
- Replacing the primary PRD validator.

## Files

### Create

- `packages/engine/src/agents/acceptance-unknown-resolver.ts` — Resolver runner, structured JSON parser, safe command audit helper, and fail-closed output validation.
- `packages/engine/src/prompts/acceptance-unknown-resolver.md` — Prompt instructing the agent to inspect only unknown criteria, cite file or command evidence, avoid mutation, and output a single JSON block.
- `packages/engine/src/orchestrator/acceptance-unknown-resolution.ts` — Trigger detection, resolver invocation, verdict merge, dirty-worktree guard, and final acceptance event construction.
- `test/acceptance-unknown-resolver.test.ts` — Focused parser, evidence, role, tool, and unsafe-command tests for the resolver helper.

### Modify

- `packages/engine/src/orchestrator.ts` — Add `AcceptanceUnknownResolver` callback type, option field, and `PhaseContext` wiring.
- `packages/engine/src/orchestrator/phases.ts` — Replace the inline acceptance event handling branch with a call to the new resolution helper while keeping the file below its maintainability ceiling.
- `packages/engine/src/eforge.ts` — Create the resolver closure for queued PRD builds, recompute bounded PRD diff context, strip hidden inventory blocks from PRD prose, run the resolver helper through the existing `prd-validator` role config, and pass the callback into `Orchestrator`.
- `packages/engine/src/orchestrator/acceptance-conflict-policy.ts` — Reuse exported pass/policy helpers; adjust only if the new helper needs a small exported utility.
- `test/prd-validate-phase.test.ts` — Add trigger/no-trigger and final gate tests for resolver pass, fail, unknown, crash, validation evidence failure, PRD validation failure, explicit fail verdict, and dirty worktree.
- `test/prd-validator.test.ts` — Add or adjust acceptance verdict parsing tests only if shared parsing helpers move or become exported.
- `web/content/docs/concepts.md` — If the implementation exposes resolver behavior in user-facing status text, add a short note that unknown-only acceptance evidence may receive one final read-only resolution pass and unresolved unknowns still fail.

## Implementation Notes

### Resolver output shape

Require a single JSON object with a `verdicts` array. Each entry must use a stable criterion ID and non-empty evidence:

```json
{
  "verdicts": [
    {
      "criterion": "ac-001",
      "verdict": "pass",
      "evidence": "src/foo.ts contains the implemented handler and pnpm test exited 0.",
      "fileEvidence": ["src/foo.ts: handler implementation"],
      "commandEvidence": ["pnpm test exited 0"]
    }
  ]
}
```

For `pass`, require at least one non-empty `fileEvidence` or `commandEvidence` item. For `fail` and `unknown`, require non-empty `evidence`. Invalid entries must not become passes.

### Trigger rules

The resolver runs only when all conditions hold:

- The latest `prd_validation:complete` in this phase has `passed: true`.
- `ctx.expectedAcceptanceCriteria` exists and contains at least one criterion.
- The adjusted acceptance event has at least one verdict `unknown` for an expected criterion.
- The adjusted acceptance event has zero verdicts `fail` for expected criteria.
- `ctx.validationCommandEvidence` is absent or every entry has `exitCode === 0` and no timeout evidence.
- `ctx.acceptanceUnknownResolver` exists.

If any condition fails, preserve the current acceptance event handling through `buildAcceptanceValidationEvents(...)`.

### Command and mutation safeguards

The resolver runner may use coding tools only with write tools denied and shell requests audited. Treat an unsafe shell request as a resolver failure. At minimum, reject commands containing redirection or mutating verbs such as `rm`, `mv`, `cp`, `touch`, `git add`, `git commit`, `git reset`, `git clean`, `git checkout`, `git merge`, `git rebase`, package install commands, or in-place editing flags. After the resolver returns, call `getWorktreeDirtyFiles(ctx.mergeWorktreePath)` and fail closed if any porcelain status lines are returned.

### Final event construction

The resolver path must yield a final `acceptance_validation:complete` event and pass it through `buildAcceptanceValidationEvents(...)`. Set `passed` from the merged verdict list before policy handling:

- `true` only when every expected criterion verdict is `pass`.
- `false` when any expected criterion remains `unknown` or becomes `fail`.

Do not convert explicit failures to pass. Do not mutate `ctx.expectedAcceptanceCriteria`.

## Verification

- [ ] `parseAcceptanceUnknownResolverOutput(...)` returns a pass verdict only when file or command evidence is present.
- [ ] Resolver malformed JSON and empty output throw fail-closed errors.
- [ ] Unsafe shell requests are detected and keep the resolver result non-passing.
- [ ] `prdValidate(...)` calls the resolver for PRD-passed, validation-passed, unknown-only acceptance events.
- [ ] `prdValidate(...)` does not call the resolver when an expected criterion has a fail verdict.
- [ ] `prdValidate(...)` does not call the resolver when PRD validation failed.
- [ ] `prdValidate(...)` does not call the resolver when validation command evidence contains a non-zero exit code or timeout evidence.
- [ ] Resolver pass output produces a final passing `acceptance_validation:complete` event and leaves `ctx.state.status` running.
- [ ] Resolver fail output produces a final non-passing `acceptance_validation:complete` event and marks the build failed.
- [ ] Resolver unknown output leaves the build failed.
- [ ] Resolver crash or no output leaves the build failed with progress evidence.
- [ ] Dirty tracked or untracked files after resolver execution leave the build failed and mention the dirty file list.
