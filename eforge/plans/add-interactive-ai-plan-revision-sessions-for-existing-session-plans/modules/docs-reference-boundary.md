# Docs Reference Boundary

## Architecture Reference

This module implements the architecture sections **Documentation updates**, **Module: `docs-reference-boundary`**, **Shared File Registry**, **Quality attributes and test strategy** documentation coverage, and **Consumer integration check**.

Key constraints from architecture:
- `eforge-plan` documentation must describe bounded first-party plan revision sessions without presenting a generic daemon-owned chat runtime.
- Shared extension docs must document `planRevisionTurn` as an additive requested-output/result contract for the existing single-shot `eforge-plan.planning-draft` task kind, not as a new task kind or generic prompt-template surface.
- The daemon remains responsible for task records/status/result/error; eforge-plan owns revision threads, target-session linkage, preview/apply semantics, stale apply blocking, and applied metadata.
- Revision apply is explicit, section-only for V1, guarded by base plan fingerprints, and does not mark ready, hand off, enqueue, or mutate backlog state.
- Generated docs artifacts must be regenerated through `pnpm docs:generate` rather than hand-edited.
- Pi and Claude plugin docs/package metadata must remain unchanged unless the implementation exposes new CLI, MCP, Pi command, Claude plugin command, or skill behavior; this feature is expected to be Console workstation-only.

## Scope

### In Scope
- Update `eforge/extensions/eforge-plan/README.md` to describe **Revise with AI** for existing flat session plans.
- Add all revision-session action ids, example inputs, side effects, and storage paths to the eforge-plan README.
- Document answer-only turns, top-level `needs-input` clarification/redraft, patch previews, explicit selected-section apply, stale fingerprint blocking, retry behavior, and handoff separation.
- Update shared extension docs so `ctx.agentTasks` and planning-draft output sections mention `planRevisionTurn` while preserving the unsupported generic chat/runtime boundary.
- Update extension API docs where they enumerate planning-draft requested output sections or daemon-owned task limitations.
- Regenerate public docs mirrors and LLM reference bundles after source docs change.
- Add docs contract tests that assert the new eforge-plan README and shared extension docs contain the revision-session contract and preserve daemon chat boundary language.
- Run the docs drift/link checks and the Pi/Claude skill parity check.
- Inspect `eforge-plugin/` and `packages/pi-eforge/` before sign-off and leave them unchanged unless an implementation dependency added a new user-facing integration surface.

### Out of Scope
- Shared client task schema, engine submit tool, prompt, daemon metadata counting, or API version implementation.
- eforge-plan revision-session stores, action schemas, handlers, action registration, fingerprint helpers, or backend tests.
- Plans tab UI, workstation source, mock fixtures, bridge handlers, workstation tests, or workstation bundle source changes.
- Session plan-set revision documentation beyond stating flat-plan-only V1.
- New CLI commands, MCP tools, integration commands, deep links, Pi commands, Claude plugin skills, or plugin version bumps.
- New extension marketplace chat APIs, daemon chat transcripts, custom task-kind docs, arbitrary prompt-template docs, or mutation-capable agent-tool docs.

## Implementation Approach

### Overview

After the dependency modules land, update documentation from the implemented contracts outward. Start with the eforge-plan README because it is the first-party user-facing source for the workstation and action surface. Then update shared extension guides/API references to explain that `planRevisionTurn` is a first-party application-level use of the existing daemon-owned single-shot task runner. Finally, regenerate public mirrors and LLM bundles, add focused docs contract tests, and run parity/drift checks.

The docs must make two boundaries explicit at the same time:

1. eforge-plan now provides bounded revision sessions for one existing flat session plan by chaining read-only planning tasks and storing the thread in extension-private storage.
2. Native extensions still do not get a generic multi-turn chat runtime, daemon-owned conversation memory, raw prompt-template registration, or write-capable agent tools through `ctx.agentTasks`.

### Key Decisions

1. **Document revision sessions as an eforge-plan application pattern.** The shared extension guide will describe first-party eforge-plan revision sessions as an application-level pattern built from extension actions plus daemon-owned single-shot tasks, not a platform-level chat feature.
2. **Keep `planRevisionTurn` tied to the existing task kind.** The shared docs will list `planRevisionTurn` beside `sessionPlanCreationDraft` and `backlogCurationDraft` as a requested output/result section for `eforge-plan.planning-draft`.
3. **Keep clarification language top-level.** Docs will state that clarification still uses the existing top-level `needs-input` result with questions/rationale and starts a linked redraft through eforge-plan actions.
4. **Make apply safety concrete.** The README will name `basePlanFingerprint`, stale apply blocking, selected section apply, adapter-backed section writes, readiness refresh, and no ready/handoff/enqueue side effects.
5. **Treat generated docs as derived files.** `web/public/docs/*`, `web/public/reference/*`, `web/public/llms.txt`, and `web/public/llms-full.txt` are updated only by running `pnpm docs:generate`; commit exactly the generated drift.
6. **No Pi/Claude docs change for workstation-only behavior.** Revision actions are allowed inside the eforge-plan workstation `allowedActions` list, but they do not create new host integration commands or skills.

## Files

### Create
- `test/eforge-plan-plan-revision-docs.test.ts` — docs contract tests for the eforge-plan README, shared extension guide/API pages, generated public mirrors, LLM bundle content, and consumer integration non-surface assertions.

### Modify
- `eforge/extensions/eforge-plan/README.md` — add **Revise with AI** usage examples, storage path, action table rows, workstation behavior, task/apply boundary prose, and generic daemon chat non-goal language `[region: docs-reference-boundary, Usage action bullets, Storage model, Actions table, Console/workstation paragraphs, Planning workstation boundary paragraphs]`.
- `docs/extensions.md` — add `planRevisionTurn` to the daemon-owned planning-draft output-section description and document eforge-plan bounded revision sessions as an application-level pattern while retaining unsupported generic chat/runtime text `[region: docs-reference-boundary, Daemon-owned agent tasks from actions and boundary paragraphs]`.
- `web/content/docs/extensions.md` — mirror the shared guide changes in the public guide source, preserving web-style links and public wording `[region: docs-reference-boundary, Daemon-owned agent tasks from actions and boundary paragraphs]`.
- `docs/extensions-api.md` — update the `ctx.agentTasks` planning-draft output-section list and task-boundary prose to include `planRevisionTurn` and extension-owned revision threads.
- `web/content/docs/extensions-api.md` — mirror the extension API reference changes in the public guide source, preserving web-style links.
- `web/public/docs/extensions.md` — regenerated mirror of `web/content/docs/extensions.md`; do not hand-edit `[region: docs-reference-boundary, generated public docs mirror]`.
- `web/public/docs/extensions-api.md` — regenerated mirror of `web/content/docs/extensions-api.md`; do not hand-edit.
- `web/public/llms-full.txt` — regenerated full LLM bundle containing the updated extension guide/API content; do not hand-edit `[region: docs-reference-boundary, generated LLM bundle]`.
- `web/public/llms.txt` — regenerate and commit only if `pnpm docs:generate` changes it.
- `web/content/reference/*.md` and `web/public/reference/*.md` — regenerate and commit only if dependency-module client/docs-gen changes produce reference drift; no hand edits planned.

### Inspect Without Modifying
- `eforge-plugin/` — verify no new Claude plugin command, MCP tool, or skill documentation is required; expected final diff is empty.
- `packages/pi-eforge/` — verify no new Pi command, tool, skill, or package version change is required; expected final diff is empty.

## Documentation Detail Checklist

### eforge-plan README
- Usage examples include all seven action ids: `start-plan-revision-session`, `list-plan-revision-sessions`, `get-plan-revision-session`, `start-plan-revision-turn`, `retry-plan-revision-turn`, `cancel-plan-revision-turn`, and `apply-plan-revision-turn`.
- The storage model lists `.eforge/storage/extensions/eforge-plan/plan-revisions/index.json` and identifies it as extension-private revision-session thread/index storage.
- The action table includes side effects for each revision action and excludes `build-queue` from `apply-plan-revision-turn`.
- The Plans tab description states that **Revise with AI** appears for flat session plans only and not session plan sets.
- The workstation behavior text covers answer-only turns, patch-bearing `planRevisionTurn` results, top-level `needs-input` clarification turns, retry/redraft, stale apply warnings, and applied-section markers.
- The apply text states that patch previews require explicit selected-section apply with `previewAcknowledged: true` and `confirmApply: true`, write through adapter-backed section mutations, refresh readiness, and leave ready marking/handoff/build enqueue to separate controls.
- The boundary text preserves unsupported generic daemon-owned chat/runtime language while distinguishing bounded eforge-plan revision sessions.

### Shared extension docs
- The `ctx.agentTasks` guide text lists `planRevisionTurn` with `recommendations`, `sessionPlanCreationDraft`, and `backlogCurationDraft` as a planning-draft output section.
- The guide states that answer-only revision turns remain output-bearing because `planRevisionTurn` contains assistant narrative even when no patch is proposed.
- The guide states that clarification continues through the top-level output-free `needs-input` decision.
- The guide states that first-party eforge-plan revision sessions store transcript/index state in eforge-plan extension storage and link turns to daemon task ids.
- The guide states that native extensions cannot use `ctx.agentTasks` to implement arbitrary multi-turn chat, custom task kinds, raw prompt templates, daemon-owned conversation memory, or write-capable agent sessions.

## Testing Strategy

### Unit Tests
- `test/eforge-plan-plan-revision-docs.test.ts` reads `eforge/extensions/eforge-plan/README.md` and asserts the README contains:
  - `Revise with AI`
  - `.eforge/storage/extensions/eforge-plan/plan-revisions/index.json`
  - all seven revision action ids
  - `answer-only`
  - `patch preview`
  - `explicit apply`
  - `stale`
  - `retry`
  - `redraft`
  - `handoff remains separate`
  - `generic daemon-owned chat runtime` or an equivalent preserved unsupported-generic-chat phrase
- The same test reads `docs/extensions.md`, `web/content/docs/extensions.md`, and `web/public/docs/extensions.md` and asserts each contains `planRevisionTurn`, `first-party eforge-plan revision sessions`, `application-level pattern`, `ctx.agentTasks`, and unsupported generic chat wording.
- The same test reads `docs/extensions-api.md`, `web/content/docs/extensions-api.md`, and `web/public/docs/extensions-api.md` and asserts each contains `planRevisionTurn` in the `ctx.agentTasks` section and keeps `multi-turn chat` unsupported through the daemon task API.
- The same test reads `web/public/llms-full.txt` and asserts it contains `planRevisionTurn` and `Revise with AI` after docs generation.

### Integration Tests
- Run `pnpm docs:generate` and then `pnpm docs:check` to verify generated public mirrors, reference artifacts, links, and LLM bundle drift.
- Run `pnpm vitest run test/eforge-plan-plan-revision-docs.test.ts test/extension-platform-docs-examples.test.ts test/extension-framebundle-docs-contract.test.ts test/reference-content.test.ts test/docs-gen-determinism.test.ts` to verify new and existing docs contracts.
- Run `pnpm docs:check-parity` to verify Claude/Pi skill parity remains unchanged.
- Inspect `git diff -- eforge-plugin packages/pi-eforge` and confirm there are no changes unless implementation introduced a new host-facing command or skill.

## Verification

- [ ] `eforge/extensions/eforge-plan/README.md` contains `Revise with AI`.
- [ ] `eforge/extensions/eforge-plan/README.md` contains `.eforge/storage/extensions/eforge-plan/plan-revisions/index.json`.
- [ ] `eforge/extensions/eforge-plan/README.md` contains `start-plan-revision-session`.
- [ ] `eforge/extensions/eforge-plan/README.md` contains `list-plan-revision-sessions`.
- [ ] `eforge/extensions/eforge-plan/README.md` contains `get-plan-revision-session`.
- [ ] `eforge/extensions/eforge-plan/README.md` contains `start-plan-revision-turn`.
- [ ] `eforge/extensions/eforge-plan/README.md` contains `retry-plan-revision-turn`.
- [ ] `eforge/extensions/eforge-plan/README.md` contains `cancel-plan-revision-turn`.
- [ ] `eforge/extensions/eforge-plan/README.md` contains `apply-plan-revision-turn`.
- [ ] `eforge/extensions/eforge-plan/README.md` action table row for `apply-plan-revision-turn` contains `local-read`, `local-write`, and no `build-queue` token before the row ends.
- [ ] `eforge/extensions/eforge-plan/README.md` describes answer-only turns.
- [ ] `eforge/extensions/eforge-plan/README.md` describes patch preview.
- [ ] `eforge/extensions/eforge-plan/README.md` describes explicit selected-section apply.
- [ ] `eforge/extensions/eforge-plan/README.md` describes stale fingerprint blocking.
- [ ] `eforge/extensions/eforge-plan/README.md` describes retry and clarification redraft.
- [ ] `eforge/extensions/eforge-plan/README.md` states that handoff remains separate from revision apply.
- [ ] `eforge/extensions/eforge-plan/README.md` preserves unsupported generic daemon-owned chat runtime language.
- [ ] `docs/extensions.md` contains `planRevisionTurn`.
- [ ] `docs/extensions.md` describes first-party eforge-plan revision sessions as an application-level pattern.
- [ ] `docs/extensions.md` preserves unsupported generic chat/runtime language for native extensions.
- [ ] `web/content/docs/extensions.md` contains the same `planRevisionTurn` and application-level pattern wording as the root extension guide.
- [ ] `docs/extensions-api.md` lists `planRevisionTurn` in the `ctx.agentTasks` planning-draft output-section prose.
- [ ] `web/content/docs/extensions-api.md` lists `planRevisionTurn` in the `ctx.agentTasks` planning-draft output-section prose.
- [ ] `web/public/docs/extensions.md` is byte-identical to `web/content/docs/extensions.md`.
- [ ] `web/public/docs/extensions-api.md` is byte-identical to `web/content/docs/extensions-api.md`.
- [ ] `web/public/llms-full.txt` contains `planRevisionTurn`.
- [ ] `web/public/llms-full.txt` contains `Revise with AI`.
- [ ] `test/eforge-plan-plan-revision-docs.test.ts` exists and asserts the README, shared docs, generated mirrors, and LLM bundle snippets listed above.
- [ ] `pnpm docs:generate` exits 0.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm docs:check-parity` exits 0.
- [ ] `pnpm vitest run test/eforge-plan-plan-revision-docs.test.ts test/extension-platform-docs-examples.test.ts test/extension-framebundle-docs-contract.test.ts test/reference-content.test.ts test/docs-gen-determinism.test.ts` exits 0.
- [ ] `git diff --name-only -- eforge-plugin packages/pi-eforge` prints no paths.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` has no version change in the final diff.
- [ ] `packages/pi-eforge/package.json` has no version change in the final diff.
- [ ] Root `pnpm type-check` exits 0.
- [ ] Root `pnpm test` exits 0.
- [ ] Root `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["test-write", ["implement", "doc-author"], "doc-sync", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["docs", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
