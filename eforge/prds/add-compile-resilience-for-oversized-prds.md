---
title: Add compile resilience for oversized PRDs
created: 2026-06-26
priority: 1
---

# Add compile resilience for oversized PRDs

## Problem / Motivation

Eforge compile/planning currently lets oversized or overbroad PRDs enter planner prompts without enough risk gating, compaction, or bounded failure handling.

The motivating failure was a 2026-06-26 compile/planning run for `add-per-invocation-runtime-choice-routing`:

- The PRD was approximately 33KB.
- The PRD contained 71 acceptance criteria.
- The PRD embedded generated inventory content.
- Planning produced an approximately 221KB invalid `submit_plan_set` tool payload.
- Validation echoed large received arguments back into context.
- Usage grew to roughly 2.29M input tokens over 94 turns.
- The provider finally failed with a context-window error.
- No useful compiled artifacts landed.
- Continue-and-repair was ineligible because `orchestration.yaml` was missing.

This should become a product resilience path: eforge should detect, bound, classify, and recover from scope/context failures instead of making the user manually diagnose prompt-size dynamics.

## Goal

Implement engine-owned compile resilience for oversized PRDs by preflighting high-risk planning inputs, compacting generated inventories before planner prompts, bounding planner validation diagnostics, classifying context-window failures as typed scope/context failures, and recovering through retry-as-expedition or bounded decomposition when no usable artifacts exist.

Keep input authoring, scheduling, auto-drain, and broad workflow orchestration outside the engine.

## Approach

- Add compile preflight risk estimation using bounded, deterministic signals:
  - PRD/source byte size.
  - Acceptance-criteria count.
  - Generated inventory or sidecar detection.
  - Likely subsystem breadth.
  - Selected profile.
  - Selected pipeline scope.
- Prefer deterministic preflight metrics over token-perfect estimation because byte counts, section/AC counts, generated-inventory detection, and broad subsystem hints are explainable and cheap.
- Compact, omit, or summarize large machine-readable PRD inventories before planner prompts unless explicitly needed.
- Treat generated inventories as references instead of prompt bulk.
- Preserve enough hashes, counts, headings, path references, and compact human-readable summaries for traceability.
- Add compile-time context-growth guardrails so planner sessions stop with a bounded explanation before a hard provider context failure when risk crosses a safe threshold.
- Bound planner tool validation diagnostics, especially `submit_plan_set`.
- Validation diagnostics should report schema path, expected type, received type, compact excerpts, payload length, and content hash without echoing huge arguments.
- Make diagnostic bounding a reusable invariant using reusable payload summarization helpers.
- Classify provider context-window and context-length errors during compile as first-class typed scope/context failures.
- Route proactive context-budget stops and provider context-window failures through the same typed scope/context failure path.
- Route recovery toward retry-as-expedition or bounded decomposition when no useful artifacts exist.
- Keep retry-as-expedition bounded recovery rather than scheduling.
- Attempt retry-as-expedition only when eligibility is clear.
- Use attempt budgets to prevent retry loops.
- Do not automatically retry when valid partial artifacts require repair.
- Keep existing repair paths preferred when required partial artifacts are valid.
- Fail closed on partial success.
- Report compiled-plan success only after required artifacts such as `orchestration.yaml` and plan files are persisted and validated.
- Render any new typed recovery guidance through existing client, daemon, console, or extension surfaces as needed.
- Avoid a broad console or extension redesign beyond rendering new typed failure or recovery guidance.
- Add risk scoring and generated-inventory compaction close to normalized source intake, before planner prompts are built.
- Update compile/planning input assembly and prompt construction in the engine/input boundary.
- Wrap planner schema/tool validation failures with bounded diagnostic rendering.
- Map provider context-window errors and proactive context-budget stops in the compile lifecycle/failure classification path.
- Recommend or trigger retry-as-expedition/decomposition only through existing typed decision/recovery mechanisms.
- Use existing state mutation and build-decision helper discipline.
- Define any new failure or recovery event schemas or wire types in `@eforge-build/client`.
- Ensure daemon, console, and CLI surfaces consume shared client types rather than re-declaring route or wire shapes.
- Update documentation or integration packages only if user-facing command behavior changes.
- Keep Pi and Claude plugin behavior aligned when applicable.
- Use tests under the existing Vitest suite.
- Use real code in tests.
- Use stub harnesses where agent behavior must be simulated.
- Mitigate false positives with conservative thresholds, clear explanations, and tests preserving normal behavior.
- Mitigate false negatives by classifying provider context errors as the same typed failure path.
- Mitigate overcompaction by preserving counts, headings, hashes, path references, and compact human-readable summaries.
- Mitigate retry loops with attempt caps, idempotent recovery metadata, and no automatic retry when partial artifacts require repair.
- Mitigate event/API drift by centralizing wire shapes in `@eforge-build/client` and testing daemon/consumer projections.

## Scope

In scope:

- Add compile preflight risk estimation using bounded signals.
- Compact, omit, or summarize large machine-readable PRD inventories before planner prompts unless explicitly needed.
- Add compile-time context-growth guardrails.
- Bound planner tool validation diagnostics, especially `submit_plan_set`.
- Classify provider context-window/context-length errors during compile as first-class scope/context failures.
- Route recovery toward retry-as-expedition or bounded decomposition when no useful artifacts exist.
- Fail closed on partial success.
- Validate required compile artifacts before reporting success.
- Render new typed recovery guidance through existing client, daemon, console, or extension surfaces as needed.
- Add targeted unit and integration tests for preflight, compaction, diagnostic caps, context-failure classification, recovery recommendations, fail-closed validation, and unchanged normal errand/excursion behavior.

Out of scope:

- Redesigning the planner DSL.
- Replacing the provider/model stack.
- Moving input authoring into the engine.
- Moving scheduling into the engine.
- Moving auto-drain into the engine.
- Moving broad workflow orchestration into the engine.
- A broad console redesign beyond rendering new typed failure/recovery guidance.
- A broad extension redesign beyond rendering new typed failure/recovery guidance.

## Acceptance Criteria

- Compile preflight produces a compact risk result for oversized PRDs.
- Compile preflight uses PRD/source byte size as a bounded signal.
- Compile preflight uses acceptance-criteria count as a bounded signal.
- Compile preflight detects generated inventories or sidecars.
- Compile preflight uses likely subsystem breadth as a bounded signal.
- Compile preflight uses the selected profile as a bounded signal.
- Compile preflight uses the selected pipeline scope as a bounded signal.
- Compile preflight can recommend expedition before invoking a single overlarge planner session.
- Compile preflight can recommend decomposition before invoking a single overlarge planner session.
- Planner prompts summarize generated inventories unless full content is explicitly required.
- Planner prompts omit or path/hash-reference large machine-readable PRD sidecars unless full content is explicitly required.
- Inventory compaction preserves counts for traceability.
- Inventory compaction preserves headings for traceability.
- Inventory compaction preserves hashes for traceability.
- Inventory compaction preserves path references for traceability.
- Inventory compaction preserves compact human-readable summaries.
- Excursion planning can escalate to expedition when preflight predicts planner budget overflow.
- Excursion planning can use a bounded decomposition route when preflight predicts planner budget overflow.
- Excursion planning can escalate to expedition when the live context guard predicts planner budget overflow.
- Excursion planning can use a bounded decomposition route when the live context guard predicts planner budget overflow.
- Compile stops before a likely hard context-window/provider failure when context growth crosses a safe threshold.
- A proactive context-budget stop emits or exposes a bounded explanation.
- A proactive context-budget stop chooses a recovery recommendation.
- Planner tool validation errors report the schema path.
- Planner tool validation errors report the expected type.
- Planner tool validation errors report the received type.
- Planner tool validation errors report compact excerpts.
- Planner tool validation errors report payload length.
- Planner tool validation errors report content hash.
- Planner tool validation errors do not echo large received arguments.
- A deliberately huge invalid `submit_plan_set` payload produces a diagnostic below the configured size upper bound.
- Context-window failures during compile are classified as typed scope/context failures.
- Provider context-length failures during compile are classified as typed scope/context failures.
- Context-window failures during compile are not classified as generic manual failures.
- Provider context-length failures during compile are not classified as generic manual failures.
- Recovery guidance recommends retry-as-expedition when no useful artifacts exist.
- Recovery guidance recommends bounded decomposition when no useful artifacts exist.
- Existing repair paths remain preferred when required partial artifacts are valid.
- Automatic retry-as-expedition, if implemented, is attempted only when eligibility is clear.
- Automatic bounded decomposition, if implemented, is attempted only when eligibility is clear.
- Retry attempts are capped to prevent loops.
- Recovery metadata is idempotent across retries.
- Automatic retry is not attempted when valid partial artifacts require repair.
- Compile success is reported only after `orchestration.yaml` is persisted and validated.
- Compile success is reported only after required plan files are persisted and validated.
- Compile reports failure rather than success when `orchestration.yaml` is missing.
- Compile reports failure rather than success when required plan files are missing or invalid.
- Normal errand behavior for small and moderate PRDs remains unchanged.
- Normal excursion behavior for small and moderate PRDs remains unchanged.
- Small and moderate PRDs do not escalate due to oversized-PRD preflight.
- Small and moderate PRD prompts do not lose prompt detail due to the oversized-PRD resilience path.
- Unit tests cover preflight estimation for small PRDs.
- Unit tests cover preflight estimation for oversized PRDs.
- Unit tests cover preflight estimation for PRDs with many acceptance criteria.
- Unit tests cover preflight estimation for embedded generated inventories.
- Unit tests cover preflight estimation for broad subsystem hints.
- Unit tests cover inventory compaction retaining useful summaries.
- Unit tests cover inventory compaction omitting large machine-readable bodies.
- Unit tests cover bounded planner validation diagnostics for a huge invalid `submit_plan_set` payload.
- Unit tests assert bounded validation diagnostic length.
- Unit tests assert validation diagnostics do not echo the raw large payload.
- Unit tests assert validation diagnostics include schema path detail.
- Unit tests assert validation diagnostics include type detail.
- Unit tests assert validation diagnostics include hash detail.
- Integration or stub compile tests verify context-window errors produce typed scope/context classification.
- Integration or stub compile tests verify context-window errors produce a bounded explanation.
- Integration or stub compile tests verify context-window errors do not produce false success.
- Integration or stub compile tests verify retry-as-expedition or decomposition is recommended when artifacts are absent.
- Regression tests verify normal errand planning does not escalate for small inputs.
- Regression tests verify normal excursion planning does not escalate for small inputs.
- Regression tests verify normal errand planning does not lose prompt detail for small inputs.
- Regression tests verify normal excursion planning does not lose prompt detail for small inputs.
- If a new failure or recovery event variant is needed, it is defined in `@eforge-build/client`.
- If daemon, console, or CLI surfaces render new recovery guidance, they consume shared client types.
- If daemon, console, or CLI surfaces render new recovery guidance, they do not re-declare route or wire shapes.
- If user-facing command behavior changes, the Pi and Claude plugin behavior remains aligned where applicable.
- New tests are added to the existing Vitest suite.
- Tests use real code.
- Tests use stub harnesses where agent behavior must be simulated.
- `pnpm test` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
- `pnpm build` exits 0.