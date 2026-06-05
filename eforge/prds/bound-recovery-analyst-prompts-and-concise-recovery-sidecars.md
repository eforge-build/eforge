---
title: Bound recovery analyst prompts and concise recovery sidecars
created: 2026-06-05
depends_on: ["fix-accept-as-complete-recovery-landing-and-resolved-status-reconciliation"]
landing: pr
landing_auto_merge: true
stack_parent: fix-accept-as-complete-recovery-landing-and-resolved-status-reconciliation
---

# Bound recovery analyst prompts and concise recovery sidecars

## Problem / Motivation

Recovery sidecar generation can exceed the selected model's context window and fall back to a low-confidence manual verdict.

Evidence-backed findings:

- Backlog item `.backlog/items/backlog-2026-06-05-recovery-sidecar-generation-can-exceed-model-context-window-.md` records an observed failed recovery for PRD `design-eforge-plan-extension-mvp-and-data-model`: Codex returned `context_length_exceeded`, causing a MANUAL / low-confidence sidecar even though the original build failure was acceptance validation.
- This directly supports `docs/roadmap.md` → **Kernel Resilience and Typed Recovery**, especially typed, repeatable recovery and honest gates.
- Current analyst prompt assembly is in `packages/engine/src/agents/recovery-analyst.ts`. It passes full `prdContent` and `JSON.stringify(summary, null, 2)` directly into `packages/engine/src/prompts/recovery-analyst.md`; no size budgeting or trimming appears in that path.
- `BuildFailureSummary` can contain large fields: optional `prdContent`, `acceptanceValidation.verdicts[*].evidence`, `validationCommands[*].output`, `reviewFailure.issues[*]`, `reviewFailure.evaluation.verdicts[*]`, `diffStat`, and plan/failing-plan error messages. The schema lives in `packages/client/src/events/shared/schemas.ts` and is re-exported through engine event types.
- `packages/engine/src/recovery/failure-summary.ts` can include `prdContent` in the summary when supplied, but the normal `EforgeEngine.recover()` path currently calls `buildFailureSummary()` without passing PRD content; the prompt still receives the standalone full PRD content separately.
- `packages/engine/src/recovery/event-history.ts` captures `validationCommands[*].output` without a local bound in the event-history summary path.
- `packages/engine/src/recovery/sidecar.ts` truncates validation-command output to 120 chars only in the Markdown sidecar, after analyst prompting, so it does not solve the prompt-size issue.
- Recovery sidecars themselves can be extremely verbose with a high noise-to-signal ratio.
- Static inspection supports the sidecar noise concern: `packages/engine/src/recovery/sidecar.ts` renders many sections whenever fields are present and stores the full summary JSON sidecar, while the analyst prompt asks for detailed completed/remaining/risk lists and complete successor PRDs for split verdicts.
- This plan should reduce prompt bloat and make the human-readable recovery report concise, prioritized, and action-oriented.
- Two entry points call `runRecoveryAnalyst`: `EforgeEngine.recover()` in `packages/engine/src/eforge.ts` and failed queued-resume sidecar refresh in `packages/engine/src/recovery/failed-resume-sidecar-finalization.ts`.
- A fix inside `runRecoveryAnalyst()` or a shared recovery-context preparation helper covers both recovery entry points.
- Existing fallback behavior is intentionally conservative: `packages/engine/src/recovery/recommendation.ts` selects deterministic retry/split/manual when analyst output is missing or invalid, and tests in `test/daemon-recovery-engine-fallback.test.ts` verify degraded/manual sidecars.
- This work should improve analyst input quality without weakening deterministic fallback.
- Existing tests can assert prompt content through `StubHarness.prompts` in `test/stub-harness.ts`.
- Existing recovery tests live in `test/recovery-verdict-schema.test.ts`, `test/recovery-sidecars.test.ts`, and `test/daemon-recovery-engine-fallback.test.ts`.
- There is a precedent for prompt input bounding in `packages/engine/src/agents/prd-validator.ts` with `MAX_COMMAND_OUTPUT_CHARS` and `packages/engine/src/prd-validator-diff.ts` with budgeted diffs, so adding recovery prompt budget logic follows existing engine patterns.

Validated assumptions:

- Static inspection validates that recovery analyst input is unbounded today for PRD content and summary JSON.
- Search validates that there is no existing recovery-specific prompt budgeting helper; existing budget/truncation helpers are for other agents or output traces.
- Runtime reproduction of the original Codex `context_length_exceeded` was not performed because it depends on large historical artifacts/provider behavior; the backlog contains the observed error string as evidence.

Affected users are anyone using `/eforge:recover`, Console's "Run recovery analysis", daemon recovery routes, failed queued-resume sidecar refresh, or Console's recovery dialog to inspect a failed build.

Confirmed root cause for context-window failures:

- `packages/engine/src/agents/recovery-analyst.ts` builds the prompt with `prdContent` passed through unchanged.
- `packages/engine/src/agents/recovery-analyst.ts` builds the prompt with `summary: JSON.stringify(summary, null, 2)` passed through unchanged.
- `packages/engine/src/prompts/recovery-analyst.md` embeds both values directly under `PRD Content` and `Build Failure Summary`.
- `BuildFailureSummary` can carry large strings from event history and validation evidence.
- Static inspection found unbounded capture of `validationCommands[*].output` in `packages/engine/src/recovery/event-history.ts`.
- Static inspection found large evidence-capable fields in `packages/client/src/events/shared/schemas.ts`.
- `packages/engine/src/recovery/sidecar.ts` truncates validation-command output only when rendering Markdown sidecars; this happens after analyst execution and does not reduce the prompt sent to the model.

Confirmed root cause for noisy sidecars:

- `packages/engine/src/recovery/sidecar.ts` renders a broad report by appending every applicable section in sequence: verdict, rationale, plans, failing plans, review failure details, landed commits, models, completed work, remaining work, risks, successor PRD, terminal failure, acceptance validation, validation commands, landing status, and diff stat.
- The Markdown sidecar does not currently distinguish an executive/action summary from detailed evidence, so high-value operator guidance competes with raw audit data.
- The JSON sidecar intentionally stores the full structured summary and verdict for machine consumers; that is useful for audit/apply/resume flows but should not force the human-readable report to be equally verbose.

Contributing factors:

- Recovery analysis currently uses a read-only no-tools analyst, so the prompt must carry enough context up front.
- Recovery analysis has no prompt input budget.
- The same unbounded analyst path is reused by standalone recovery and failed queued-resume sidecar refresh.
- Fallback behavior handles analyst failure safely but degrades the output to manual/low-confidence or deterministic fallback instead of providing a useful sidecar when the only problem is prompt size.

Validated non-root-cause:

- The deterministic fallback machinery is not wrong; it is a safe fallback that should remain in place.
- The machine-readable JSON sidecar is not the only sidecar UX; improving Markdown report structure can reduce user-facing noise without breaking JSON consumers.

Evidence-backed oversized prompt reproduction path:

1. Construct a `BuildFailureSummary` with a large `validationCommands[0].output`, large `acceptanceValidation.verdicts[*].evidence`, and/or large `reviewFailure` details.
2. Call `runRecoveryAnalyst()` with `StubHarness` and a large `prdContent` string.
3. Inspect `StubHarness.prompts[0]`.
4. Current behavior: the prompt contains the full large PRD content and full `JSON.stringify(summary, null, 2)` payload.
5. Expected behavior after the fix: the prompt sent to the harness is bounded below an explicit recovery prompt input budget, replaces oversized leaf values with truncation markers, and includes a visible note telling the analyst that some context was omitted or summarized.

Evidence-backed sidecar noise reproduction path:

1. Construct a `BuildFailureSummary` containing many plans, long validation-command output, long acceptance evidence, long diff stat content, and review failure details.
2. Call `writeRecoverySidecar()` with a representative verdict.
3. Read the generated Markdown sidecar.
4. Current behavior: the Markdown renderer includes every populated section in a fixed order and can produce a long audit-style report.
5. Expected behavior after the fix: the Markdown sidecar leads with verdict, confidence, verdict source, root failure, recommended next action, and concise completed/remaining/risk bullets; verbose raw evidence is summarized, truncated, or moved below a clearly labeled detailed-evidence section.

Observed production-like evidence from the backlog:

- Recovery sidecar for `design-eforge-plan-extension-mvp-and-data-model` produced MANUAL / low confidence.
- The sidecar recorded backend error `Codex error ... code: context_length_exceeded ... Your input exceeds the context window of this model`.
- Static inspection confirms `packages/engine/src/agents/recovery-analyst.ts` currently injects full `prdContent` and full `JSON.stringify(summary, null, 2)` into the analyst prompt.
- Static inspection confirms `packages/engine/src/recovery/sidecar.ts` renders broad sections whenever data exists, which can make reports verbose.

A live provider reproduction is intentionally out of scope for this implementation plan because it depends on provider-specific context limits and historical large artifacts. Unit tests should reproduce both oversized-prompt and verbose-sidecar conditions deterministically without invoking a real backend.

## Goal

Keep recovery conservative while making recovery analysis bounded and high-signal end-to-end: bounded analyst input, explicit omitted-context markers, and concise human-readable sidecars that lead with actionable findings rather than exhaustive noise. Improve analyst input quality without weakening deterministic fallback across standalone recovery, failed queued-resume refresh, and current sidecar consumers.

## Approach

Primary implementation targets:

- Add a focused helper under `packages/engine/src/recovery/`, for example `analyst-context.ts`, that prepares bounded recovery-analyst prompt inputs from `{ prdContent, summary }`.
- Update `packages/engine/src/agents/recovery-analyst.ts` to call the helper and pass bounded PRD text plus bounded/high-signal summary JSON into `loadPrompt()`.
- Update `packages/engine/src/prompts/recovery-analyst.md` to warn that PRD or summary inputs may contain explicit truncation markers and that omitted evidence should be treated as missing context, not proof of absence.
- Redesign `packages/engine/src/recovery/sidecar.ts` so recovery sidecars are concise, high-signal recovery artifacts rather than exhaustive backwards-compatible dumps.
- Update sidecar readers/projections/apply/resume code as needed for the new sidecar contract.
- Because this project is still greenfield, do not add compatibility shims solely for legacy recovery sidecars unless they materially simplify the new implementation.
- Add tests near the recovery tests, likely in `test/recovery-verdict-schema.test.ts`, `test/recovery-sidecars.test.ts`, or focused new files, using `StubHarness.prompts` and generated sidecar Markdown/JSON to assert prompt bounding and report signal.

Implementation design decisions:

- Prepare bounded prompt inputs inside the recovery analyst path because the context-window failure occurs before sidecar writing, and both standalone recovery and failed queued-resume refresh call `runRecoveryAnalyst()`.
- Use the greenfield phase to simplify the recovery sidecar contract because avoiding legacy compatibility shims reduces long-term maintenance and supports a clearer high-signal recovery artifact.
- Use deterministic character budgets rather than token counting because the engine does not currently have provider-neutral token estimation, and a conservative character cap is cheap, testable, and backend-agnostic.
- Prefer preserving high-signal structured facts over raw logs in prompt inputs.
- The bounded summary should keep scalar metadata, plan IDs/statuses, terminal failure metadata, model IDs, landed commit metadata, and acceptance-validation counts.
- The bounded summary should truncate or omit large text leaves such as command outputs, evidence strings, rationale-like text, error messages, diff stats, and PRD content.
- Include explicit truncation or omission metadata in prompt input and sidecars, such as `[truncated from N chars to M chars]`, `omittedEvidenceCount`, or equivalent.
- Analysts and humans must know when context is incomplete and should choose/accept `manual` rather than overclaiming.
- Make the Markdown sidecar an operator report first and an evidence appendix second.
- The human recovery workflow needs fast triage before details.
- Prefer a new concise JSON sidecar shape if it improves maintainability and signal.
- The JSON sidecar may store a compact `report`/`summary` projection plus bounded evidence instead of the full raw `BuildFailureSummary`, as long as apply/resume/Console consumers are updated accordingly.
- Lead the Markdown sidecar with compact sections for verdict, reason, root failure, recommended action, completed work, remaining work, and risks.
- These compact sections are the actionable fields Console and humans need first.
- Move verbose data such as plan tables, acceptance verdict evidence, validation command output previews, review failure tables, and diff stats below a detailed-evidence heading and apply strict per-field truncation or omission.
- Avoid model-specific behavior in the first fix because the observed issue is provider-specific in manifestation, but the bug is the engine sending unbounded input.
- Keep the analyst `tools: 'none'` behavior unchanged because enabling tools is a larger architecture change and unnecessary for bounded, high-signal recovery artifacts.

Potential helper API:

```ts
prepareRecoveryAnalystPromptContext({ prdContent, summary, limits? }): {
  prdContent: string;
  summaryJson: string;
  truncated: boolean;
  notes: string[];
}
```

Potential sidecar contract direction:

```ts
{
  schemaVersion: 3,
  generatedAt: string,
  prdId: string,
  setName: string,
  verdict: RecoveryVerdict,
  report: {
    operatorSummary: string,
    recommendedAction: string,
    keyEvidence: string[],
    evidenceOmissions?: string[]
  },
  boundedEvidence: { ... }
}
```

Potential Markdown sidecar structure:

```md
## Operator Summary

## Recommended Action

## Key Evidence

## Detailed Evidence
```

The exact sidecar shape can vary. The important requirement is not backward compatibility; it is a concise, typed, maintainable artifact that supports current apply/resume/Console workflows after their readers are updated.

The exact helper and section names can vary. Tests should cover the observable behavior: bounded prompt, preserved high-signal fields, visible truncation notes, concise top-of-report guidance, and unchanged emitted/JSON summary compatibility.

Risks and mitigations:

- Prompt truncation can hide evidence that would have supported retry or split. Mitigation: make truncation visible and instruct the analyst to treat omitted context as missing evidence; deterministic fallback remains conservative.
- Overly aggressive PRD truncation can make split successor PRDs incomplete. Mitigation: preserve PRD headings and acceptance-criteria-like sections when practical, and add tests for preserving acceptance criteria under budget.
- Over-compressing the recovery sidecar can hide evidence needed for human trust. Mitigation: keep bounded detailed evidence and explicit omission/truncation metadata.
- Changing sidecar shape can break current sidecar readers, queue projections, Console recovery dialog, apply recovery, or resume projection. Mitigation: update those current consumers directly and remove old-shape assumptions rather than layering compatibility shims.
- A character budget does not perfectly map to provider tokens. Mitigation: pick a conservative budget and test prompt character length; do not claim exact token safety.
- Adding sidecar report quality to the same bugfix increases scope. Mitigation: limit the sidecar work to the recovery sidecar artifact and direct readers, not a broad Console redesign.
- Adding helper logic in an oversized file would violate maintainability expectations. Mitigation: add focused new files under 600 lines and use bounded exact edits for existing large files such as `packages/engine/src/eforge.ts` if touched at all.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Recovery analyst prompt input is unbounded today. | Read `packages/engine/src/agents/recovery-analyst.ts`; it passes full `prdContent` and `JSON.stringify(summary, null, 2)` into `loadPrompt()`. Read `packages/engine/src/prompts/recovery-analyst.md`; it embeds both directly. | high | low | Add a unit test that inspects `StubHarness.prompts[0]` before/after the helper. | If wrong, this plan would target the wrong layer. |
| Large summary fields can come from validation output and evidence. | Read `packages/engine/src/recovery/event-history.ts`; validation command output is captured into `validationCommands[*].output`. Read `packages/client/src/events/shared/schemas.ts`; summary schema includes evidence-bearing fields. | high | low | Add tests with synthetic large `validationCommands[*].output` and acceptance evidence. | If wrong, tests would not reproduce the oversized prompt condition. |
| Fixing `runRecoveryAnalyst()` covers standalone recovery and failed queued-resume sidecar refresh. | Search showed callers in `packages/engine/src/eforge.ts` and `packages/engine/src/recovery/failed-resume-sidecar-finalization.ts`; both call `runRecoveryAnalyst()`. | high | low | Keep the helper call inside `runRecoveryAnalyst()` and run recovery tests. | If wrong, one recovery path could remain unbounded. |
| Recovery sidecar Markdown is currently high-noise for large summaries. | User reported repeated observation of verbose sidecars. Static inspection of `packages/engine/src/recovery/sidecar.ts` shows broad unconditional section rendering for every populated evidence category. | high | low | Add a large-summary sidecar fixture test and inspect generated Markdown structure. | If wrong, the report restructuring may be less valuable, but prompt bounding remains valuable. |
| Backward compatibility is not required for recovery sidecar shape. | User explicitly clarified the project is in greenfield phase and should not add code just to maintain backward compatibility. | high | low | During implementation, remove old-shape assumptions from current readers instead of adding compatibility branches. | If wrong, existing failed sidecars from old builds may become unreadable until regenerated. User accepted this direction. |
| A concise operator summary plus detailed-evidence section is an acceptable sidecar UX improvement. | Console and CLI docs describe recovery sidecars as the report users read before applying recovery; the report currently lacks this priority split. | medium | low | Validate with generated Markdown tests and a quick manual read of a synthetic sidecar. | If wrong, humans may prefer a different layout, but tests still enforce lower raw-noise behavior. |
| A conservative character budget is sufficient for this bugfix even though models enforce token budgets. | Existing code uses character budgets for diff/prompt/log bounding in nearby paths; no provider-neutral token estimator exists. | medium | medium | Later add provider-aware budgets if needed after measuring prompt sizes against configured models. | If wrong, a prompt could still exceed a smaller model's context window or be more truncated than necessary. |
| PRD truncation should preserve acceptance-criteria-like sections when practical. | Prompt rules require complete successor PRDs for split verdicts; acceptance criteria are critical for that. This is a design inference, not yet implemented. | medium | low | Add a helper test with a large PRD containing an `Acceptance Criteria` section and assert the section remains when within budget. | If wrong, split verdict quality can degrade to manual more often. |

No low-confidence/high-impact assumptions remain unresolved. Backward compatibility is explicitly non-required for recovery sidecars; implementation should favor a clean current contract and update current consumers.

Recommended profile: **Excursion**.

Profile rationale: this is a cohesive engine bugfix touching one analyst path, a new bounded-context helper, Markdown/JSON sidecar report structure, a prompt update, and focused tests. A single planner/build pass can enumerate the implementation and dependencies without delegated module planning. It is more than an Errand because the fix must preserve recovery semantics across standalone recovery, failed queued-resume refresh, and current sidecar consumers while intentionally avoiding legacy compatibility shims.

## Scope

In scope:

- Add recovery prompt input budgeting for `runRecoveryAnalyst()`.
- Bound PRD content sent to the recovery analyst.
- Bound summary JSON sent to the recovery analyst.
- Preserve high-signal structured fields in the bounded prompt.
- Add explicit truncation or omission markers for omitted context.
- Update `packages/engine/src/prompts/recovery-analyst.md` with incomplete-context guidance.
- Redesign the recovery Markdown sidecar as a concise operator report followed by bounded detailed evidence.
- Replace the recovery sidecar JSON with a concise current contract if that improves maintainability and signal.
- Update current sidecar readers/projections/apply/resume code in engine, monitor, and Console as needed for the new current sidecar contract.
- Keep standalone recovery and failed queued-resume sidecar refresh covered through the shared `runRecoveryAnalyst()` path.
- Add focused unit tests using `StubHarness.prompts`.
- Add focused unit tests for generated recovery sidecar Markdown and JSON.
- Run `pnpm vitest run test/recovery-verdict-schema.test.ts test/recovery-sidecars.test.ts test/daemon-recovery-engine-fallback.test.ts`.
- Add focused monitor or Console tests if they fail because they read recovery sidecar shape.
- Run `pnpm type-check`.
- Run `pnpm maintainability:check`.

Out of scope:

- Live provider reproduction of the original Codex `context_length_exceeded`.
- Model-specific context-window branching.
- Provider-specific token counting.
- Weakening `selectFinalVerdict()` or deterministic fallback behavior.
- Enabling tools for the recovery analyst.
- Making Console-specific redesign the center of this fix.
- Broad Console redesign beyond direct updates for current sidecar consumers.
- Adding compatibility shims solely for legacy recovery sidecars unless they materially simplify the new implementation.
- Claiming exact token safety from a character budget.

Behavioral boundaries:

- Backward compatibility is not a requirement for recovery sidecar shape or Markdown layout.
- Prefer the cleanest maintainable recovery sidecar contract over preserving old verbose JSON/Markdown output.
- Do not weaken `selectFinalVerdict()` or deterministic fallback behavior.
- Do not add model-specific context-window branching; use a conservative, backend-agnostic character budget.
- Do not make Console-specific redesign the center of this fix, but update Console/monitor projections if they consume fields whose shape changes.

## Acceptance Criteria

- `runRecoveryAnalyst()` sends a bounded PRD string to the harness instead of injecting full `prdContent` when PRD content exceeds the recovery analyst prompt budget.
- `runRecoveryAnalyst()` sends bounded summary JSON to the harness instead of injecting full `JSON.stringify(summary, null, 2)` when summary JSON exceeds the recovery analyst prompt budget.
- The bounded recovery analyst prompt contains a visible truncation marker when oversized PRD content is shortened.
- The bounded recovery analyst prompt contains a visible truncation marker when oversized summary fields are shortened.
- The bounded recovery analyst prompt preserves `prdId` when `prdId` exists in the original summary.
- The bounded recovery analyst prompt preserves `setName` when `setName` exists in the original summary.
- The bounded recovery analyst prompt preserves `featureBranch` when `featureBranch` exists in the original summary.
- The bounded recovery analyst prompt preserves `baseBranch` when `baseBranch` exists in the original summary.
- The bounded recovery analyst prompt preserves `failedAt` when `failedAt` exists in the original summary.
- The bounded recovery analyst prompt preserves `plans[*].planId` when plan IDs exist in the original summary.
- The bounded recovery analyst prompt preserves `plans[*].status` when plan statuses exist in the original summary.
- The bounded recovery analyst prompt preserves `failingPlan.planId` when `failingPlan.planId` exists in the original summary.
- The bounded recovery analyst prompt preserves `failingPlans[*].planId` when failing plan IDs exist in the original summary.
- The bounded recovery analyst prompt preserves `terminalFailure.scope` when `terminalFailure.scope` exists in the original summary.
- The bounded recovery analyst prompt preserves `terminalFailure.stage` when `terminalFailure.stage` exists in the original summary.
- The bounded recovery analyst prompt preserves `acceptanceValidation` counts when acceptance validation counts exist in the original summary.
- The bounded recovery analyst prompt preserves `landing.status` when `landing.status` exists in the original summary.
- The bounded recovery analyst prompt preserves `modelsUsed` when `modelsUsed` exists in the original summary.
- A unit test constructs oversized PRD content and oversized recovery summary evidence, calls `runRecoveryAnalyst()` with `StubHarness`, and asserts that `StubHarness.prompts[0].length` is below the configured recovery analyst prompt budget plus the fixed prompt-template overhead documented in the test.
- A unit test asserts that an oversized raw validation-command output string does not appear in full in `StubHarness.prompts[0]`.
- A unit test asserts that a parseable analyst verdict still produces a `recovery:complete` event after prompt input bounding is applied.
- The recovery sidecar JSON uses a concise current contract that does not require retaining the old full-summary dump shape.
- Current recovery sidecar readers in engine consume the new current sidecar contract instead of requiring legacy compatibility branches.
- Current recovery sidecar readers in monitor consume the new current sidecar contract instead of requiring legacy compatibility branches.
- Current recovery sidecar readers in Console consume the new current sidecar contract instead of requiring legacy compatibility branches.
- The Markdown recovery sidecar starts with a compact operator-facing summary before any detailed evidence tables.
- The Markdown recovery sidecar contains the verdict in the first 80 non-empty lines.
- The Markdown recovery sidecar contains the confidence in the first 80 non-empty lines.
- The Markdown recovery sidecar contains the verdict source in the first 80 non-empty lines when a verdict source is present.
- The Markdown recovery sidecar contains the terminal failure scope or terminal failure stage in the first 80 non-empty lines when terminal failure scope or terminal failure stage is present.
- The Markdown recovery sidecar contains the recommended next action in the first 80 non-empty lines.
- The Markdown recovery sidecar places verbose plan tables under a detailed-evidence section or equivalent lower-priority section.
- The Markdown recovery sidecar places acceptance-validation evidence under a detailed-evidence section or equivalent lower-priority section.
- The Markdown recovery sidecar places validation-command output previews under a detailed-evidence section or equivalent lower-priority section.
- The Markdown recovery sidecar places review-failure details under a detailed-evidence section or equivalent lower-priority section.
- The Markdown recovery sidecar places diff-stat content under a detailed-evidence section or equivalent lower-priority section.
- The Markdown recovery sidecar truncates or omits oversized validation-command output previews with visible truncation or omission markers.
- The Markdown recovery sidecar truncates or omits oversized acceptance-validation evidence with visible truncation or omission markers.
- A unit test writes a recovery sidecar from an oversized summary and asserts that the generated Markdown does not contain the full oversized validation-command output string.
- A unit test writes a recovery sidecar from an oversized summary and asserts that the generated Markdown contains a detailed-evidence heading after the operator-facing summary.
- A unit test writes a recovery sidecar and asserts that the JSON artifact contains `schemaVersion`.
- A unit test writes a recovery sidecar and asserts that the JSON artifact contains `generatedAt`.
- A unit test writes a recovery sidecar and asserts that the JSON artifact contains verdict data.
- A unit test writes a recovery sidecar and asserts that the JSON artifact contains operator-facing report data.
- A unit test writes a recovery sidecar and asserts that the JSON artifact contains bounded evidence data.
- Existing deterministic fallback behavior remains unchanged when the analyst throws.
- Existing deterministic fallback behavior remains unchanged when the analyst returns unparsable output.
- Existing deterministic fallback behavior remains unchanged when the analyst returns an invariant-invalid verdict.
- `packages/engine/src/prompts/recovery-analyst.md` tells the analyst that explicit truncation markers mean context is incomplete.
- `packages/engine/src/prompts/recovery-analyst.md` tells the analyst that omitted evidence must not be treated as proof of absence.
- `pnpm vitest run test/recovery-verdict-schema.test.ts test/recovery-sidecars.test.ts test/daemon-recovery-engine-fallback.test.ts` exits 0.
- Any focused monitor tests affected by the new recovery sidecar contract exit 0.
- Any focused Console tests affected by the new recovery sidecar contract exit 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- A live provider reproduction is intentionally out of scope because it depends on provider-specific context limits and historical large artifacts.
- Runtime reproduction of the original Codex `context_length_exceeded` was not performed because it depends on large historical artifacts/provider behavior; the backlog contains the observed error string as evidence.
- A quick manual read of a synthetic sidecar can validate whether the concise operator summary plus detailed-evidence section is an acceptable sidecar UX improvement.
- Later provider-aware budgets could be considered if needed after measuring prompt sizes against configured models.