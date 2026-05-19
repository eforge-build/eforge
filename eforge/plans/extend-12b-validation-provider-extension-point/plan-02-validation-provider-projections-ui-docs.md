---
id: plan-02-validation-provider-projections-ui-docs
name: Validation provider projections, monitor UI, CLI, docs, and example extension
branch: extend-12b-validation-provider-extension-point/plan-02-validation-provider-projections-ui-docs
agents:
  doc-author:
    effort: high
    rationale: Four user-facing docs files plus a new example extension and SDK
      README change all need to land in sync with the runtime behavior shipped
      in plan-01. Higher doc-author effort improves accuracy of the runtime
      status table and the timeout/failure semantics sections.
---

# Validation provider projections, monitor UI, CLI, docs, and example extension

## Architecture Context

With plan-01 making validation-provider execution runtime-supported, plan-02 closes the visibility loop: extension list/show projections expose safe provider metadata (mirroring `reviewerPerspectiveDetails` in `packages/engine/src/extensions/projector.ts:74-92` and `packages/client/src/types.ts:103-109`), the daemon event-to-progress mapping surfaces failures/timeouts to MCP and Pi consumers, the monitor-UI timeline renders the new event family as readable rows, the CLI's extension display stops labelling providers as deferred, and the documentation/example set is updated so authors can actually write validation providers.

The projection pattern is established: `projector.ts` already builds `reviewerPerspectiveDetails` by filtering the registry by `extensionName + extensionPath`. We mirror that for validation providers, exposing `name`, `description`, `kind` (`function | commands`), `commandCount` (when commands form), and extension provenance — but never function source or raw command strings (consistent with the "safe metadata" rule applied to reviewer perspectives).

The monitor-UI timeline (`packages/monitor-ui/src/components/timeline/event-card.tsx:28,109-117`) currently renders the post-merge `validation:command:*` family via direct case branches. We add a parallel branch for the new `extension:validation-provider:*` family so failures/timeouts appear as readable rows with provider name and extension provenance.

## Implementation

### Overview

1. Add safe `validationProviderDetails` metadata to the extension projector and the corresponding client type.
2. Update the event-to-progress mapping so provider failures/timeouts (and optionally start/complete) are surfaced as high-signal updates to MCP and Pi consumers.
3. Render the new `extension:validation-provider:*` events as timeline rows in the monitor UI's event card.
4. Update the CLI's extension display (list/show/validate/test commands) so loaded validation providers are visible with the new metadata and no longer labelled as deferred.
5. Update docs: `docs/extensions.md` runtime-status table, `docs/extensions-api.md` validation-provider section, `docs/config.md` for the new timeout key, and `packages/extension-sdk/README.md` capability table.
6. Add a runnable `examples/extensions/validation-provider.ts` demonstrating both function- and command-form providers and update `examples/extensions/README.md`.
7. Update the `eforge extension test` replay summary so validation providers are reported as runtime-supported (replay still does not execute them).

### Key Decisions

1. **Projection metadata is safe-by-default**: expose `name`, `description`, `kind`, `commandCount`, `extensionName`, `extensionPath`. Do not expose function source. For command-form providers, expose `commandCount` but **not** the literal command strings (some teams may treat command content as sensitive); the count is sufficient for diagnostics.
2. **High-signal events for progress**: provider `error` and `timeout` are always high-signal. `complete` with `status: 'passed'` is filtered (consistent with the existing handling of `extension:reviewer-perspective:applied`-style noise). `start` is filtered unless we observe a need.
3. **Timeline rendering parallels the existing `validation:command:*` rows**: a one-line summary with provider name + status; a details body showing message/command/exit-code for failures/timeouts.
4. **`eforge extension test` replay**: continue to skip provider execution in replay mode (providers may execute arbitrary commands/IO that need a real worktree); update the static summary so the runtime-status table cell shows "Yes" instead of "Deferred".
5. **Example demonstrates both forms**: one function-form provider that runs `pnpm type-check` programmatically via `ctx.exec.run`, and one command-form provider that runs a shell command directly. The README's example index lists it.

## Scope

### In Scope
- Projector additions to `packages/engine/src/extensions/projector.ts` and the matching `ValidationProviderDetail` type in `packages/client/src/types.ts`.
- Event-to-progress mapping for the new `extension:validation-provider:*` events.
- Monitor-UI timeline rendering for the new event family in `packages/monitor-ui/src/components/timeline/event-card.tsx` (and optionally `handle-validation.ts` if provider spans should sit alongside command spans; default is timeline-only).
- CLI extension display: update wherever `extension list/show/validate/test` rendering happens to print validation-provider metadata and remove the "deferred" label.
- Docs: `docs/extensions.md` (runtime-support table line 316), `docs/extensions-api.md` (validation-provider section starting line 590), `docs/config.md` (new `validationProviderTimeoutMs` entry), `packages/extension-sdk/README.md` (capability table line 82).
- Example: `examples/extensions/validation-provider.ts` (new) + `examples/extensions/README.md` (add index entry).
- `eforge extension test` summary: report validation providers as runtime-supported.
- Tests covering projection shape, event-to-progress mapping, monitor-UI rendering, CLI rendering, docs/example references, and the replay-summary update.

### Out of Scope
- Any change to runtime execution, recorder validation, event schemas, or engine wiring (all delivered in plan-01).
- Auto-injecting the `validate` stage into pipelines that omit it (composer visibility is plan-01).
- Surfacing raw command strings in the projection (treat as sensitive).

## Files

### Create
- `examples/extensions/validation-provider.ts` — runnable example with two providers: (1) function-form `type-check-gate` using `ctx.exec.run('pnpm', ['type-check'])`; (2) command-form `lint-gate` using `commands: ['pnpm lint']`. Includes a header doc comment describing the timeout/failure semantics and the no-mutation contract.
- `test/validation-provider-projection.test.ts` — asserts `projectExtensionRegistry()` returns the new `validationProviderDetails` array with the correct shape (name, description, kind, commandCount, extensionName, extensionPath) and that command-form providers report `kind: 'commands'` and `commandCount` (not the command strings).
- `test/validation-provider-progress.test.ts` — asserts `eventToProgress` returns a non-null `ProgressUpdate` for `extension:validation-provider:error` and `extension:validation-provider:timeout`, and returns `null` for `extension:validation-provider:complete` with `status: 'passed'`.

### Modify
- `packages/engine/src/extensions/projector.ts` — add a `buildValidationProviderDetails(registry, extensionName, extensionPath)` helper mirroring `buildReviewerPerspectiveDetails` (lines 74-92). Attach `validationProviderDetails?: ValidationProviderDetail[]` to each projected extension entry next to `reviewerPerspectiveDetails` (line 13-15 region and lines 95-115). Keep the existing `totals.validationProviders` field unchanged.
- `packages/client/src/types.ts` — at the reviewer-perspective detail region (lines 84-109), add a parallel `ValidationProviderDetail` interface: `{ name: string; description: string; kind: 'function' | 'commands'; commandCount?: number; extensionName: string; extensionPath: string }`. Add `validationProviderDetails?: ValidationProviderDetail[]` to the projected-extension entry type (line 189 region).
- `packages/client/src/event-to-progress.ts` — add explicit cases for the new event family: `extension:validation-provider:error` returns `{ message: 'Validation provider <name> (<extensionName>) failed: <message>', counters }`; `extension:validation-provider:timeout` returns `{ message: 'Validation provider <name> timed out after <timeoutMs>ms', counters }`; `extension:validation-provider:complete` with `status: 'passed'` returns null; `extension:validation-provider:start` returns null. Match the style of the existing explicit `case` blocks (lines 52-117).
- `packages/monitor-ui/src/components/timeline/event-card.tsx` — add case branches for the four new event types alongside the existing `validation:command:*` branches (around lines 109-117 for one-line summaries and lines 218-220 for details/severity classes). Failures/timeouts get the `failed` severity class; complete/start get a neutral class.
- `packages/monitor-ui/src/lib/reducer/handle-validation.ts` and `types.ts` — *optional*: if provider runs should appear in the validation command panel, add provider spans; default is timeline-only, so this file may receive no changes. Prefer timeline-only unless a tester explicitly requests command-panel integration.
- `packages/eforge/src/cli/...` — locate the extension list/show/validate/test rendering (use the existing `extension-cli-commands.test.ts` paths to identify files). Update to (a) print loaded validation providers with their `validationProviderDetails`, (b) drop any "deferred" wording in the runtime-status output of `eforge extension test`. The static summary table in `eforge extension test` should now show validation-provider execution as runtime-supported.
- `docs/extensions.md` — at line 316, change `| `registerValidationProvider` | Yes | Yes | Deferred |` to `| `registerValidationProvider` | Yes | Yes | Yes (per-plan `validate` build stage) |`. Update the surrounding prose around line 300-318 to remove "Validation provider execution" from the "future runtime phases" list and add a new "Validation providers" subsection describing: execution position (per-plan, after implement, before review when `validate` is in the build pipeline), result contract (legacy string|null|undefined + structured `ValidationProviderResult`), command-form alternative, fail-closed/daemon-safe timeout semantics, no-mutation contract, and the new `extension:validation-provider:*` events.
- `docs/extensions-api.md` — at the `registerValidationProvider(spec)` section starting line 590, replace the "Runtime status: ... deferred" line with a runtime-supported note. Expand the `ValidationProviderSpec` block to show the function-form, command-form, and ambiguous-form-rejection rules. Document `ValidationProviderContext` and `ValidationProviderResult`. Add a worked example matching `examples/extensions/validation-provider.ts`. Update the runtime-status row at line 841 to match the change at line 316 of `extensions.md`.
- `docs/config.md` — add a new entry for `extensions.validationProviderTimeoutMs` next to the existing `policyGateTimeoutMs` entry at lines 24-27, with the same documentation pattern: "Optional registerValidationProvider timeout; defaults to eventHookTimeoutMs".
- `packages/extension-sdk/README.md` — at the capability table line 82, change `| `registerValidationProvider(spec)` | Add custom validation step | Yes | Deferred |` to `| `registerValidationProvider(spec)` | Add custom validation step | Yes | Yes |`. Update any prose nearby that calls validation providers deferred.
- `examples/extensions/README.md` — add the new `validation-provider.ts` example to the index with a one-line description.
- `test/extension-cli-commands.test.ts` — line 671 comment update completed in plan-01; add new assertions in this plan that the CLI prints validation-provider metadata (name, description, kind) when an extension registers one, and that `eforge extension test` no longer prints "deferred" near validation providers.
- `test/extension-tooling-wiring.test.ts` — at line 337-341 (the validation-provider row check), update the test to assert the new docs row reflects runtime support rather than "Deferred". The row-exists assertion remains.
- `test/extension-authoring-skill.test.ts` — keep the inventory check at line 186 unchanged; verify nothing else references "deferred" status for validation providers.

## Verification

- [ ] `test/validation-provider-projection.test.ts` asserts that an extension registering one function-form and one command-form provider projects two `validationProviderDetails` entries with `kind: 'function'` and `kind: 'commands'` respectively, and that the commands-form entry exposes `commandCount` but no raw command strings.
- [ ] `test/validation-provider-progress.test.ts` asserts the documented filtering: error/timeout produce non-null updates, complete (passed) and start produce null.
- [ ] `test/extension-cli-commands.test.ts` (post-change) prints validation-provider metadata and never prints the string "deferred" adjacent to validation providers in `eforge extension test` output.
- [ ] `test/extension-tooling-wiring.test.ts` asserts the validation-provider row in `docs/extensions.md` shows runtime support (not "Deferred").
- [ ] A grep of `docs/` and `packages/extension-sdk/README.md` for the literal token "Deferred" returns no occurrences adjacent to `registerValidationProvider`.
- [ ] `examples/extensions/validation-provider.ts` loads cleanly via the existing extension loader test patterns (no new test required, but `extension-sdk-example.test.ts:448` still imports `sdk.ValidationProviderSpec`).
- [ ] `pnpm docs:check` passes after docs are regenerated (`pnpm docs:generate`).
- [ ] `pnpm type-check` and `pnpm test` pass.
- [ ] Manually inspecting an event log containing `extension:validation-provider:error` shows the monitor-UI timeline rendering provider name and extension provenance in a `failed`-severity row.
