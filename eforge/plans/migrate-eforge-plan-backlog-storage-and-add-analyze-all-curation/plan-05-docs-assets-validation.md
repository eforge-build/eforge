---
id: plan-05-docs-assets-validation
name: README contract updates, generated workstation assets, drift guards, and
  final validation alignment.
branch: migrate-eforge-plan-backlog-storage-and-add-analyze-all-curation/docs-assets-validation
---

# Docs Assets Validation

## Architecture Reference

This module implements the `docs-assets-validation` module from the architecture, including the **Storage model**, **Apply contract**, **Integration contracts**, and final **Validation commands** sections.

Key constraints from architecture:
- `eforge/extensions/eforge-plan/README.md` is owned by this module; dependent modules leave user-facing storage and curation documentation for this final pass.
- Backlog item and epic documentation must name private extension storage as canonical and legacy `.backlog/items` / `.backlog/epics` as read-through compatibility input plus explicit import input.
- README contract tests must stop treating `.backlog/items` and `.backlog/epics` as canonical storage.
- The manual analyze-all flow must be documented as a daemon-owned read-only planning task, a read-only preview, and an explicit two-step apply handled by trusted extension actions.
- Documentation must state that curation does not enqueue builds and does not mark items shipped without durable evidence.
- Recommendation freshness documentation must describe post-curation freshness computation and keep `.backlog/recommendations.json` documented as unsupported legacy recommendation storage.
- Workstation assets are generated from `workstation-src/plans`; this module runs the asset build after the UI module has changed source and uses bundle/source tests to catch drift.

## Scope

### In Scope

- Update `eforge/extensions/eforge-plan/README.md` for private backlog storage, legacy compatibility, explicit import, analyze-all curation, task monitor behavior, preview/apply confirmation, recommendation freshness after curation, and curation non-goals.
- Update README contract tests so they assert private item/epic storage, legacy read-through/import semantics, analyze-all curation documentation, and no canonical `.backlog/items` / `.backlog/epics` claims.
- Run `pnpm build:eforge-plan-workstation` after `workstation-curation-ui` source changes land.
- Use existing workstation source/bundle tests to verify analyze-all action strings, curation preview strings, confirmation flags, bridge-only action invocation, no raw network calls, and no private storage path leakage.
- Run final targeted and repository validation gates for docs, generated assets, type checks, tests, and maintainability.
- Audit post-dependency docs/tests for remaining canonical `.backlog/items` or `.backlog/epics` assertions and update only tests owned by this module or unassigned drift tests.

### Out of Scope

- Implementing private backlog storage helpers, legacy import helpers, or storage tests owned by `storage-foundation`.
- Implementing the `backlogCurationDraft` client/engine task wire contract owned by `planning-task-contract`.
- Implementing analyze-all actions, curation source/apply helpers, planning workflow purpose support, or recommendation freshness mutations owned by `curation-workflow`.
- Changing workstation React source, mock data, bridge code, or curation preview tests owned by `workstation-curation-ui`.
- Changing core Console Plans packages, daemon routes, scheduling, stale-triggered automation, unattended apply, build enqueueing, queue orchestration, or plan-set generation from recommendations.
- Deleting legacy `.backlog` files or documenting automatic deletion.

## Implementation Approach

### Overview

Treat this as the final synchronization pass after all dependency modules have merged. First audit the settled code and tests for storage-path and curation wording drift. Then update the README to describe the behavior now implemented by the storage, planning-task, curation, and workstation modules. Next update README contract tests with explicit string/regex assertions for the new storage and analyze-all contracts. Finally run the workstation asset build and validation commands so source, ignored/generated bundle output, tests, and docs are aligned.

Use these audit commands during implementation:

```bash
rg -n "\.backlog/(items|epics)|backlog/items|backlog/epics|canonical|Analyze all backlog|analyze-all-backlog|backlog-curation|backlogCurationDraft" \
  eforge/extensions/eforge-plan packages test web \
  --glob '!node_modules/**' --glob '!dist/**' --glob '!eforge/extensions/eforge-plan/workstation-assets/**'

rg -n "stores backlog items|stores epics|canonical.*\.backlog|\.backlog.*canonical" \
  eforge/extensions/eforge-plan packages test web \
  --glob '!node_modules/**' --glob '!dist/**'
```

The current repository ignores `eforge/extensions/eforge-plan/workstation-assets/` in `.gitignore`. The implementation must still run `pnpm build:eforge-plan-workstation`; if the directory remains ignored and untracked, leave generated files uncommitted and rely on `workstation-assets.test.ts` to build/read them during validation. If a dependency module changes the repository to track generated assets, include only the generated `workstation-assets/plans/*` diffs produced by the build.

### Key Decisions

1. **Keep documentation action IDs exact.** Use the settled action IDs from dependency modules: `import-legacy-backlog`, `analyze-all-backlog`, and `apply-planning-agent-task-result` with `applyBacklogCurationDraft`. This makes README contract tests a drift gate for host integrations.
2. **Document compatibility without calling legacy storage canonical.** The README may mention `.backlog/items/<id>.md` and `.backlog/epics/<id>.md` only as legacy compatibility/import inputs. Private storage paths are the only documented canonical write targets.
3. **Keep recommendation storage wording unchanged except for post-curation freshness.** `.backlog/recommendations.json` remains unsupported; curation may write only the private recommendation model when the validated result includes recommendations.
4. **Use targeted README contract assertions instead of snapshot tests.** String and regex assertions make the required contracts observable without locking the entire README wording.
5. **Use the existing workstation bundle guard test as the asset drift gate.** `workstation-curation-ui` owns source/bundle guard assertions in `workstation-assets.test.ts`; this module runs that test after rebuilding assets rather than adding overlapping assertions.

## Files

### Create

- None.

### Modify

- `eforge/extensions/eforge-plan/README.md` — update storage, usage, action table, promotion/input-source wording, workstation description, and planner boundary documentation `[region: docs-assets-validation, storage model, usage/action table, promotion/input-source, workstation, and planning boundary sections]`.
  - In **Usage**, add examples for `import-legacy-backlog`, `analyze-all-backlog`, and curation apply via `apply-planning-agent-task-result`:

    ```json
    { "taskId": "task_123", "applyBacklogCurationDraft": { "previewAcknowledged": true, "confirmApply": true } }
    ```

  - In **Storage model**, replace `.backlog/items/<id>.md` and `.backlog/epics/<id>.md` as storage bullets with:
    - `.eforge/storage/extensions/eforge-plan/backlog/items/<id>.md` stores canonical backlog items.
    - `.eforge/storage/extensions/eforge-plan/backlog/epics/<id>.md` stores canonical epics.
    - `.backlog/items/<id>.md` and `.backlog/epics/<id>.md` are legacy read-through/import inputs.
  - State that private records override same-ID legacy records, writes target private storage only, and legacy files are not deleted or rewritten by default.
  - Document `import-legacy-backlog` as a copy/import operation that skips IDs already present in private storage and leaves legacy files in place.
  - Keep the existing Markdown/frontmatter schema description and add that safe-id/path containment checks still apply to private and legacy reads.
  - Update recommendation freshness text so curation with recommendations writes the private recommendation model and records freshness after private backlog writes against the post-apply fingerprint.
  - State that validation/reference/precondition failures leave the previous recommendation model unchanged.
  - Add an analyze-all curation section or subsection under **Workstation UI development** / **Planning workstation boundary** describing:
    - `analyze-all-backlog` starts or reuses a `backlog-curation` daemon-owned planning task for the current source fingerprint.
    - The task requests `backlogCurationDraft` plus recommendations and remains read-only until apply.
    - The Plan with AI monitor labels curation tasks and supports retry, redraft, cancel, remove, and apply.
    - Completed curation tasks preview item changes, epic changes, no-op rechecks, skipped cases, needs-input cases, and generated recommendations.
    - Apply requires two in-app confirmation steps and calls the extension action with both confirmation flags.
    - Analyze-all and curation apply do not enqueue builds, submit session plans, or mark records shipped without durable evidence.
    - Scheduling, stale-triggered execution, unattended mutation, backlog draining, and queue orchestration remain non-goals.
  - Update **Actions** table rows for `capture-item`, `upsert-epic`, `update-item`, `promote-item`, and `promote-selection` so they reference visible eforge-plan backlog records and private item/epic writes rather than `.backlog` writes.
  - Add rows for `import-legacy-backlog` and `analyze-all-backlog` with side effects from the implemented action registration.
  - Update the **Promotion flow** Mermaid diagram so source nodes refer to visible private/compatible backlog records instead of direct `.backlog` nodes.
  - Update **Input-source URI** wording so the adapter reads visible eforge-plan backlog records from the migrated storage helpers rather than resolving `.backlog` as canonical.
  - Keep the existing statement that legacy `.backlog/recommendations.json` import/export is unsupported.

- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — extend contract tests for storage and curation documentation.
  - Add assertions that the README contains the private item and epic paths:
    - `.eforge/storage/extensions/eforge-plan/backlog/items/<id>.md`
    - `.eforge/storage/extensions/eforge-plan/backlog/epics/<id>.md`
  - Add assertions that README text identifies `.backlog/items/<id>.md` and `.backlog/epics/<id>.md` as legacy/read-through/import inputs.
  - Add regex guards that fail if `.backlog/items` or `.backlog/epics` appear in the same sentence as canonical storage/write wording such as `stores backlog items`, `stores epics`, `canonical`, or `writes target`.
  - Add assertions for private precedence, private-only writes, no automatic legacy deletion/rewrite, and explicit import skip behavior.
  - Add assertions for `import-legacy-backlog`, `analyze-all-backlog`, `backlog-curation`, `backlogCurationDraft`, `applyBacklogCurationDraft`, `previewAcknowledged`, and `confirmApply`.
  - Add assertions that analyze-all documentation contains `daemon-owned`, `read-only`, `preview`, `retry`, `redraft`, `cancel`, `remove`, and `apply`.
  - Add assertions that README text says curation does not enqueue builds and does not mark items shipped without durable evidence.
  - Add assertions that recommendation freshness after curation references post-apply/post-curation fingerprint behavior and `apply-backlog-curation-draft` when that string is present in the implemented status sidecar.
  - Keep existing assertions for private recommendation storage, lifecycle freshness, planner boundaries, multi-turn chat non-goal, unattended enqueueing non-goal, queue orchestration non-goal, and unsupported legacy `.backlog/recommendations.json` import/export.

- `eforge/extensions/eforge-plan/workstation-assets/plans/*` — regenerate with `pnpm build:eforge-plan-workstation` after UI source changes settle.
  - Current `.gitignore` excludes `eforge/extensions/eforge-plan/workstation-assets/`; if no tracked generated files exist, this is a validation artifact rather than a committed diff.
  - If generated assets become tracked in the settled repository, include the generated `index.js`, `index.html`, `style.css`, and any other Vite output files exactly as emitted by the build command.

### Do Not Modify

- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — owned by `workstation-curation-ui` in the shared file registry. This module runs the test after rebuilding assets.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/**` — owned by `workstation-curation-ui`.
- `eforge/extensions/eforge-plan/index.ts`, `eforge/extensions/eforge-plan/markdown-store.ts`, and curation implementation modules — owned by dependency modules.
- `packages/client/src/extension-agent-tasks.ts`, engine planning task code, and daemon task service code — owned by `planning-task-contract`.
- `.gitignore` — leave the current generated-asset ignore policy unchanged unless the settled dependency implementation already changed asset tracking.

## Testing Strategy

### Unit Tests

- README contract tests assert private item/epic storage paths, legacy compatibility/import wording, private precedence, private-only writes, no automatic legacy deletion, unsupported legacy recommendation storage, analyze-all curation action names, two confirmation flags, no build enqueueing, no shipped-without-evidence rule, and post-curation recommendation freshness.
- README contract tests include negative regex guards for canonical `.backlog/items` or `.backlog/epics` wording.

### Integration Tests

- `pnpm build:eforge-plan-workstation` generates the workstation bundle from final source.
- `pnpm test -- eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` reads the generated bundle and source files to verify bridge-only action invocation, curation strings, confirmation flags, no raw `fetch`, no `XMLHttpRequest`, no private Console imports, and no `.eforge/storage/extensions` literal in browser assets.
- `pnpm test -- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` verifies the updated README contract.

### Regression Tests

- `pnpm --filter @eforge-build/eforge-plan-workstation test` and `pnpm --filter @eforge-build/eforge-plan-workstation type-check` verify final workstation source after dependent UI changes.
- `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check` run after docs/assets changes to catch repository-wide drift.

### Targeted Commands

```bash
pnpm build:eforge-plan-workstation
pnpm test -- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts
pnpm --filter @eforge-build/eforge-plan-workstation test
pnpm --filter @eforge-build/eforge-plan-workstation type-check
pnpm type-check
pnpm test
pnpm maintainability:check
```

## Verification

- [ ] `eforge/extensions/eforge-plan/README.md` contains `.eforge/storage/extensions/eforge-plan/backlog/items/<id>.md`.
- [ ] `eforge/extensions/eforge-plan/README.md` contains `.eforge/storage/extensions/eforge-plan/backlog/epics/<id>.md`.
- [ ] README text identifies `.backlog/items/<id>.md` as legacy compatibility input or import input.
- [ ] README text identifies `.backlog/epics/<id>.md` as legacy compatibility input or import input.
- [ ] README text contains no sentence matching `\.backlog/items[^.]*canonical` or `canonical[^.]*\.backlog/items`.
- [ ] README text contains no sentence matching `\.backlog/epics[^.]*canonical` or `canonical[^.]*\.backlog/epics`.
- [ ] README text contains no sentence matching `\.backlog/items[^.]*stores backlog items`.
- [ ] README text contains no sentence matching `\.backlog/epics[^.]*stores epics`.
- [ ] README text states that private records override same-ID legacy records.
- [ ] README text states that backlog item and epic writes target private storage.
- [ ] README text states that legacy item and epic files are not deleted or rewritten by default.
- [ ] README text documents `import-legacy-backlog`.
- [ ] README text states that compatibility import skips IDs with existing private records.
- [ ] README text keeps legacy `.backlog/recommendations.json` import/export documented as unsupported.
- [ ] README text documents `analyze-all-backlog`.
- [ ] README text documents `backlog-curation` task purpose or label.
- [ ] README text documents `backlogCurationDraft`.
- [ ] README text documents `applyBacklogCurationDraft`.
- [ ] README text documents `previewAcknowledged` and `confirmApply`.
- [ ] README text states that analyze-all starts or reuses a daemon-owned read-only planning task.
- [ ] README text states that completed curation tasks render a preview before mutation.
- [ ] README text lists item changes, epic changes, no-op rechecks, skipped cases, needs-input cases, and generated recommendations as preview categories.
- [ ] README text states that curation apply uses two in-app confirmation steps.
- [ ] README text states that curation does not enqueue builds.
- [ ] README text states that curation does not mark items shipped without durable evidence.
- [ ] README text states that recommendation freshness after curation uses the post-apply or post-curation backlog fingerprint.
- [ ] README action table contains rows for `import-legacy-backlog` and `analyze-all-backlog`.
- [ ] README action table row for `handoff-session-plan` remains the only eforge-plan action row that documents `build-queue` side effects.
- [ ] `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` asserts private item and epic storage paths.
- [ ] `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` asserts legacy item and epic compatibility/import wording.
- [ ] `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` rejects canonical `.backlog/items` and `.backlog/epics` wording.
- [ ] `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` asserts analyze-all action, curation preview/apply, no build enqueueing, no shipped-without-evidence, and post-curation freshness documentation.
- [ ] `pnpm build:eforge-plan-workstation` exits 0.
- [ ] After `pnpm build:eforge-plan-workstation`, `eforge/extensions/eforge-plan/workstation-assets/plans/index.js` exists on disk.
- [ ] If workstation assets are tracked in the settled repository, the committed generated files match `pnpm build:eforge-plan-workstation` output byte-for-byte.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation test` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation type-check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": [["implement", "doc-author"], "doc-sync", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["docs", "verify"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
