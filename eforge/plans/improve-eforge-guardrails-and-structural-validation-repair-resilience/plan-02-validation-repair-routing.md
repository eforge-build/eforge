---
id: plan-02-validation-repair-routing
name: Validation Repair Routing, Structural Fixer, and Checkpoints
branch: improve-eforge-guardrails-and-structural-validation-repair-resilience/plan-02-validation-repair-routing
agents:
  builder:
    effort: xhigh
    rationale: This plan changes build-stage control flow, agent prompting,
      evaluator context, repeated-signature strategy, and durable artifacts.
  reviewer:
    effort: high
    rationale: Review needs to inspect recovery-loop safety, evaluator gating, and
      event/checkpoint semantics.
  tester:
    effort: high
    rationale: Recovery routing and checkpoint behavior require focused tests across
      multiple stage seams.
---

# Validation Repair Routing, Structural Fixer, and Checkpoints

## Architecture Context

After plan-01, validation-provider failures expose machine-readable repair guidance. This plan uses that guidance inside the validate build stage. The validate stage remains headless: it emits typed events and artifacts, delegates candidate edits to agents, and keeps evaluator gating as the only path that applies repair patches.

The existing post-merge `validation-fixer` commits changes and cannot be reused unchanged for in-build repairs. In-build structural validation repair must leave changes unstaged so the evaluator can accept or reject the captured candidate diff.

## Implementation

### Overview

Add a recovery strategy layer to `runValidationProviderRecoveryStage`. It selects narrow review-fix, structural validation-fix, or no automated repair from validation guidance and repeated failure signatures. Add checkpoint artifact creation before every repair attempt. Wire the validate stage to a new in-build validation-fixer mode and pass validation guidance into the evaluator prompt.

### Key Decisions

1. **Deterministic routing.** Route `repairClass: 'structural'` to the structural validation-fixer path immediately. Route `repairClass: 'narrow'` or unspecified to the current review-fixer path unless the same signature has already survived a narrow attempt. Route `repairClass: 'manual'` to terminal failure without automated edits.
2. **Repeated-signature escalation.** Track signatures across attempts using provider name, affected file or provider pseudo-file, provider-authored `failureKind`, normalized message text, and stable JSON serialization of relevant metadata. A signature seen after a narrow attempt escalates to structural on the next available attempt.
3. **Evaluator remains the landing gate.** Structural validation-fixer candidate edits stay unstaged and uncommitted. The existing evaluator snapshot/application mechanism decides which hunks become the repair commit.
4. **Checkpoint before repair.** Before each repair attempt, write a deterministic patch and metadata file under `.eforge/validation-recovery/<planSet>/<planId>/attempt-<n>-<provider>/` using the project root (`ctx.cwd`) when it is outside the plan worktree. Emit the checkpoint reference before invoking the repair agent and include the latest checkpoint reference in terminal validation-recovery failures.
5. **Prompt context is explicit.** Give the structural fixer, narrow review-fixer, and evaluator the validation guidance, repair class, retry guidance, metadata, provider name, and checkpoint path so broad structural edits are accepted only when the provider guidance justifies them.

## Scope

### In Scope

- Recovery strategy selection for narrow, structural, manual, and repeated-signature escalation.
- In-build structural validation-fixer mode/prompt that leaves candidate changes unstaged and does not commit.
- Validate-stage callback wiring for structural fixes.
- Evaluator prompt context for validation-provider repair attempts.
- Checkpoint artifact writer and checkpoint reference emission.
- Tests for strategy routing, escalation, checkpoint references, and validate-stage wiring.

### Out of Scope

- Post-merge validation command behavior except for shared prompt/function extraction that preserves existing commit semantics.
- Maintainability parser implementation; plan-03 supplies the first structural provider guidance source.
- Validation waivers, approvals, UI workflows, or scheduler behavior.

## Files

### Create

- `packages/engine/src/validation-recovery-checkpoints.ts` — Engine-owned helper to write bounded validation repair checkpoint metadata and patch artifacts outside the plan worktree when possible.
- `packages/engine/src/prompts/validation-repair-fixer.md` — In-build validation repair prompt that permits focused structural refactors when guided, forbids staging/committing, and instructs the agent to leave candidate edits for evaluation.
- `test/validation-recovery-checkpoints.test.ts` — Focused tests for checkpoint path construction, patch/metadata creation, and bounded metadata output.

### Modify

- `packages/engine/src/pipeline/stages/validation-provider-recovery.ts` — Add strategy selection, signature tracking, escalation, checkpoint calls, repair-context rendering, and terminal checkpoint references.
- `packages/engine/src/pipeline/stages/build-stages.ts` — Wire `runStructuralValidationFix` into the validate stage, implement the in-build validation-fixer stage helper, and pass validation repair context into evaluator overrides.
- `packages/engine/src/agents/validation-fixer.ts` — Add a separate in-build validation repair runner or shared prompt mode that leaves edits unstaged and does not commit; preserve post-merge commit behavior for the existing runner.
- `packages/engine/src/prompts/validation-fixer.md` — Clarify this prompt is for post-merge validation repair and keeps the existing commit instruction.
- `packages/engine/src/prompts/review-fixer.md` — Add narrow validation-provider guidance: use `fix`/`retryGuidance`, avoid structural work unless routed to the structural validation-fixer, and skip issues marked manual.
- `packages/engine/src/prompts/evaluator.md` — Add validation-repair evaluation instructions that permit provider-requested structural edits only when the diff directly addresses the guidance.
- `packages/client/src/events.schemas.ts` — Add optional validation checkpoint reference fields to `plan:build:progress` and/or `plan:build:failed` if the implementation emits structured checkpoint references rather than message-only references.
- `packages/client/src/event-registry.ts` — Update summaries only if structured checkpoint fields are added to persisted events.
- `test/validation-provider-recovery-stage.test.ts` — Cover narrow routing, structural routing, manual terminal routing, repeated-signature escalation, checkpoint invocation, and terminal checkpoint reference emission.
- `test/validation-provider-build-stage.test.ts` — Cover validate-stage wiring with a structural validation-fixer callback or stub harness where the existing stage registry permits it.
- `test/build-evaluator-enforcement.test.ts` or a focused evaluator prompt test — Verify validation repair context is included in evaluator prompt construction when validation recovery invokes evaluation.

## Verification

- [ ] A validation-provider failure with `repairClass: 'narrow'` invokes the narrow review-fix callback and then evaluate.
- [ ] A validation-provider failure with `repairClass: 'structural'` invokes the in-build validation-fixer callback and then evaluate.
- [ ] The structural validation-fixer path leaves `git diff --cached` empty before evaluator snapshot preparation.
- [ ] The structural validation-fixer path emits no git commit before evaluator verdict application.
- [ ] With `review.maxRounds = 2`, a repeated narrow signature invokes narrow repair on attempt 1 and structural repair on attempt 2.
- [ ] Signature generation includes provider name, affected file or provider pseudo-file, provider-authored failure kind, and metadata values.
- [ ] A checkpoint metadata file and patch file are written before each automated validation repair attempt.
- [ ] Terminal recovery exhaustion includes the latest checkpoint reference in a structured event field or the terminal failure error text.
- [ ] Evaluator prompt text for validation repair contains provider name, repair class, fix guidance, retry guidance, and checkpoint reference.
- [ ] Targeted tests pass: `pnpm test -- test/validation-provider-recovery-stage.test.ts test/validation-provider-build-stage.test.ts test/validation-recovery-checkpoints.test.ts`.
