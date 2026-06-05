---
id: plan-01-bound-recovery-analyst-context
name: Bound Recovery Analyst Prompt Context
branch: bound-recovery-analyst-prompts-and-concise-recovery-sidecars/plan-01-bound-recovery-analyst-context
agents:
  builder:
    effort: high
    rationale: The prompt-bounding helper must preserve specific recovery facts
      while deterministically truncating large PRD and summary evidence.
  reviewer:
    effort: high
    rationale: Review must verify that truncation never weakens conservative
      recovery semantics or hides omission markers.
---

# Bound Recovery Analyst Prompt Context

## Architecture Context

`runRecoveryAnalyst()` is the shared entry point for standalone recovery and failed queued-resume sidecar refresh. It currently injects the full PRD text and `JSON.stringify(summary, null, 2)` into `packages/engine/src/prompts/recovery-analyst.md`, so any fix in this path covers both callers without touching `EforgeEngine.recover()` or `failed-resume-sidecar-finalization.ts`.

The recovery analyst remains a no-tools advisory agent. Deterministic fallback in `packages/engine/src/recovery/recommendation.ts` remains unchanged.

## Implementation

### Overview

Add deterministic character-budgeting for the recovery analyst prompt inputs. The helper produces bounded PRD text, bounded/high-signal summary JSON, and visible omission notes before `loadPrompt()` renders the final analyst prompt.

### Key Decisions

1. Use character budgets, not token estimates. The engine has no provider-neutral token estimator, and existing PRD validator paths use character budgets for nearby evidence bounding.
2. Keep the helper inside `packages/engine/src/recovery/` and call it from `runRecoveryAnalyst()`. This covers standalone recovery and failed queued-resume refresh because both call the same agent runner.
3. Preserve high-signal identifiers and lifecycle facts before raw logs: `prdId`, `setName`, branches, `failedAt`, plan IDs/statuses, failing plan IDs, terminal failure scope/stage, acceptance counts, landing status, and model IDs.
4. Mark every truncation or omitted evidence source with explicit text such as `[truncated from N chars to M chars]` or an `omittedEvidence`/`contextNotes` entry. Omitted context is missing evidence, not proof of absence.

## Scope

### In Scope

- Bound PRD content passed to `loadPrompt()` in `runRecoveryAnalyst()`.
- Bound recovery summary JSON passed to `loadPrompt()` in `runRecoveryAnalyst()`.
- Add explicit context-notes prompt content for omitted or truncated fields.
- Preserve the summary fields required by the source acceptance criteria in bounded JSON.
- Add tests that inspect `StubHarness.prompts[0]` for prompt size, preservation, and truncation markers.
- Keep `tools: 'none'`, deterministic recommendation generation, verdict parsing, and fallback selection behavior unchanged.

### Out of Scope

- Provider-specific context windows.
- Token counting.
- Enabling tools for the recovery analyst.
- Changing recovery verdict semantics.
- Changing sidecar JSON or Markdown layout; that is handled in the dependent plan.

## Files

### Create

- `packages/engine/src/recovery/text-bounds.ts` — shared small helpers for deterministic string truncation, truncation markers, and bounded list rendering. Keep this file under 600 lines so the sidecar plan can reuse it.
- `packages/engine/src/recovery/analyst-context.ts` — exports `RECOVERY_ANALYST_PROMPT_INPUT_BUDGET_CHARS`, default per-field limits, and `prepareRecoveryAnalystPromptContext({ prdContent, summary, limits? })`.
- `test/recovery-analyst-context.test.ts` — focused helper tests for PRD section preservation, bounded JSON preservation, and visible truncation metadata.

### Modify

- `packages/engine/src/agents/recovery-analyst.ts` — call `prepareRecoveryAnalystPromptContext()` before `loadPrompt()`, pass bounded `prdContent`, bounded `summaryJson`, and joined `contextNotes` into the prompt template.
- `packages/engine/src/prompts/recovery-analyst.md` — add a context-completeness section stating that truncation markers mean context is incomplete and omitted evidence is not proof of absence.
- `test/recovery-analyst-wiring.test.ts` — update prompt assertions for bounded inputs, context notes, and valid verdict emission after bounding.

## Helper Contract

Implement `prepareRecoveryAnalystPromptContext` with this shape:

```ts
export interface RecoveryAnalystPromptContext {
  prdContent: string;
  summaryJson: string;
  truncated: boolean;
  notes: string[];
  inputBudgetChars: number;
}
```

Recommended default limits:

- `RECOVERY_ANALYST_PROMPT_INPUT_BUDGET_CHARS = 120_000` for the combined bounded PRD + summary JSON inputs.
- `prdBudgetChars = 50_000`.
- `summaryBudgetChars = 65_000`.
- `summaryStringLeafChars = 2_000`.
- `commandOutputChars = 1_000`.
- `acceptanceEvidenceChars = 1_000`.
- `reviewIssueTextChars = 1_000`.
- `diffStatChars = 4_000`.

Implementation details:

- `boundPrdContent()` returns the full PRD when it fits the PRD budget.
- When the PRD exceeds budget, preserve the beginning, a bounded extraction of heading sections whose titles match `acceptance`, `criteria`, `requirements`, `scope`, or `out of scope`, and a small tail. Insert a visible PRD truncation marker with original and retained lengths.
- `buildBoundedSummaryProjection()` constructs a recovery-focused projection rather than recursively stringifying every raw field.
- Keep all plan entries but truncate text fields inside them so all `plans[*].planId` and `plans[*].status` survive.
- Keep all failing plan entries but truncate `errorMessage` text.
- Keep acceptance counts even when individual verdict evidence is truncated.
- Keep validation command `command` and `exitCode`; replace oversized `output` with a bounded preview and a truncation marker.
- If the bounded summary JSON still exceeds `summaryBudgetChars`, reduce optional large previews first (`diffStat`, validation output previews, review failure text, acceptance evidence) before removing structural arrays.
- Return `notes` for each category that was truncated or omitted.

## Verification

- [ ] `prepareRecoveryAnalystPromptContext()` returns full PRD and summary strings when both fit within default limits.
- [ ] Oversized PRD content produces a bounded `prdContent` string containing `[truncated from` and at least one acceptance-criteria-like heading when the source PRD contains such a heading.
- [ ] Oversized validation command output produces bounded summary JSON that excludes the full raw output sentinel and contains a visible truncation marker.
- [ ] Bounded summary JSON preserves `prdId`, `setName`, `featureBranch`, `baseBranch`, `failedAt`, `plans[*].planId`, `plans[*].status`, `failingPlan.planId`, `failingPlans[*].planId`, `terminalFailure.scope`, `terminalFailure.stage`, acceptance validation counts, `landing.status`, and `modelsUsed` when those fields exist in the source summary.
- [ ] A `runRecoveryAnalyst()` test with an oversized PRD and oversized summary records `StubHarness.prompts[0].length <= RECOVERY_ANALYST_PROMPT_INPUT_BUDGET_CHARS + TEST_RECOVERY_ANALYST_TEMPLATE_OVERHEAD_CHARS`, where the test documents the fixed prompt-template overhead constant.
- [ ] The same `runRecoveryAnalyst()` test records a `recovery:complete` event when the stub emits a parseable recovery XML block.
- [ ] The prompt template contains text stating that explicit truncation markers mean context is incomplete.
- [ ] The prompt template contains text stating that omitted evidence is not proof of absence.
- [ ] `pnpm vitest run test/recovery-analyst-context.test.ts test/recovery-analyst-wiring.test.ts test/recovery-verdict-schema.test.ts` exits 0.