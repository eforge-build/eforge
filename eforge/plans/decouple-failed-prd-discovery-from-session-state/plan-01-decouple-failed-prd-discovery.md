---
id: plan-01-decouple-failed-prd-discovery
name: Decouple failed-PRD discovery from session state
branch: decouple-failed-prd-discovery-from-session-state/main
agents:
  builder:
    effort: high
    rationale: Coordinated breaking change across 17 files spanning HTTP routes,
      client helpers, MCP tools (Claude + Pi), CLI, engine signature, event
      payload, monitor UI, slash-command workflows, and tests. Requires careful
      tracking of all setName removal sites without leaving dead references.
  reviewer:
    effort: high
    rationale: API contract change with cross-package implications
      (DAEMON_API_VERSION bump). Reviewer must verify no setName references
      remain on the dropped surfaces and that the kept surfaces (engine.recover,
      /api/recover, eforge_recover) are unchanged.
---

# Decouple failed-PRD discovery from session state

## Architecture Context

Failed PRDs live in a flat, prdId-keyed layout under `eforge/queue/failed/`:

```
eforge/queue/failed/
  <prdId>.md
  <prdId>.recovery.md
  <prdId>.recovery.json
```

There is no `<setName>/` subdirectory. The recovery sidecar JSON itself contains `summary.setName` and `summary.featureBranch` as data fields, so `setName` is recoverable from the sidecar whenever needed.

Despite that, two daemon-facing surfaces today require `setName` as a request parameter and never use it for path construction:

- `GET /api/recovery/sidecar?setName=...&prdId=...` — `setName` is validated as a path segment then never referenced when building `mdPath`/`jsonPath`.
- `POST /api/recover/apply` body `{ setName, prdId }` — `setName` is forwarded to a worker spawn (`apply-recovery <setName> <prdId>`) but the CLI command's only consumer (`engine.applyRecovery(setName, prdId)`) drops it: `helperOptions = { cwd, prdId, queueDir }` — the helpers never see it.

This dead-weight parameter has caused real downstream gating bugs. The monitor UI's `queue-section.tsx` derives `activeSetName` from `runs[0]?.planSet`; when no run exists, the sidecar fetcher early-returns, the `RecoverySidecarSheet` never opens, and the "Re-queue PRD" button is unreachable. The `/eforge:recover` slash command is told to discover failed PRDs via `eforge_status`, which only surfaces the latest run's plans and cannot see flat-layout failed items at all.

This plan removes `setName` from the read-sidecar and apply-recovery surfaces end-to-end, leaves `engine.recover()` and its companions alone (where `setName` is functionally required for the `eforge/<setName>` feature-branch reference), strips the UI's `activeSetName` gating, and routes the slash-command workflow to `eforge_queue_list` (which already exposes failed items via `loadFromDir(.../failed, 'failed')`).

### Discovery design choice

Acceptance Criterion 1 allows two implementations: (a) extend `eforge_status` with a `failedPrds[]` field, or (b) route the slash command to a documented adjacent tool. **This plan chooses (b)**: the slash command (and Pi parity skill) are updated to call `eforge_queue_list` and filter for `status === 'failed'`. Rationale:

- `eforge_queue_list` already proxies `/api/queue`, which already surfaces failed PRDs from `eforge/queue/failed/` (`packages/monitor/src/server.ts:728`).
- Keeps `eforge_status` focused on session state (consistent with the user's `feedback_trust_status_checks` memory entry and `feedback_handheld_skill_workflows` — slash commands branch off available items, they don't drive new aggregation contracts).
- Zero additional API surface to maintain.

## Implementation

### Overview

Remove `setName` from the read-sidecar and apply-recovery contracts everywhere they appear: HTTP request validation and worker-spawn args, client helper signatures and request/response types, MCP tool schemas (Claude Code + Pi), CLI positional args, engine method signature, the `recovery:apply:start` event payload, monitor UI helpers, the `RecoverySidecarSheet` prop surface, and the `queue-section.tsx` `activeSetName` gating + dedup-cache key. Bump `DAEMON_API_VERSION` from 13 → 14. Update both consumer-facing skill files (Claude Code plugin and Pi extension) to discover via `eforge_queue_list` and call the simplified `eforge_read_recovery_sidecar`/`eforge_apply_recovery` with `prdId` only. Update existing tests to match the new contract; add coverage for the no-runs reachability scenario.

### Key Decisions

1. **Choose `eforge_queue_list` over a `failedPrds[]` field on `eforge_status`** — the data is already exposed via `/api/queue`, so the cheapest correct fix is updating the slash command's Step 1, not extending another tool's response shape. Documented in this plan's body and reflected in `recover.md`/`SKILL.md`.
2. **Keep `engine.recover()`, `/api/recover`, CLI `eforge recover`, MCP `eforge_recover` unchanged** — `setName` is functionally required there for `featureBranch: eforge/<setName>` (engine.ts:1892). Out of scope per the PRD.
3. **Drop `setName` from the `recovery:apply:start` event payload** — the event is emitted only by `engine.applyRecovery()`, no consumer reads `setName` from it (display.ts:834-835 only logs the start, no payload access). Cleaner than reading it back from the sidecar and re-emitting.
4. **Worker-spawn argv for `apply-recovery` becomes `[prdId]`** — drop the leading `setName` argv slot; CLI command becomes `eforge apply-recovery <prdId>`.
5. **No backward-compatibility shims** — per `feedback_no_backward_compat`, remove `setName` cleanly. No `setName?: string` optional aliases, no "still accepts but ignores" deprecation modes. The `DAEMON_API_VERSION` bump is the single coordination signal between client and daemon.
6. **Single-plan implementation** — type/interface changes (`ApplyRecoveryRequest`, `ReadSidecarRequest`, the `recovery:apply:start` event variant, the `engine.applyRecovery` signature) cannot be split across plans without breaking consumers between merges. Per the planner rule "never split a type change from the updates to its consumers," this lands atomically.

## Scope

### In Scope

- HTTP routes: drop `setName` validation/usage from `GET /api/recovery/sidecar` and `POST /api/recover/apply` in `packages/monitor/src/server.ts`. Update worker-spawn argv for `apply-recovery` from `[setName, prdId]` to `[prdId]`.
- Client request/response types: drop `setName` from `ReadSidecarRequest` and `ApplyRecoveryRequest` in `packages/client/src/routes.ts`.
- Client API helpers: simplify `apiReadRecoverySidecar` (drop `setName` param) in `packages/client/src/api/recovery-sidecar.ts`. `apiApplyRecovery` already takes `body: ApplyRecoveryRequest`, so updating the request type cascades.
- API version bump: `DAEMON_API_VERSION` 13 → 14 in `packages/client/src/api-version.ts`, with a comment describing the v14 break.
- Claude Code MCP tools: drop `setName` from `eforge_read_recovery_sidecar` and `eforge_apply_recovery` Zod schemas in `packages/eforge/src/cli/mcp-proxy.ts`.
- Pi MCP tools: mirror the same drop in `packages/pi-eforge/extensions/eforge/index.ts`.
- CLI command: `eforge apply-recovery <prdId>` (single positional) in `packages/eforge/src/cli/index.ts`. Forward to `engine.applyRecovery(prdId)`.
- Engine: change `applyRecovery(setName, prdId, ...)` → `applyRecovery(prdId, ...)` in `packages/engine/src/eforge.ts`. Drop `setName` from path-segment validation (only validate `prdId`).
- Engine event: change `recovery:apply:start` payload from `{ prdId, setName }` to `{ prdId }` in `packages/engine/src/events.ts`.
- Monitor UI helpers: drop `setName` from `fetchRecoverySidecar` and `applyRecovery` and `triggerRecover` is **kept as-is** (start-analysis flow keeps setName) in `packages/monitor-ui/src/lib/api.ts`.
- Monitor UI queue section: remove the `activeSetName` `useMemo`, the `prevSetNameRef`/effect that resets the dedup cache on setName change, the `!activeSetName` early-return, and collapse the `${activeSetName}/${item.id}` dedup key to `item.id` in `packages/monitor-ui/src/components/layout/queue-section.tsx`. The `RecoverySidecarSheet` no longer needs the `setName` prop for the apply path; it still needs `setName` for the `triggerRecover` (re-run analysis) path. Either pass the `setName` extracted from the sidecar's `summary.setName` JSON, or keep the prop and source it from the sidecar payload.
- Sidecar sheet: in `packages/monitor-ui/src/components/recovery/sidecar-sheet.tsx`, switch `applyRecovery(setName, prdId)` → `applyRecovery(prdId)`. For the `Re-run analysis` button (which calls `triggerRecover`, an unchanged surface), source `setName` from `sidecar.json.summary.setName` rather than from a prop. The `setName` prop on `RecoverySidecarSheetProps` is removed; the queue-section caller drops the `setName=` JSX attribute.
- Slash-command workflow: update `eforge-plugin/skills/recover/recover.md` Step 1 to call `mcp__eforge__eforge_queue_list` and filter `status === 'failed'`; update Step 2 (`eforge_read_recovery_sidecar`) and Step 5 (`eforge_apply_recovery`) calls to `{ prdId }` only. Step 2's `eforge_recover` re-run path keeps `{ setName, prdId }`; the slash command now sources `setName` from the prior sidecar's `summary.setName` (when re-running on an already-analyzed failure) or asks the user when the sidecar is missing entirely.
- Pi parity: mirror all skill changes in `packages/pi-eforge/skills/eforge-recover/SKILL.md`.
- Tests: update `test/apply-recovery.test.ts` to call `engine.applyRecovery(prdId)` (drop the leading `'test-set'` arg from all 11 invocations). Update `test/daemon-recovery.test.ts` GET /api/recovery/sidecar tests to drop `setName` from query strings and update the "missing query params" test. Add a new test verifying that `serveQueue` returns failed items when no runs exist and the recovery-sidecar GET succeeds with `prdId`-only against a fresh fixture (covers AC #5 reachability proof). Update `packages/monitor-ui/src/components/layout/__tests__/queue-section-recovery.test.tsx` to fixture an empty `runs` array and assert the verdict chip + sheet still render.

### Out of Scope

- `engine.recover(setName, prdId, ...)` signature, the matching CLI command (`eforge recover <setName> <prdId>`), `POST /api/recover` HTTP route, `apiRecover` client helper, `eforge_recover` MCP tool (Claude + Pi), and `triggerRecover` UI helper — `setName` remains functional there.
- `BuildFailureSummary.setName` data field, `RecoveryVerdictSidecar.summary.setName` data field — these are payload contents, not request parameters.
- `CHANGELOG.md` — release flow owns it (`feedback_changelog_managed_by_release`).
- Backward-compatibility shims of any kind.
- Adding a `failedPrds[]` field to `eforge_status` — explicitly chosen against (see Key Decisions #1).

## Files

### Modify

- `packages/client/src/routes.ts` — drop `setName` from `ReadSidecarRequest` (lines 35-38) and `ApplyRecoveryRequest` (lines 78-81). The `setName` field on `RecoverRequest` (line 23-26) is **kept** (start-analysis flow).
- `packages/client/src/api/recovery-sidecar.ts` — simplify `apiReadRecoverySidecar({ cwd, prdId })` (drop `setName` param and the `setName` URLSearchParams entry).
- `packages/client/src/api-version.ts` — bump `DAEMON_API_VERSION` from 13 to 14; update the trailing comment to describe v14: "removed `setName` request param from `GET /api/recovery/sidecar` and `POST /api/recover/apply` (dead-weight parameter — paths are computed from `prdId` alone)."
- `packages/monitor/src/server.ts` — in the `GET /api/recovery/sidecar` handler (lines 1786-1827, in `--- eforge:region plan-03-daemon-mcp-pi ---`): remove the `setName` `URLSearchParams.get`, the `if (!setName || !prdId)` check becomes `if (!prdId)`, drop `isValidPathSegment(setName)` from the validation, drop `setName` from the error message. In the `POST /api/recover/apply` handler (lines 982-1015, in `--- eforge:region plan-01-backend-apply-recovery ---`): drop `setName` from the body type, the missing-field check, the path-segment validation, and the `spawnWorker('apply-recovery', [body.setName, body.prdId])` argv → `[body.prdId]`.
- `packages/eforge/src/cli/mcp-proxy.ts` — drop the `setName` Zod field from the `eforge_read_recovery_sidecar` schema (lines 888-900) and `eforge_apply_recovery` schema (lines 904-917). Update handlers to forward `{ cwd, prdId }` and `{ body: { prdId } }` respectively. **Do not touch** the `eforge_recover` tool (lines 875-886) — `setName` stays.
- `packages/eforge/src/cli/index.ts` — change the `apply-recovery` command (lines 811-848, in `--- eforge:region plan-01-backend-apply-recovery ---`) from `<setName> <prdId>` positionals to `<prdId>` only. Drop the `setName` parameter from the action callback and from the `engine.applyRecovery(setName, prdId)` call. The `eforge recover <setName> <prdId>` command (separate, earlier in the file) is **unchanged**.
- `packages/engine/src/eforge.ts` — change `applyRecovery(setName, prdId, _options?)` (lines 2097-2202) to `applyRecovery(prdId, _options?)`. Remove the `setName` from the path-segment guard (lines 2104-2116). Update the `recovery:apply:start` yield (lines 2123-2128) to drop the `setName` field.
- `packages/engine/src/events.ts` — change the `recovery:apply:start` event variant (line 312) from `{ type: 'recovery:apply:start'; prdId: string; setName: string }` to `{ type: 'recovery:apply:start'; prdId: string }`. The `recovery:start` event (line 306) is **unchanged**.
- `packages/pi-eforge/extensions/eforge/index.ts` — drop the `setName` field from the `eforge_read_recovery_sidecar` (lines 1456-1478) and `eforge_apply_recovery` (lines 1485-1507) `Type.Object({ ... })` parameter schemas. Update the `daemonRequest` calls to pass `prdId`-only query/body. **Do not touch** the `eforge_recover` tool definition or `eforge_status` tool definition.
- `packages/monitor-ui/src/lib/api.ts` — change `fetchRecoverySidecar(setName, prdId)` to `fetchRecoverySidecar(prdId)` (drop the `setName` URLSearchParams entry). Change `applyRecovery(setName, prdId)` to `applyRecovery(prdId)` (drop `setName` from the JSON body). The `triggerRecover(setName, prdId)` helper is **unchanged**.
- `packages/monitor-ui/src/components/layout/queue-section.tsx` — remove the `activeSetName` `useMemo` (lines 109-115), the `prevSetNameRef` + reset effect (lines 119-125), the `!activeSetName` early-return inside the fetch effect (line 130). Change the dedup-cache key from `${activeSetName}/${item.id}` to `item.id`. Change `fetchRecoverySidecar(activeSetName, item.id)` to `fetchRecoverySidecar(item.id)`. The recovery-pending block's "Re-run analysis" button: source `setName` from the sidecar fetch result if available, else hide the button (the start-analysis flow legitimately requires `setName`, but for a never-analyzed failure the user has no in-UI path to start it; that's a known limitation already documented in `recover.md` Step 2 — the slash command handles it conversationally). Drop the `setName=` prop from the `<RecoverySidecarSheet>` JSX usage. Remove the unused `RunInfo` import and the `runs` `useApi` call once `activeSetName` is gone.
- `packages/monitor-ui/src/components/recovery/sidecar-sheet.tsx` — remove the `setName` prop from `RecoverySidecarSheetProps`. Switch `applyRecovery(setName, prdId)` to `applyRecovery(prdId)`. For the `Re-run analysis` button's `triggerRecover` call, extract `setName` from `sidecar.json.summary.setName` (the data field is always present on a valid sidecar). Type-narrow safely (the sidecar JSON is typed as `RecoveryVerdictSidecar` in `routes.ts` with `summary.setName: string`).
- `eforge-plugin/skills/recover/recover.md` — Step 1: replace "Call `mcp__eforge__eforge_status` to discover failed PRDs" with "Call `mcp__eforge__eforge_queue_list` and filter the response for items where `status === 'failed'`". Step 2: change `mcp__eforge__eforge_read_recovery_sidecar` call signature from `{ setName, prdId }` to `{ prdId }`. Step 2 fallback: when offering to run analysis, source `setName` from a prior sidecar's `summary.setName` if available, otherwise prompt the user for it (the underlying `eforge_recover` tool still requires it). Step 5: change `mcp__eforge__eforge_apply_recovery` call signature from `{ setName, prdId }` to `{ prdId }`. Update the workflow narrative paragraph at the top to reference `eforge_queue_list` instead of `eforge_status`.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` — mirror every change made to `recover.md` above, using the Pi tool naming convention (`eforge_queue_list`, `eforge_read_recovery_sidecar`, `eforge_apply_recovery`, `eforge_recover`).
- `test/apply-recovery.test.ts` — drop the leading `'test-set'` argument from every `engine.applyRecovery(...)` call (lines 157, 194, 217, 277, 309, 329, 375, 423, 476, 486 — 10 sites). The seeded sidecar JSON's `summary.setName: 'test-set'` data field is **kept** (it's payload, not parameter). Update any assertion that pattern-matches the `recovery:apply:start` event to drop `setName`.
- `test/daemon-recovery.test.ts` — in the `describe('GET /api/recovery/sidecar', ...)` block (lines 195-235): change the request URLs from `?setName=...&prdId=...` to `?prdId=...`, change the "returns 400 when query params are missing" test to send `?` (no params) and assert 400 with a message naming `prdId`. **Do not touch** the `describe('POST /api/recover', ...)` block (lines 150-189) — that exercises the start-analysis flow which keeps `setName`.
- `packages/monitor-ui/src/components/layout/__tests__/queue-section-recovery.test.tsx` — adjust fixture so `runs` is empty (or absent); assert the verdict chip and sheet still render based on the queue item alone. Update any `fetchRecoverySidecar` mock signature to receive `prdId` only.

### Create

- (No new source files.) New tests are added inside the existing files above.

## Verification

- [ ] `pnpm type-check` passes with no errors across all workspace packages.
- [ ] `pnpm test` passes including all updated `apply-recovery.test.ts`, `daemon-recovery.test.ts`, and `queue-section-recovery.test.tsx` cases.
- [ ] `pnpm build` produces dist artifacts for every workspace package without TypeScript errors.
- [ ] `node scripts/check-skill-parity.mjs` reports parity between `eforge-plugin/skills/recover/recover.md` and `packages/pi-eforge/skills/eforge-recover/SKILL.md`.
- [ ] `grep -rn "setName" packages/client/src/api/recovery-sidecar.ts packages/client/src/api/apply-recovery.ts` returns zero matches.
- [ ] In `packages/eforge/src/cli/mcp-proxy.ts`, the `eforge_read_recovery_sidecar` and `eforge_apply_recovery` Zod schemas contain only `prdId` (no `setName` field), verified by reading the file.
- [ ] In `packages/pi-eforge/extensions/eforge/index.ts`, the `eforge_read_recovery_sidecar` and `eforge_apply_recovery` `Type.Object` schemas contain only `prdId`, verified by reading the file.
- [ ] The `eforge_recover` tool (Claude MCP) and `eforge_recover` tool (Pi MCP) still declare both `setName` and `prdId` parameters, verified by reading both files.
- [ ] `engine.applyRecovery` exported signature is `applyRecovery(prdId: string, _options?: ApplyRecoveryOptions)` — verified by reading `packages/engine/src/eforge.ts`.
- [ ] `engine.recover` exported signature still includes `setName` as the first positional — verified by reading `packages/engine/src/eforge.ts`.
- [ ] `DAEMON_API_VERSION === 14` in `packages/client/src/api-version.ts`, with a v14 explanatory comment.
- [ ] In `packages/monitor-ui/src/components/layout/queue-section.tsx`: the strings `activeSetName`, `prevSetNameRef`, and `RunInfo` no longer appear; the dedup-cache `add`/`has` calls use `item.id` directly.
- [ ] `eforge-plugin/skills/recover/recover.md` Step 1 references `eforge_queue_list` and not `eforge_status`; Step 2 and Step 5 example call signatures use `{ prdId }` (not `{ setName, prdId }`).
- [ ] `packages/pi-eforge/skills/eforge-recover/SKILL.md` mirrors the same Step 1/2/5 wording (allowing the parity-skip blocks to differ).
- [ ] Reachability proof (covered by automated test): with a fresh fixture containing a failed PRD in `eforge/queue/failed/<prdId>.{md,recovery.md,recovery.json}` and an empty `runs` array, the daemon's `GET /api/recovery/sidecar?prdId=<prdId>` returns 200 with the parsed sidecar payload, and the queue-section UI test renders the verdict chip + sheet without an `activeSetName`.
