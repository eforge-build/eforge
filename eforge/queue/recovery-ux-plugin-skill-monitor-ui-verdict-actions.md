---
title: Recovery UX: Plugin Skill + Monitor UI Verdict Actions
created: 2026-04-28
---

# Recovery UX: Plugin Skill + Monitor UI Verdict Actions

## Problem / Motivation

The recent "inline atomic recovery sidecar" work (commits `5ca8913`, `2dbbd08`, `5ceaae0`) gave eforge a forensic recovery layer: when a build fails, the engine atomically moves the PRD to `eforge/queue/failed/`, runs a read-only recovery analyst, and commits two sidecar files alongside the failed PRD in a single commit:

- `<prdId>.recovery.md` — human-readable report
- `<prdId>.recovery.json` — machine verdict (`retry | split | abandon | manual` + confidence, rationale, completed/remaining work, optional `suggestedSuccessorPrd` when verdict is `split`, `partial` flag, `recoveryError`)

The plumbing exists end-to-end in the engine, daemon, MCP tools, and CLI, but the user-facing surface stops at "view the report":

- **Plugin**: no recovery skill or slash command in `eforge-plugin/.claude-plugin/plugin.json` (9 skills registered, none for recovery). Only low-level MCP tools `eforge_recover` / `eforge_read_recovery_sidecar` are exposed.
- **Monitor UI**: failed rows already show a `RecoveryVerdictChip` and a "view report" sheet, but there is no control to **enact** the verdict (re-queue for `retry`, write successor for `split`, archive for `abandon`).

This work adds the missing "view verdict, then choose to apply it" loop in both surfaces.

## Goal

Close the recovery UX loop by enabling users to view a failure verdict and then enact it — through a `/recover` skill in both the Claude Code plugin and the Pi extension, and through verdict-specific action buttons inside the monitor UI's existing recovery sheet.

## Approach

### Decisions made

- **UI flow is view-then-act.** No one-click "Recover" button on the row. Action buttons live inside the existing report sheet, so the user always sees the verdict details before committing to an action.
- **Skill ships directly in the plugin** at `eforge-plugin/skills/recover/`, with a `plugin.json` version bump from `0.12.0` to `0.13.0`.
- **`retry` removes sidecars** when re-queueing — the original commit history preserves the audit trail, the working tree stays clean.
- **Both surfaces in one PR.**

### What exists today (verified)

**Engine + daemon:**

- `EforgeEngine.recover(setName, prdId, options)` — `packages/engine/src/eforge.ts:1796` — async generator, runs analyst, writes sidecars
- `writeRecoverySidecar()` — `packages/engine/src/recovery/sidecar.ts:26`
- `moveAndCommitFailedWithSidecar()` — `packages/engine/src/prd-queue.ts:325` — inline atomic move + sidecar + single commit on build failure
- `recoveryVerdictSchema` — `packages/engine/src/schemas.ts:147`
- Daemon (`packages/monitor/src/server.ts`):
  - `POST /api/recover` (line 895) — spawns recovery worker
  - `GET /api/recovery/sidecar` (line 1269) — returns `{ markdown, json }` or 404
- Client routes (`packages/client/src/routes.ts`) and `apiRecover` / `apiReadRecoverySidecar` typed helpers exist
- `forgeCommit()` from `packages/engine/src/git.ts` — required for all engine commits per AGENTS.md

**MCP / Pi / CLI:**

- `eforge_recover`, `eforge_read_recovery_sidecar` in `packages/eforge/src/cli/mcp-proxy.ts:855, 869`
- Pi mirrors in `packages/pi-eforge/extensions/eforge/index.ts:1297, 1324`
- CLI: `eforge recover <setName> <prdId>` in `packages/eforge/src/cli/index.ts:741`

**Monitor UI:**

- `packages/monitor-ui/src/components/layout/queue-section.tsx:178-225` — failed-row rendering, verdict chip, "recovery pending" text, `RecoverySidecarSheet`
- `packages/monitor-ui/src/lib/api.ts:116` — `fetchRecoverySidecar()` (no `triggerRecover` / `applyRecovery` helpers yet)
- `RecoverySidecarSheet` component (find in `packages/monitor-ui/src/components/`) — currently read-only

### Proposed changes

#### 1. Engine: new `applyRecovery()` method

In `packages/engine/src/eforge.ts`, add `applyRecovery(setName: string, prdId: string, options?: ApplyRecoveryOptions)` that reads the sidecar, dispatches by verdict, and produces a single `forgeCommit` per action. Async generator emitting `EforgeEvent`s for parity with `recover()`.

Verdict dispatch:

- **`retry`**: `git mv eforge/queue/failed/<prdId>.md eforge/queue/<prdId>.md`, `git rm eforge/queue/failed/<prdId>.recovery.md eforge/queue/failed/<prdId>.recovery.json`, single `forgeCommit("recover(<prdId>): requeue per recovery verdict")`. Auto-build picks it up on next tick — does not call `enqueue()`.
- **`split`**: write `verdict.suggestedSuccessorPrd` to `eforge/queue/<successor-prdId>.md` (id derived from verdict or generated; document the rule). Leave the failed PRD + sidecars in place as audit. `git add` the new PRD, single `forgeCommit("recover(<prdId>): enqueue successor <successor-prdId>")`. Returns `{ successorPrdId }`.
- **`abandon`**: `git rm` the PRD + both sidecars from `failed/`, single `forgeCommit("recover(<prdId>): abandon per recovery verdict")`.
- **`manual`**: no-op; emits an event telling the caller to read the report.

Errors: if verdict is `split` but `suggestedSuccessorPrd` is missing, fail loudly. If sidecar is absent, fail with a clear message pointing at `recover()`.

Add a Zod-validated `applyRecoveryOptions` and a typed result. Keep the path-segment validation that `recover()` uses (`packages/engine/src/eforge.ts:1813` area).

#### 2. Daemon route + shared client + MCP/Pi parity

- `packages/client/src/routes.ts`: add `applyRecovery` to `API_ROUTES`, add `ApplyRecoveryRequest` / `ApplyRecoveryResponse` types
- `packages/client/src/api/`: add `apiApplyRecovery()` typed helper next to `apiRecover`
- `packages/monitor/src/server.ts`: add `POST /api/recover/apply` handler — body `{ setName, prdId }`, spawns a worker (or runs inline via engine method depending on existing `recover` route's pattern; mirror it)
- `packages/eforge/src/cli/mcp-proxy.ts`: add `eforge_apply_recovery` MCP tool calling `apiApplyRecovery()`
- `packages/pi-eforge/extensions/eforge/index.ts`: mirror the new tool for Pi parity (per AGENTS.md "always check both directories")
- No `DAEMON_API_VERSION` bump — additive change

#### 3. Plugin skill (Claude Code) AND Pi skill — parity required

Per AGENTS.md: "Always check both directories before considering a consumer-facing change complete." Pi has parallel skills at `packages/pi-eforge/skills/eforge-<name>/SKILL.md` (verified: `eforge-build`, `eforge-config`, `eforge-init`, `eforge-plan`, `eforge-profile`, `eforge-profile-new`, `eforge-restart`, `eforge-status`, `eforge-update` — no recovery skill in either today).

**Claude Code plugin:**
- Add `eforge-plugin/skills/recover/recover.md`
- Register in `eforge-plugin/.claude-plugin/plugin.json` → `commands` array
- Bump plugin version `0.12.0` → `0.13.0`

**Pi extension:**
- Add `packages/pi-eforge/skills/eforge-recover/SKILL.md` (mirror content; Pi auto-discovers from the skills/ tree — no manifest edit, per the existing pattern)
- Do **not** bump `packages/pi-eforge/package.json` version (per AGENTS.md: "It will be versioned with the npm package at publish time")
- Update `packages/pi-eforge/README.md` if it lists skills (verify and align)

Skill behavior (identical for both — they are conversational wrappers around the same MCP tools):

`/recover` slash command (or `/eforge-recover` in Pi):

1. Optional args `<setName> <prdId>`. If absent, call `eforge_status` to list failed PRDs and ask the user to pick.
2. Call `eforge_read_recovery_sidecar`. If 404 or `recoveryError`: offer to run `eforge_recover` to (re)generate the verdict, then loop.
3. Render the verdict + rationale + completed/remaining work. For `split`, show a preview of `suggestedSuccessorPrd`.
4. Ask the user to confirm the verdict-specific action (retry / enqueue successor / abandon / manual). Honor existing memory: never auto-apply, always confirm.
5. On confirm, call `eforge_apply_recovery`.
6. On `manual`, render the markdown and stop.

The skill uses MCP tools only — does not touch the filesystem or git directly. All mutation happens in the engine via `applyRecovery()`.

#### 4. Monitor UI: action buttons inside the sheet

The user wants to see the verdict before deciding to recover, so action controls live inside the existing `RecoverySidecarSheet`, not on the row.

- `packages/monitor-ui/src/lib/api.ts`: add `triggerRecover(setName, prdId)` (POST `API_ROUTES.recover`) and `applyRecovery(setName, prdId)` (POST `API_ROUTES.applyRecovery`) helpers, mirroring the cancel-session pattern.
- `RecoverySidecarSheet`: add a footer with verdict-specific buttons:
  - `retry` → "Re-queue PRD" (destructive variant — removes sidecars)
  - `split` → "Enqueue successor PRD"
  - `abandon` → "Archive failed PRD" (destructive)
  - `manual` → no action button; show a hint to act in chat via `/recover`
  - All variants also show a "Re-run analysis" secondary button
- `queue-section.tsx`: when `isRecoveryPending` (no sidecar yet), show a small "Run analysis" icon-button next to the "recovery pending" text — calls `triggerRecover()`. The 5s polling already in place will pick up the new sidecar.

### Critical files

| File | Change |
|------|--------|
| `packages/engine/src/eforge.ts` | new `applyRecovery()` async generator |
| `packages/engine/src/recovery/apply.ts` | **new** — verdict dispatch helpers (keep `eforge.ts` thin) |
| `packages/client/src/routes.ts` | add `applyRecovery` route + request/response types |
| `packages/client/src/api/recovery.ts` (or wherever `apiRecover` lives) | add `apiApplyRecovery` |
| `packages/monitor/src/server.ts` | new `POST /api/recover/apply` handler |
| `packages/eforge/src/cli/mcp-proxy.ts` | new `eforge_apply_recovery` MCP tool |
| `packages/pi-eforge/extensions/eforge/index.ts` | mirror Pi tool for parity |
| `eforge-plugin/skills/recover/recover.md` | **new** — Claude Code plugin skill |
| `eforge-plugin/.claude-plugin/plugin.json` | register skill, version `0.12.0` → `0.13.0` |
| `packages/pi-eforge/skills/eforge-recover/SKILL.md` | **new** — Pi extension skill (parity) |
| `packages/pi-eforge/README.md` | update if it lists skills (verify) |
| `packages/monitor-ui/src/lib/api.ts` | add `triggerRecover`, `applyRecovery` helpers |
| `packages/monitor-ui/src/components/layout/queue-section.tsx` | add "Run analysis" icon-button when `isRecoveryPending` |
| `packages/monitor-ui/src/components/.../RecoverySidecarSheet.tsx` | add verdict-specific footer buttons |
| Tests in `test/` | engine `applyRecovery` dispatch coverage (no harness/git mocks per AGENTS.md) |

Reuse, do not reimplement: `forgeCommit()` (`packages/engine/src/git.ts`), `recoveryVerdictSchema` (`packages/engine/src/schemas.ts:147`), `writeRecoverySidecar()` (already used by `recover()`), `apiRecover` / `apiReadRecoverySidecar`.

## Scope

### In scope

- New engine `applyRecovery()` async generator method with verdict dispatch (`retry` / `split` / `abandon` / `manual`), Zod-validated options, typed result, and path-segment validation.
- New `packages/engine/src/recovery/apply.ts` module housing verdict dispatch helpers.
- New daemon route `POST /api/recover/apply` with mirrored validation pattern of `/api/recover`.
- New `applyRecovery` route entry, `ApplyRecoveryRequest` / `ApplyRecoveryResponse` types, and `apiApplyRecovery()` typed helper in `@eforge-build/client`.
- New `eforge_apply_recovery` MCP tool in both `packages/eforge/src/cli/mcp-proxy.ts` and `packages/pi-eforge/extensions/eforge/index.ts`.
- New Claude Code plugin skill at `eforge-plugin/skills/recover/recover.md`, registered in `plugin.json`, with plugin version bump `0.12.0` → `0.13.0`.
- New Pi extension skill at `packages/pi-eforge/skills/eforge-recover/SKILL.md` (auto-discovered, no manifest edit).
- Update `packages/pi-eforge/README.md` if it lists skills.
- Monitor UI: `triggerRecover()` and `applyRecovery()` helpers in `packages/monitor-ui/src/lib/api.ts`; verdict-specific action buttons inside `RecoverySidecarSheet`; "Run analysis" icon-button on `isRecoveryPending` rows in `queue-section.tsx`.
- Engine tests for `applyRecovery` dispatch coverage (no harness/git mocks per AGENTS.md).

### Out of scope

- Bumping `DAEMON_API_VERSION` (the change is additive).
- Bumping `packages/pi-eforge/package.json` version (handled at npm publish time).
- One-click "Recover" button on the failed row (explicitly rejected; flow is view-then-act inside the sheet).
- Auto-applying verdicts without user confirmation (skill must always confirm, honoring existing memory).
- Filesystem or git mutation from the skill itself (all mutation flows through engine `applyRecovery()`).
- Reimplementing `forgeCommit()`, `recoveryVerdictSchema`, `writeRecoverySidecar()`, `apiRecover`, or `apiReadRecoverySidecar`.

## Acceptance Criteria

1. `pnpm build && pnpm type-check && pnpm test` all pass.
2. Trigger an intentionally failing PRD; let inline recovery write the sidecar; verify the verdict chip + sheet render in the monitor UI.
3. From the sheet for a `split` verdict, click "Enqueue successor PRD"; verify a new PRD lands in `eforge/queue/`, the daemon picks it up under auto-build, and a `forgeCommit` recorded the change.
4. From the sheet for a `retry` verdict (force one for testing), click "Re-queue PRD"; verify the `.md` is back in `eforge/queue/`, both sidecars are removed in the working tree, and a single `forgeCommit` records the move + delete.
5. From the sheet for `abandon`, click "Archive"; verify the failed PRD + sidecars are removed and committed.
6. Plugin skill: from a fresh Claude Code session in this repo, `/recover` lists failed PRDs, walks through the verdict, and applies action via `eforge_apply_recovery`.
7. Pi parity: confirm `pi-eforge` exposes `eforge_apply_recovery` MCP tool, the new `eforge-recover` skill loads, and the Pi-side daemon call works end-to-end.
8. Daemon API: `curl` `POST /api/recover/apply` with valid + invalid bodies, verify validation matches the existing `/recover` handler's pattern.
9. Engine `applyRecovery` correctly dispatches each verdict (`retry`, `split`, `abandon`, `manual`), produces a single `forgeCommit` per mutating action, and fails loudly when `split` lacks `suggestedSuccessorPrd` or when the sidecar is absent (with a message pointing at `recover()`).
10. `retry` action removes both sidecars in the working tree (audit trail preserved in commit history); `split` leaves failed PRD + sidecars in place as audit; `abandon` removes PRD + both sidecars.
11. The skill never auto-applies a verdict — always confirms with the user before calling `eforge_apply_recovery`.
12. The `RecoverySidecarSheet` shows a "Re-run analysis" secondary button across all verdict variants; the `manual` variant shows no primary action button but hints to use `/recover` in chat.
13. When `isRecoveryPending` (no sidecar yet), the row shows a "Run analysis" icon-button that calls `triggerRecover()`, and the existing 5s polling picks up the new sidecar.
