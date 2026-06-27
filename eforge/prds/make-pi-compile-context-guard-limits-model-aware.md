---
title: Make Pi Compile Context Guard Limits Model-Aware
created: 2026-06-27
---

# Make Pi Compile Context Guard Limits Model-Aware

## Problem / Motivation

Compile planner-family live context guardrails currently use a static `maxObservedInputTokens` default of `160,000` for all models. This protects common large-context builds but can false-fail higher-context Pi models and under-protect lower-context or custom Pi models.

The guard already checks per-turn usage instead of cumulative multi-turn input, so the missing piece is deriving the safe per-turn input limit from the active Pi runtime model metadata when available.

## Goal

Make compile live-context guard limits model-aware for Pi planner-family runs by deriving safe per-turn input limits from Pi model metadata. Improve typed failure diagnostics, rendering, docs, and tests while explicitly leaving Claude Agent SDK model-aware guard integration out of scope.

## Approach

- Resolve limits before starting each planner-family agent run, using the same resolved agent config that selects the harness, model, and provider for the actual run.
- In `packages/engine/src/pipeline/stages/compile-stages.ts`, derive per-run guard limits after `resolveAgentConfig(...)` for each planner-family role and pass them into `compileContextGuardOptions(...)`.
- Use Pi `ModelRegistry` metadata as the authority for built-in and custom model metadata.
- Prefer a shared helper near the Pi harness/model-resolution boundary so provider SDK imports remain controlled and Pi harness model-resolution logic is not duplicated.
- For known Pi models with `contextWindow`, compute `maxObservedInputTokens` as a safe usable-input budget.
- Derive output reserve from `maxTokens` when available.
- Use a conservative default output reserve when `maxTokens` is not available.
- Subtract a tool/transport overhead reserve.
- Apply a safety margin.
- Do not use the full context window as the input-token guard limit.
- For missing `contextWindow`, missing provider/model, registry lookup errors, or invalid derived values, use the existing conservative fallback and attach a diagnostic reason.
- Include a structured diagnostic object such as provider, model id, metadata source (`registry`, `custom-override`, `fallback`, etc. as feasible), context window, output reserve, overhead reserve, safety margin, and final limits.
- Include resolved Pi provider/model id and resolved guard limits in `planning:scope-context:failure` evidence.
- Keep the engine/client boundary intact: the engine derives and emits structured guard diagnostics, and clients render those diagnostics.
- Keep the client event schema as the owner of the wire shape.
- In `packages/engine/src/compile-resilience/context-guard.ts`, extend guard options and failure construction to carry resolved guard diagnostics while keeping per-turn input accounting intact.
- In `packages/client/src/events/shared/compile-resilience.ts`, add optional typed diagnostic fields for resolved guard limits/model metadata if diagnostics are structured instead of explanation-only.
- Update renderers/tests that summarize compile scope/context failures, including `packages/eforge/src/cli/compile-resilience-display.ts` and `packages/console-ui/src/lib/compile-resilience-format.ts`, to surface the new details when present without breaking older events.
- Documentation surfaces may include code comments, `docs/architecture.md`, troubleshooting/glossary content, and generated reference docs if event fields change.
- Prompt byte guard defaults can remain static for this item unless source audit shows they must be coupled to token limits.
- Add a nearby explicit comment in the non-Pi/Claude SDK branch stating Claude Agent SDK model-aware guard integration is intentionally not implemented because that harness is expected to be deprecated and because of Anthropic policies around third-party harnesses.

Risks to watch:

- A formula that is too aggressive may still allow provider context-window failures; mitigate with output/tool reserves and a safety margin.
- A formula that is too conservative may keep false failures for high-context models; mitigate with large-context metadata tests.
- Pi harness/resolver drift may occur; mitigate by sharing or centralizing metadata lookup where practical.
- Event contract/rendering drift may occur; mitigate through `@eforge-build/client` schema updates and renderer tests.

## Scope

In scope:

- Make Pi planner-family compile runs resolve `maxObservedInputTokens` from the active resolved runtime/model.
- Apply this to `pipeline-composer`, `planner`, and `module-planner`.
- Use Pi `ModelRegistry` metadata, including custom model overrides, to read `contextWindow` and output-token metadata such as `maxTokens` when present.
- Keep conservative documented fallbacks for unknown Pi models or missing/invalid metadata.
- Include resolved Pi provider/model id and resolved guard limits in `planning:scope-context:failure` evidence.
- Update developer/user-facing diagnostics and docs where those failure details are rendered.
- Add focused unit tests for guard-limit derivation covering known Pi metadata, custom override-style metadata, missing metadata, invalid metadata, and fallback reason text.
- Extend `test/planner-context-guard.test.ts` or adjacent tests to assert failure diagnostics include model/limit details and existing per-turn accounting behavior remains unchanged.
- Extend client contract tests for the optional failure diagnostic fields.

Out of scope:

- No Claude Agent SDK model-aware guard implementation.
- No broad changes to compile preflight scoring.
- No broad changes to retry-as-expedition policy.
- No broad changes to recovery sidecar action semantics beyond improved diagnostics.

## Acceptance Criteria

- Pi `pipeline-composer` compile runs derive `maxObservedInputTokens` from active Pi provider/model metadata when `contextWindow` is available.
- Pi `planner` compile runs derive `maxObservedInputTokens` from active Pi provider/model metadata when `contextWindow` is available.
- Pi `module-planner` compile runs derive `maxObservedInputTokens` from active Pi provider/model metadata when `contextWindow` is available.
- Custom Pi model overrides influence the derived guard limit.
- Unknown Pi models use a documented conservative fallback.
- Metadata-incomplete Pi models use a documented conservative fallback.
- Missing or invalid Pi metadata emits diagnostic detail that explains the fallback.
- Derived limits reserve output-token overhead instead of using the full context window.
- Derived limits reserve tool/transport overhead instead of using the full context window.
- Derived limits apply a safety margin instead of using the full context window.
- `planning:scope-context:failure` evidence includes the resolved Pi provider id.
- `planning:scope-context:failure` evidence includes the resolved Pi model id.
- `planning:scope-context:failure` evidence includes resolved guard limits.
- `@eforge-build/client` event schemas include optional typed diagnostic fields for resolved guard limits/model metadata when structured diagnostics are emitted.
- CLI compile-resilience failure rendering surfaces the new guard diagnostic details when present.
- Console compile-resilience failure formatting surfaces the new guard diagnostic details when present.
- CLI compile-resilience failure rendering remains compatible with older failure events that lack the new optional diagnostics.
- Console compile-resilience failure formatting remains compatible with older failure events that lack the new optional diagnostics.
- Claude Agent SDK model-aware guard integration is not added.
- The non-Pi/Claude SDK branch includes an explicit code comment explaining that model-aware guard integration is intentionally not implemented because the harness is expected to be deprecated and because of Anthropic policies around third-party harnesses.
- Unit tests validate guard-limit derivation from Pi built-in metadata.
- Unit tests validate guard-limit derivation from custom override-style metadata.
- Unit tests validate fallback behavior for missing metadata.
- Unit tests validate fallback behavior for invalid metadata.
- Unit tests validate fallback reason text.
- Planner context guard tests assert failure diagnostics include model details.
- Planner context guard tests assert failure diagnostics include limit details.
- Planner context guard tests assert per-turn input accounting remains unchanged and does not regress to cumulative multi-turn input accounting.
- Client contract tests validate the optional failure diagnostic fields.
- Existing compile context recovery behavior works with older failure events that lack the new optional diagnostics.
- `pnpm test` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
- When generated event or documentation artifacts change, `pnpm docs:generate` completes successfully.
- When generated event or documentation artifacts change, `pnpm docs:check` exits 0.