---
id: plan-02-contribution-output-profiles-validation
name: Contribution Output Profiles and Validation Warnings
branch: compact-eforge-plan-workstation-loading-and-oversized-output-safeguards/plan-02-contribution-output-profiles-validation
agents:
  builder:
    effort: high
    rationale: This plan adds a backward-compatible contribution wire field, SDK
      typing, registration diagnostics, and first-party action metadata.
  reviewer:
    effort: high
    rationale: The client-owned manifest schema and extension SDK/engine boundary
      need API-focused review.
---

# Contribution Output Profiles and Validation Warnings

## Architecture Context

Contribution wire shapes are owned by `@eforge-build/client`, while SDK action authoring types live in `packages/extension-sdk` and registration validation/projection lives in `packages/engine/src/extensions`. Host safeguards need metadata that marks rich/debug outputs, and extension registration needs warning-only diagnostics for broad list/search/board actions that lack agent ergonomics.

This plan adds output-profile metadata and warning diagnostics without changing action invocation success/failure response shapes.

## Implementation

### Overview

Add an optional `outputProfile` field to extension action specs and action manifest entries. Validate and project that metadata through the SDK, engine recorder, and client manifest schema. Add warning-only registration diagnostics for broad list/search/board-style actions that lack limit, cursor, or projection controls, and for broad large-output schemas that omit an explicit output profile.

### Key Decisions

1. Keep warnings as `NativeExtensionDiagnostic` entries with `severity: "warning"`; invalid registrations remain errors.
2. Use a small string-literal profile set so manifests stay JSON-safe and host code can branch without local shape re-declarations: `agent-compact`, `agent-paginated`, `markdown`, `ui-rich`, and `debug-rich`.
3. Treat `ui-rich` and `debug-rich` as explicit rich modes. They suppress the large-output-without-profile warning but host formatters still warn/truncate them for coding-agent surfaces.
4. Derive broad-action diagnostics from local/effective action id, title/description, input schema property names, and output schema array shapes. Do not execute handlers during validation.

## Scope

### In Scope

- Add SDK and engine types for optional action `outputProfile`.
- Add client TypeBox schema and exported type for action output profiles.
- Project `outputProfile` in action manifest entries and host contribution summary entries.
- Add SDK helper constants or a typed helper in `bounded-contributions.ts` for common profiles.
- Add warning diagnostics for unbounded broad list/search/board actions.
- Add warning diagnostics for broad large-output action schemas without explicit output profiles.
- Mark first-party eforge-plan actions with output profiles: compact query/detail actions as agent compact/paginated, `render-board-markdown` as markdown, and rich `list-board` as debug rich.
- Update tests for bounded and unbounded examples.

### Out of Scope

- Blocking registration for unbounded actions.
- Changing action invocation response wire shapes.
- Removing rich/debug actions.
- Host truncation/rendering behavior; that is covered by plan 03.

## Files

### Create

- `test/extension-contribution-validation.test.ts` — focused tests for warning diagnostics on unbounded list/search/board action examples and no-warning bounded/profiled examples.

### Modify

- `packages/client/src/extension-contributions.ts` — add `ExtensionActionOutputProfileSchema`, exported type, and optional `outputProfile` on `ExtensionActionManifestEntrySchema`.
- `packages/client/src/browser.ts` — export the profile schema/type if the main module adds named exports not already covered by `extension-contributions.ts` exports.
- `packages/client/src/api/extension-contribution-dispatch.ts` — include `outputProfile` on `ExtensionHostContributionEntry` for actions and action-backed commands/deep links.
- `packages/client/src/__tests__/extension-contributions.test.ts` — assert manifests accept valid profiles, reject invalid profiles, and browser exports stay browser-safe.
- `test/extension-contribution-dispatch.test.ts` — assert contribution summaries carry output profiles from underlying actions.
- `packages/extension-sdk/src/contributions.ts` — add `ExtensionActionOutputProfile` type and optional `outputProfile` field on `ExtensionAction`.
- `packages/extension-sdk/src/bounded-contributions.ts` — add/document profile helper constants or a typed helper for compact, paginated, markdown, UI-rich, and debug-rich outputs.
- `packages/extension-sdk/src/index.ts` — export output profile types/helpers.
- `test/extension-sdk-bounded-contributions.test.ts` — assert helper constants/types are exported and JSON-safe.
- `packages/engine/src/extensions/types.ts` — add `outputProfile` to `ExtensionActionSpec` and related registration value shape.
- `packages/engine/src/extensions/contribution-validation.ts` — validate profile values and derive warning diagnostics for broad action ergonomics.
- `packages/engine/src/extensions/recorder.ts` — append warning diagnostics from successful action validation while still recording the action.
- `packages/engine/src/extensions/manifest.ts` — clone/project `outputProfile` into the manifest.
- `test/extension-contribution-registry-runtime.test.ts` — assert warning diagnostics are projected in manifests and do not block valid actions.
- `eforge/extensions/eforge-plan/board-actions.ts` — mark `list-board` as `debug-rich` and `render-board-markdown` as `markdown`; update descriptions to identify compatibility/debug rich output.
- `eforge/extensions/eforge-plan/backlog-query-actions.ts` — mark compact query/detail actions with agent compact/paginated profiles.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — assert first-party actions expose expected output profiles and no invalid-registration errors are emitted.
- `docs/extensions.md` — document action output profiles and warning-only broad-action validation.

## Verification

- [ ] Client schema tests accept valid action `outputProfile` values and reject an invalid value.
- [ ] SDK tests expose profile helpers from `@eforge-build/extension-sdk`.
- [ ] Validation tests produce separate warning diagnostics for missing limit, cursor, projection, and output profile on an unbounded broad action.
- [ ] Validation tests record a broad paginated action with limit/offset/projection controls and an explicit profile without warnings.
- [ ] Registry runtime tests show warning diagnostics in the contribution manifest and still include the warned action.
- [ ] eforge-plan registration tests show `list-board` as `debug-rich`, `render-board-markdown` as `markdown`, and compact actions as agent compact/paginated.
- [ ] `pnpm exec vitest run test/extension-contribution-validation.test.ts test/extension-contribution-registry-runtime.test.ts test/extension-contribution-dispatch.test.ts packages/client/src/__tests__/extension-contributions.test.ts test/extension-sdk-bounded-contributions.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts` exits 0.
