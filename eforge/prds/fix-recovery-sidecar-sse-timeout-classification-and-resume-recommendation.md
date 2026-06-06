---
title: Fix Recovery Sidecar SSE Timeout Classification and Resume Recommendation
created: 2026-06-06
landing: pr
landing_auto_merge: true
---

# Fix Recovery Sidecar SSE Timeout Classification and Resume Recommendation

## Problem / Motivation

Recovery sidecars can recommend `manual` for failures where the most useful operator path is compiled-build resume. In the observed `implement-iframe-bundled-console-workstation-sdk` failure, the build failed after compile with preserved feature-branch artifacts and completed plans, but the generated sidecar presented a manual recovery verdict and a manual recommended action.

Roadmap alignment: this directly supports `docs/roadmap.md` under **Kernel Resilience and Typed Recovery** and **Console Observability and Control**. The fix should keep the engine headless and expose recovery/resume facts through typed daemon/client contracts rather than host-only workflow behavior.

The user clarified that the underlying failure was caused by an internet outage. Recovery analysis may call an LLM over the same unavailable network, so recovery needs a deterministic/offline path that can still produce an actionable sidecar. The fix is not mainly “make the LLM smarter”; it is “make the non-LLM recovery evidence and sidecar recommendation useful when the analyst is unavailable or conservative.”

The root error was an infrastructure-style SSE timeout. The sidecar made the timeout visible, but the recovery classifier did not recognize the Codex SSE response-header timeout as a transient transport subtype, and the sidecar had no first-class resume eligibility/recommendation field.

Why it matters: when a build fails after compile with meaningful preserved artifacts, the operator should see an actionable resume path in the recovery report itself, even if network-dependent recovery analysis fails. A sidecar that says only `manual` hides the most useful eforge-owned recovery action and makes recovery depend on external host-skill heuristics.

Observed evidence:

- Failed PRD: `implement-iframe-bundled-console-workstation-sdk`.
- Sidecar files: `.eforge/queue/failed/implement-iframe-bundled-console-workstation-sdk.recovery.json` and `.eforge/queue/failed/implement-iframe-bundled-console-workstation-sdk.recovery.md`.
- The JSON sidecar has `verdict.verdict: "manual"`, `verdict.confidence: "medium"`, and `verdict.recommendationSource: "analyst"`.
- The sidecar root failure message is `Backend error: Codex SSE response headers timed out after 10000ms ...`.
- The sidecar deterministic rationale is `Mixed or non-transient failure subtypes detected. Non-transient plans: plan-03-extension-sdk-api (unknown). Automated retry is not safe when failure causes are mixed.`
- The sidecar evidence shows two completed/merged plans, `plan-01-client-contracts` and `plan-02-console-workstation-rendering`, and three downstream blocked plans.
- `monitor.db` events for run `51f778a2-046d-4130-9f83-3b33609f3742` show `plan:build:failed` for `plan-03-extension-sdk-api` without a `terminalSubtype` field, followed by an authoritative `build:terminal-failure` that also lacks a terminal subtype.
- `monitor.db` shows the failed plan had 227 `agent:tool_use` events, so even after recognizing the SSE timeout as transient, blindly applying a PRD-level `retry` would still be unsafe because partial work exists.
- A resume run for the same set was present in `monitor.db`, confirming compiled-build resume is an active recovery path for this failure family.
- The underlying failure was caused by an internet outage.

Static code evidence:

- `packages/client/src/transient-transport.ts` currently recognizes `Backend error: WebSocket closed <code>`, Claude SDK socket-close text, and `backend error: websocket error`; it does not recognize `Backend error: Codex SSE response headers timed out after 10000ms`.
- `packages/engine/src/terminal-failure.ts` records `plan:build:failed` as authoritative terminal failure evidence but only carries `scope`, `message`, `planId`, source metadata, landing, and validation booleans; it does not preserve `event.terminalSubtype`.
- `packages/engine/src/recovery/terminal-failure-history.ts` gives authoritative `build:terminal-failure` precedence and `buildAuthoritativeFragment()` builds `failingPlans` from the terminal event and lifecycle error maps, not from the original `plan:build:failed.terminalSubtype`.
- `packages/engine/src/recovery/recommendation.ts` only classifies deterministic retry/split when every failing plan has `terminalSubtype: "error_transient_transport"`; unknown subtypes force `manual`.
- `packages/engine/src/recovery/recommendation.ts` also forces `manual` when a transient failed plan has `toolUseCount > 0`, which is correct for blind retry but does not represent the compiled-artifact resume path.
- `packages/engine/src/resume/compiled-build.ts` owns read-only and mutating compiled-build resume eligibility helpers: `projectResumeEligibility()`, `checkResumeEligibility()`, `resolveResumeSetName()`, and queued compiled resume support.
- `packages/client/src/routes/recovery.ts` exposes `ResumeEligibilityResponse`.
- `packages/monitor/src/routes/resume.ts` exposes `GET /api/recover/resume-eligibility` and `POST /api/recover/resume-build`.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` tells the host skill to present compiled-build resume alongside the verdict when artifacts are present, but the recovery sidecar itself cannot currently recommend `resume` because the verdict schema only allows `retry`, `split`, `abandon`, and `manual`.

Root causes:

- The transient transport classifier does not recognize Codex SSE response-header timeouts.
- `packages/client/src/transient-transport.ts` has patterns for WebSocket close and Claude socket-close strings but no pattern for `Codex SSE response headers timed out after <N>ms`.
- `classifyAgentTerminalSubtype()` returns `undefined` for this backend timeout and recovery treats the plan subtype as `unknown`.
- Authoritative terminal failure events drop terminal subtype metadata.
- `packages/engine/src/terminal-failure.ts` observes `plan:build:failed` but does not copy `event.terminalSubtype` into `FailureEvidence` or the emitted `build:terminal-failure.failure` object.
- `packages/engine/src/recovery/terminal-failure-history.ts` prioritizes authoritative `build:terminal-failure` rows and does not reconstruct the terminal subtype from the source `plan:build:failed` row when building the authoritative fragment.
- Even if `plan:build:failed` carries a known subtype, recovery summary synthesis can lose it and deterministic recovery falls back to manual.
- Recovery verdicts model PRD-level actions but not compiled-build resume.
- `packages/engine/src/schemas.ts` defines recovery verdicts as `retry`, `split`, `abandon`, and `manual`; there is no `resume` verdict.
- `eforge_apply_recovery` applies only the verdict actions; `eforge_resume_build` is a separate route/tool.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` compensates by telling the host to separately present resume when artifacts exist, but sidecar generation does not include that eligibility/recommendation.
- The sidecar report can be technically conservative but operationally unhelpful: `manual` becomes the visible recommended action even when a typed resume path exists.
- Deterministic policy correctly avoids blind retry when transient failures leave partial work, but it has no alternate deterministic path for compiled-artifact resume.
- `determineRecoveryRecommendation()` returns `manual` for transient failures when failing plans have `toolUseCount > 0` to avoid duplicate/partial-state retry hazards.
- The observed failed plan had 227 tool-use events.
- After adding SSE timeout classification, deterministic recovery still should not recommend blind retry for this shape; it should surface resume as a separate operator action when resume eligibility is true.
- Recovery sidecar usefulness currently depends too much on successful network-backed analyst output.
- `runRecoveryAnalyst()` invokes the configured agent harness and `selectFinalVerdict()` falls back to deterministic/manual behavior when the analyst throws, times out, or cannot be parsed.
- An internet outage can break both the original build agent and the recovery analyst agent.
- The same outage that caused the build failure can prevent the recovery LLM from supplying the “obvious” recommendation.
- Resume eligibility and transport classification must be computed deterministically and included in the sidecar even when `analystVerdict` is null.

Reproduction paths:

1. Passing `new Error("Backend error: Codex SSE response headers timed out after 10000ms")` to `classifyAgentTerminalSubtype()` currently returns `undefined`.
2. Passing `new Error("Backend error: Codex SSE response headers timed out after 10000ms")` to `classifyAgentTerminalSubtype()` should return `error_transient_transport`.
3. Feeding `createBuildTerminalFailureTracker()` a `plan:build:failed` event with `terminalSubtype: "error_transient_transport"` and converting the tracker to a `build:terminal-failure` event currently can lose the subtype.
4. Synthesizing a recovery summary from monitor DB events where authoritative `build:terminal-failure` is present can currently report the failed plan subtype as `unknown` or omit it.
5. The expected recovery summary should include `error_transient_transport` in `summary.failingPlan.terminalSubtype`, `summary.failingPlans[0].terminalSubtype`, and the corresponding plan entry.
6. Seeding a failed PRD sidecar context with a feature branch, compiled `orchestration.yaml` artifacts, completed plans, and a failed plan with an infrastructure timeout after agent tool use currently can produce a sidecar verdict/report that recommends manual review without surfacing compiled-build resume as a typed operator action.
7. The expected sidecar should include read-only resume eligibility evidence and its recommended action should tell the operator to queue compiled-build resume when eligibility is true.
8. In the observed production-like failure, build `implement-iframe-bundled-console-workstation-sdk` failed in `plan-03-extension-sdk-api` with `Backend error: Codex SSE response headers timed out after 10000ms`.
9. In the observed production-like failure, recovery sidecar generation produced `verdict: manual`, `recommendationSource: analyst`, and deterministic rationale saying the failed plan subtype was `unknown`.
10. In the observed production-like failure, the sidecar report recommended manual review instead of compiled-build resume.
11. In the observed production-like failure, `monitor.db` shows completed earlier plans and a later resume run for this set, supporting that resume was the obvious eforge-owned path to present.

## Goal

Recovery sidecars should deterministically classify Codex SSE backend response-header timeouts as transient transport failures, preserve terminal subtype through authoritative recovery evidence, and surface compiled-build resume as a typed operator action when artifacts are eligible.

The existing `retry | split | abandon | manual` recovery verdict union should remain unchanged, with compiled-build resume represented as a separate sidecar-level recovery option/recommended action tied to the existing `eforge_resume_build` path.

## Approach

Implementation direction:

- Preserve the existing verdict union for backward-compatible `eforge_apply_recovery` semantics.
- Do not make `resume` a `RecoveryVerdict` unless the apply route is also expanded.
- Add or expose a sidecar-level recovery option / recommended operator action for compiled-build resume, separate from the verdict field.
- Enrich sidecar generation with read-only resume eligibility evidence so reports can recommend `eforge_resume_build` when the failed PRD has compiled artifacts and a feature branch.
- Update transient transport classification so Codex SSE response-header timeouts are recognized as `error_transient_transport` and flow through recovery evidence.
- Preserve terminal subtype through authoritative terminal failure synthesis so deterministic recommendation and sidecar evidence do not degrade known transient failures to `unknown`.
- Keep the engine headless and expose recovery/resume facts through typed daemon/client contracts rather than host-only workflow behavior.

Primary implementation targets:

- Update `packages/client/src/transient-transport.ts` to add a narrowly scoped regex for Codex SSE response-header timeout messages, such as `backend error: codex sse response headers timed out after \d+ms`.
- Keep transient transport classification limited to backend transport errors.
- Do not classify arbitrary command or validation timeouts as transient transport.
- Update `packages/engine/src/terminal-failure.ts` to preserve `terminalSubtype` from `plan:build:failed` in the terminal failure tracker for plan-scoped failures.
- Update `packages/engine/src/terminal-failure.ts` to emit optional `failure.terminalSubtype` on `build:terminal-failure` when available.
- Update `packages/client/src/events/variants/build.ts` and related schema/tests if `build:terminal-failure.failure.terminalSubtype` is added to the wire contract.
- Add optional terminal subtype to the event schema using the existing `AgentTerminalSubtypeSchema`.
- Update wire parity / schema tests.
- Update `packages/engine/src/recovery/terminal-failure-history.ts` to parse optional `failure.terminalSubtype` from authoritative terminal failure events.
- Update `packages/engine/src/recovery/terminal-failure-history.ts` to propagate terminal subtype into `failingPlan`, `failingPlans`, and plan error entries for plan-scoped authoritative fragments.
- If preserving subtype on `build:terminal-failure` is not sufficient for older events, optionally recover the subtype from the source `plan:build:failed` row referenced by `sourceEventType` / `sourceEventTimestamp` when the source row carries `terminalSubtype`.
- Update `packages/engine/src/recovery/recommendation.ts` while keeping the verdict union unchanged.
- Do not weaken the existing `toolUseCount > 0` guard for blind retry.
- Optionally add a deterministic rationale note that transient failure plus tool use is a resume/split/manual shape rather than safe full retry when resume evidence is separately available.
- Update `packages/engine/src/recovery/sidecar.ts` and `packages/engine/src/recovery/sidecar-payload.ts` to accept optional read-only resume eligibility/recommendation evidence.
- Include resume eligibility in the JSON sidecar and Markdown report.
- When resume is eligible, make `report.recommendedAction` explicitly tell the operator to queue compiled-build resume with `eforge_resume_build` / `/eforge:recover resume`, while keeping the verdict field unchanged.
- Update `packages/engine/src/eforge.ts` and `packages/engine/src/recovery/failed-resume-sidecar-finalization.ts` to compute read-only resume eligibility before writing recovery sidecars where enough config/path context is available.
- Use `projectResumeEligibility()` from `packages/engine/src/resume/compiled-build.ts` rather than duplicating branch/artifact checks.
- Degrade gracefully when eligibility cannot be checked.
- Absence of resume evidence should not make sidecar generation fail.
- Update `packages/client/src/routes/recovery.ts` and sidecar wire types in `@eforge-build/client` if the sidecar contract is owned in client types.
- Add optional sidecar fields for resume eligibility / recovery options if the sidecar contract is owned in client types.
- Keep additions optional unless intentionally bumping the sidecar schema version.
- Update `packages/pi-eforge/skills/eforge-recover/SKILL.md` to prefer sidecar-provided resume recommendation when present, while still checking live eligibility as a fallback.
- Update `eforge-plugin/skills/recover/recover.md` to prefer sidecar-provided resume recommendation when present, while still checking live eligibility as a fallback.
- Keep Pi and Claude plugin recovery docs in sync.

Likely tests:

- `test/pipeline-error-translator.test.ts`
- `test/pi-transport-resilience.test.ts` or a focused transient transport classifier test
- `test/recovery-terminal-failure.test.ts`
- `test/recovery-recommendation.test.ts`
- `test/recovery-sidecars.test.ts`
- `test/daemon-recovery-sidecars.test.ts` or a focused sidecar generation test
- `packages/client/src/__tests__/events-schemas.test.ts`
- `packages/client/src/__tests__/terminal-failure-event.test.ts`
- Plugin/Pi skill parity can be covered by existing docs/skill snapshot tests if present, or by direct file assertions if this repo has them.

Risks and mitigations:

- Over-broad timeout classification could misclassify local validation or daemon timeouts as transient backend transport failures.
- Mitigation for over-broad timeout classification: require the `Backend error: Codex SSE response headers timed out after <N>ms` shape and add negative tests for generic `timeout` strings.
- Adding optional terminal subtype to `build:terminal-failure` changes the wire event payload.
- Mitigation for terminal subtype wire changes: update client-owned event schema and compatibility tests; keep the field optional.
- Resume eligibility can become stale between sidecar generation and user action.
- Mitigation for stale resume eligibility: label sidecar resume evidence as generated-at/read-only and keep `eforge_resume_build` / resume eligibility route authoritative at action time.
- A `manual` verdict with a resume recommended action may confuse consumers that assume verdict and recommended action are identical.
- Mitigation for verdict/recommended-action confusion: document that `verdict` is the apply-recovery action and sidecar `recommendedAction` / recovery options may point to the separate compiled-resume route.
- Computing resume eligibility during sidecar generation must not mutate worktrees or queue state.
- Mitigation for mutation risk: use `projectResumeEligibility()` for sidecar enrichment, not `checkResumeEligibility()` or queue mutation helpers.
- Updating both Pi and Claude recovery skills is required by project policy.
- Mitigation for integration doc drift: include both files in acceptance criteria and tests/review checklist.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
| --- | --- | --- | --- | --- | --- |
| Codex SSE response-header timeout is an agent backend transport failure and should be classified as `error_transient_transport`. | The observed message starts with `Backend error:` and refers to Codex SSE response headers timing out; current classifier already treats backend WebSocket errors as transient transport. | high | low | Add positive and negative classifier tests around the exact message shape. | If wrong, recovery may surface resume/retry options for a non-transient backend failure. |
| `resume` should not be added as a `RecoveryVerdict` in this fix. | `RecoveryVerdict` is consumed by `eforge_apply_recovery`, which has no resume apply behavior; `eforge_resume_build` is already a separate daemon route/tool with separate confirmation semantics. | high | medium | Review apply route and recover skill behavior during implementation. | Adding `resume` to the verdict union would require broader route, schema, UI, and apply semantics changes. |
| Read-only resume eligibility can be computed during sidecar generation without mutating state. | `packages/engine/src/resume/compiled-build.ts` documents `projectResumeEligibility()` as the read-only counterpart that never creates worktrees, copies artifacts, deletes files, or spawns workers. | high | low | Add a sidecar test that stubs/uses projection and asserts queue files are unchanged. | Sidecar generation could become unsafe if it accidentally mutates queue/worktree state. |
| Preserving `terminalSubtype` on `build:terminal-failure.failure` is the cleanest way to avoid subtype loss in authoritative recovery summaries. | `createBuildTerminalFailureTracker()` currently observes the source `plan:build:failed`; the authoritative event is the preferred recovery source; adding optional subtype keeps source facts with the authoritative event. | medium | medium | Implement schema/test slice and confirm event-history can read the field. | If event schema changes are undesirable, implementation may need to reconstruct subtype from source `plan:build:failed` rows instead. |
| Sidecar `recommendedAction` can differ from `verdict.verdict` when the recommended action is the separate compiled-resume route. | Current sidecar report already has a `recommendedAction` string separate from the machine verdict; recover skill docs already treat resume as separate from apply-recovery. | medium | low | Add sidecar rendering tests and update skill wording. | Consumers may misread manual verdict as blocking resume unless docs/report copy are clear. |
| The recovery analyst may be unavailable during the same outage that caused the build to fail. | User clarified the observed failure was an internet outage; recovery analyst calls are LLM/network backed. | high | low | Add tests where analyst output is null or throws and sidecar generation still writes deterministic resume evidence. | If not handled, recovery remains least useful exactly when infrastructure outages occur. |
| The observed failed build had enough preserved artifacts to make resume an appropriate option. | `monitor.db` shows a resume run for the set and the sidecar shows completed plans/feature-branch commits; full live eligibility was not queried because the daemon/client version mismatch blocked the tool path. | medium | low | During implementation, run `projectResumeEligibility()` against a fixture and optionally live failed PRD state. | If artifacts are absent/stale, sidecar should mark resume ineligible and not recommend it. |

No low-confidence/high-impact assumptions remain unresolved. The only medium-confidence design choice is whether to preserve subtype through an optional `build:terminal-failure.failure.terminalSubtype` field or reconstruct it from source events; both approaches are covered by the acceptance criteria as long as authoritative summaries preserve the subtype.

Profile signal:

Recommended profile: **Excursion**.

Rationale: this is a cohesive but cross-package recovery bugfix touching client transport classification, engine terminal failure/recovery summary synthesis, sidecar payload/rendering, daemon/client sidecar contracts, and Pi/Claude recover-skill documentation. A single planner can enumerate the implementation targets and tests; delegated module planning is unnecessary. It is not an Errand because it changes recovery semantics and typed event/sidecar contracts.

## Scope

In scope:

- Recognize `Backend error: Codex SSE response headers timed out after <N>ms` as transient backend transport failure.
- Preserve terminal subtype through `plan:build:failed`, `build:terminal-failure`, and recovery summary synthesis.
- Add optional typed sidecar-level resume eligibility / recovery option / recommended operator action.
- Keep `verdict.verdict` within the existing `retry | split | abandon | manual` union.
- Compute read-only compiled-build resume eligibility during sidecar generation when enough config/path context is available.
- Recommend `eforge_resume_build` / `/eforge:recover resume` when resume eligibility is true, including when the recovery analyst is unavailable or conservative.
- Keep blind retry unsafe when a transient failed plan has partial agent tool use.
- Update client-owned event schemas and route/sidecar wire types where needed.
- Update both Pi and Claude recovery skill instructions.
- Add regression tests for transient classification, subtype preservation, deterministic recommendation, sidecar resume evidence, analyst failure fallback, and event schema validation.

Out of scope:

- Adding `resume` to `RecoveryVerdict` unless the apply route is also expanded.
- Changing `eforge_apply_recovery` so it applies compiled-build resume.
- Weakening the `toolUseCount > 0` guard for blind PRD-level retry.
- Broadly classifying arbitrary timeout strings as transient transport failures.
- Mutating queue/worktree state during sidecar generation.
- Depending on host-only workflow behavior to surface the resume path.
- Depending on a network-backed recovery analyst to produce the actionable resume recommendation.

## Acceptance Criteria

- `classifyAgentTerminalSubtype(new Error("Backend error: Codex SSE response headers timed out after 10000ms"))` returns `error_transient_transport`.
- `isTransientTransportError("Backend error: Codex SSE response headers timed out after 10000ms")` returns `true`.
- `isTransientTransportError("command timed out after 10000ms")` returns `false`.
- `isTransientTransportError("SSE response headers timed out after 10000ms")` returns `false` when the string does not include the backend Codex error prefix.
- A `plan:build:failed` event with `terminalSubtype: "error_transient_transport"` produces a `build:terminal-failure` event whose `failure.terminalSubtype` is `error_transient_transport`.
- `safeParseEforgeEvent()` accepts `build:terminal-failure` events whose `failure.terminalSubtype` is `error_transient_transport`.
- `safeParseEforgeEvent()` rejects `build:terminal-failure` events whose `failure.terminalSubtype` is not in the client-owned `AgentTerminalSubtypeSchema` union.
- `synthesizeFromEvents()` preserves `terminalSubtype: "error_transient_transport"` in `failingPlan` when an authoritative `build:terminal-failure` carries that subtype.
- `synthesizeFromEvents()` preserves `terminalSubtype: "error_transient_transport"` in `failingPlans[0]` when an authoritative `build:terminal-failure` carries that subtype.
- `synthesizeFromEvents()` preserves `terminalSubtype: "error_transient_transport"` in the failed plan entry when an authoritative `build:terminal-failure` carries that subtype.
- `synthesizeFromEvents()` preserves `terminalSubtype: "error_transient_transport"` for a legacy run that has a `plan:build:failed` event with that subtype and no authoritative `build:terminal-failure` event.
- `determineRecoveryRecommendation()` returns `split` for a non-partial summary with completed or merged work, a failed plan with `terminalSubtype: "error_transient_transport"`, and zero failed-plan tool-use count.
- `determineRecoveryRecommendation()` returns `manual` for a non-partial summary with a failed plan with `terminalSubtype: "error_transient_transport"` and failed-plan `toolUseCount > 0`.
- A generated recovery sidecar includes a machine-readable resume eligibility / recovery option field when `projectResumeEligibility()` reports `eligible: true`.
- A generated recovery sidecar omits the resume recommendation or marks it ineligible with a non-empty reason when `projectResumeEligibility()` reports `eligible: false`.
- A generated recovery Markdown report contains a `Compiled-build resume` or explicitly equivalent compiled-build resume section when resume eligibility is true.
- A generated recovery Markdown report states that `eforge_resume_build` is the recommended operator action when resume eligibility is true and the verdict would otherwise be `manual` due to transient failure plus partial tool use.
- When the recovery analyst throws and resume eligibility is true, the generated sidecar includes the same deterministic resume recommendation.
- When the recovery analyst times out and resume eligibility is true, the generated sidecar includes the same deterministic resume recommendation.
- When the recovery analyst is aborted and resume eligibility is true, the generated sidecar includes the same deterministic resume recommendation.
- When the recovery analyst produces unparsable output and resume eligibility is true, the generated sidecar includes the same deterministic resume recommendation.
- A regression test simulates `runRecoveryAnalyst()` failing with a network-style error and asserts the resulting sidecar includes a compiled-build resume option when read-only resume eligibility is true.
- A regression test simulates `runRecoveryAnalyst()` failing with a network-style error and read-only resume eligibility false, and asserts the resulting sidecar remains manual with a non-empty ineligibility/inspection reason.
- A generated recovery JSON sidecar keeps `verdict.verdict` within the existing `retry | split | abandon | manual` union when resume is recommended.
- `eforge_apply_recovery` remains a no-op for `manual` verdicts even when the sidecar recommends compiled-build resume as a separate recovery option.
- The recovery sidecar generation path computes resume eligibility with `projectResumeEligibility()` or an equivalent read-only helper.
- The recovery sidecar generation path does not call `checkResumeEligibility()`.
- The recovery sidecar generation path does not call `prepareFailedPrdForQueuedCompiledResume()`.
- The recovery sidecar generation path does not call any helper that mutates queue/worktree state.
- Sidecar generation succeeds when resume eligibility projection throws.
- Sidecar generation writes a recovery sidecar when resume eligibility projection throws.
- The generated report records a bounded inspection/ineligibility reason when resume eligibility projection throws.
- Sidecar generation succeeds when resume eligibility projection cannot inspect the branch.
- Sidecar generation writes a recovery sidecar when resume eligibility projection cannot inspect the branch.
- The generated report records a bounded inspection/ineligibility reason when resume eligibility projection cannot inspect the branch.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` tells the operator to prefer the sidecar-provided compiled-build resume recommendation when present.
- `eforge-plugin/skills/recover/recover.md` tells the operator to prefer the sidecar-provided compiled-build resume recommendation when present.
- Pi and Claude recovery skill instructions remain behaviorally in sync for `retry`, `split`, `abandon`, `manual`, and `resume` paths.
- Existing retry/split/abandon/manual recovery sidecar tests continue to pass without requiring resume eligibility evidence.
- `pnpm type-check` exits 0.
- `pnpm test -- test/pipeline-error-translator.test.ts test/recovery-terminal-failure.test.ts test/recovery-recommendation.test.ts test/recovery-sidecars.test.ts packages/client/src/__tests__/events-schemas.test.ts packages/client/src/__tests__/terminal-failure-event.test.ts` exits 0.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- Review `eforge_apply_recovery` and recover skill behavior during implementation to confirm `resume` remains separate from the `RecoveryVerdict` apply path.
- During implementation, run `projectResumeEligibility()` against a fixture and optionally live failed PRD state to validate whether preserved artifacts are eligible.
- If manually inspecting the observed failure, use failed PRD `implement-iframe-bundled-console-workstation-sdk`, sidecar files `.eforge/queue/failed/implement-iframe-bundled-console-workstation-sdk.recovery.json` and `.eforge/queue/failed/implement-iframe-bundled-console-workstation-sdk.recovery.md`, and `monitor.db` run `51f778a2-046d-4130-9f83-3b33609f3742`.
- Full live eligibility was not previously queried for the observed failed build because a daemon/client version mismatch blocked the tool path.