---
title: Add LLM-Friendly Code Rules and Incrementally Refactor Monitor Server Routes
created: 2026-05-27
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Add LLM-Friendly Code Rules and Incrementally Refactor Monitor Server Routes

## Problem / Motivation

The previous PRD, `refactor-monitor-server-http-route-handler-complexity`, failed during builder execution because Claude’s response exceeded the 32,000 output-token maximum. The recovery sidecar recommended retrying, but this work should not rely on `CLAUDE_CODE_MAX_OUTPUT_TOKENS` or any other external environment variable to succeed.

Evidence from the failed build and current codebase:

- The failed builder made only read-oriented tool calls over `packages/monitor/src/server.ts`; no implementation source edits were preserved.
- The failed feature branch contains planning/provenance artifacts only relative to its merge base.
- `packages/monitor/src/server.ts` is currently 4,869 lines.
- `pnpm complexity:scan` reports the `createServer` callback at `packages/monitor/src/server.ts:2061` with cognitive complexity 1384, making it the top hotspot by a large margin.
- Existing project policy already contains targeted agent-facing rules in `AGENTS.md`, including route constants owned by `@eforge-build/client`, daemon wire-shape ownership, event schema ownership, and consumer integration parity.
- Existing source already uses some marker comments such as `// --- eforge:region ... ---` and `// --- eforge:endregion ... ---`, but there is no general policy for LLM-friendly file/module size, bounded edit size, or markers for generated/agent-maintained seams.
- `docs/roadmap.md` does not currently include LLM-friendly codebase governance as a roadmap item.
- The closest roadmap alignment is maturity/low-fidelity input handling and harness-engineering quality, but this work is a local engineering-quality policy plus a specific refactor.

This is an architecture / focused change: it creates project-wide code organization rules and applies them to one high-risk monitor-server hotspot without changing external daemon behavior.

## Goal

Replace the failed single-plan monitor-server refactor with an LLM-friendly incremental build source that introduces project-wide codebase maintainability rules and applies them to the monitor route hotspot while preserving observable daemon behavior.

## Approach

Use a fresh replacement build source from current `main` rather than retrying or mutating the failed feature branch manually.

Do not apply the recovery sidecar’s retry as-is because it recommends increasing `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, while the desired direction is to make the work small enough for default agent constraints.

Require multiple small implementation plans instead of one monolithic monitor-server rewrite. Proposed plan shape:

- Plan 01: add LLM-friendly code policy docs, `AGENTS.md` summary, and maintainability ratchet script.
- Plan 02: add monitor route dispatcher skeleton and extract only CORS, keep-alive, unknown API, and static fallback handling.
- Plan 03: extract control-plane and profile route groups.
- Plan 04: extract extension route group.
- Plan 05: extract playbook and session-plan route groups.
- Plan 06: extract model/config/monitor-data route groups and run complexity/test validation.

Add explicit LLM-friendly code rules with a ratchet rather than a one-time aspiration. Initial rules should include:

- New implementation files should stay under a strict line cap, proposed default 600 lines.
- Existing legacy files over the cap require explicit allowlist entries with no-growth ceilings.
- New or moved functions should stay under the existing Sonar cognitive-complexity threshold of 30 unless explicitly justified.
- Large files must expose stable navigation seams with `// --- eforge:region <slug> ---` and matching `// --- eforge:endregion <slug> ---` markers.
- Agent-built plans must prefer small exact edits over full-file rewrites for files over 1,000 lines.
- Route/API code must keep client-owned route constants and wire-shape helpers as sources of truth.

Use bounded edit instructions as acceptance constraints:

- Forbid full-file rewrites of `packages/monitor/src/server.ts`.
- Each monitor extraction plan should move contiguous route chunks and preserve early-return behavior.
- Each helper should return `boolean` or `Promise<boolean>` and return `true` only after handling a response.

Keep behavior-preserving refactor validation broad but staged:

- Run targeted monitor/route tests after relevant route groups.
- Run `pnpm type-check`, `pnpm complexity:scan`, and `pnpm test` before completion.

Treat file-size compliance as a ratchet for this build because the repository currently has multiple legitimate/legacy files over 1,200 lines, including tests and schema files.

Codebase rule architecture:

- `AGENTS.md` remains the high-signal entry point for agent-facing rules.
- A dedicated docs page owns the detailed policy for LLM-friendly code, so `AGENTS.md` can stay concise.
- A new maintainability ratchet script gives rules executable force without requiring the entire legacy repository to become compliant immediately.
- The script should distinguish source files, tests, generated/schema-like files, and explicit legacy exceptions.
- Existing over-limit files discovered during planning include `packages/monitor/src/server.ts` at 4,869 lines, `packages/engine/src/eforge.ts` at 2,787 lines, `packages/client/src/events.schemas.ts` at 2,723 lines, and several others above 1,200 lines.
- The first version of the guardrail must be a ratchet/no-growth policy for legacy exceptions plus hard limits for new files.

Monitor-server architecture:

- The daemon route surface remains hosted by `packages/monitor/src/server.ts` during this build unless a route group can be moved safely with a small dependency object.
- The top-level `createServer` callback becomes an ordered dispatcher with route-group helpers.
- The route helpers may initially remain nested in `createMonitorServer(...)` to avoid a large module-boundary rewrite, but each helper must be marked and small enough for future movement to a dedicated module.
- If a route group is moved to a new module, dependencies flow through an explicit `MonitorRouteContext` object instead of importing engine internals or duplicating route constants.
- The final state must make future route-group extraction obvious: helpers are named by route group, ordered in the same sequence as the dispatcher, and bounded by marker comments.
- No external daemon API architecture changes are intended.
- The HTTP contract remains owned by `@eforge-build/client`.
- Daemon wire-shape construction continues to use existing projection helpers.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The failed build can be replaced rather than retried in place. | Recovery sidecar and monitor DB events show no source implementation edits; branch contains planning/provenance artifacts only relative to its merge base. | high | low | Start a fresh build source from current `main` and leave the failed queue item untouched or archive it after replacement. | Retrying stale artifacts could reintroduce old branch drift or unrelated diffs. |
| Smaller plan slices will avoid the Claude SDK default output-token cap without increasing `CLAUDE_CODE_MAX_OUTPUT_TOKENS`. | The failure occurred after read-heavy exploration of a 4,869-line file and before any persisted implementation; bounded route-group plans reduce required response size. | medium | medium | Enqueue the replacement and observe whether each builder completes under default settings. | A builder could still produce too much prose or patch text, requiring stronger prompt rules or a switch to a different implementation profile. |
| A ratchet policy is safer than immediately enforcing a universal file-size cap. | A quick line-count scan found multiple existing files over 1,200 lines, including schema/test files and core engine modules. | high | low | Encode explicit allowlist/no-growth ceilings and run the check locally. | A hard cap without allowlists would fail immediately and distract from the monitor-server refactor. |
| Marker comments will help future LLM edits without creating misleading structure. | Existing code already uses `// --- eforge:region ... ---` markers in `packages/monitor/src/server.ts`; parity-check tooling also uses marker blocks. | medium | low | Keep marker naming strict and add a script check for balanced region markers. | Poorly maintained markers could mislead agents or hide route-order drift. |
| Nested route helpers are acceptable as an interim step even though module extraction is more LLM-friendly long term. | The current callback relies on many closure-local helpers and values; moving all routes to modules in one pass would add parameter plumbing and increase risk. | high | medium | After helper extraction, separately assess moving each helper group to `packages/monitor/src/routes/` modules. | The file may remain larger than desired after this build, requiring follow-up migration. |
| The existing route tests plus listed targeted tests cover the most important behavior-preservation risks. | Found targeted tests for playbook routes, extension tooling routes, daemon session-plan routes, stack sync, daemon events stream, auto-build route, and static UI serving. | medium | medium | Add route-order or smoke tests if a route group has no direct coverage during implementation. | Missing coverage could allow subtle route-order or response-text drift. |
| `pnpm complexity:scan` is sufficient to verify the target hotspot complexity. | The repository already uses `scripts/scan-complexity.mjs` with SonarJS cognitive complexity and reports the server callback at CC 1384. | high | low | Re-run `pnpm complexity:scan` after extraction and inspect the top table. | A different callback line or helper could remain above the target threshold. |

Recommended eforge workflow profile: **Excursion**.

Rationale: this is cross-cutting enough to need plan review because it combines a project-wide maintainability rule with a behavior-preserving daemon route refactor. It does not require Expedition because a single cohesive planning pass can enumerate the route-group slices and their dependencies; the implementation should be decomposed into several small sequential plans rather than delegated module planning.

## Scope

In scope:

- Add a project documentation page for LLM/agent-friendly codebase rules, tentatively `docs/llm-friendly-code.md` or `docs/agent-maintainability.md`.
- Update `AGENTS.md` with a short mandatory summary of those rules so future agents see them before editing.
- Add a lightweight maintainability ratchet script and package script, tentatively `scripts/check-agent-maintainability.mjs` and `pnpm maintainability:check`, that enforces new/touched-code rules while grandfathering known legacy oversize files with explicit no-growth ceilings.
- Replace the failed monitor-server implementation approach with multiple small, ordered plans rather than one large route-callback rewrite.
- Refactor `packages/monitor/src/server.ts` in bounded route-group slices that preserve observable HTTP behavior.
- Use marker comments for route groups and LLM-edit seams where they help agents navigate large transitional files.
- Reduce the `createServer` callback cognitive complexity from 1384 to a target of <= 80 in this build.
- Keep `API_ROUTES` and derived route bases as the source of truth.
- Preserve daemon route order, response shapes, status codes, headers, error text, CORS behavior, SSE/static serving behavior, and local-origin safety checks.

Out of scope:

- Depending on `CLAUDE_CODE_MAX_OUTPUT_TOKENS` or any other external environment variable to make the build pass.
- Rewriting `packages/monitor/src/server.ts` as a full-file replacement.
- Changing public HTTP routes or daemon wire contracts.
- Moving route constants out of `@eforge-build/client`.
- Changing monitor UI behavior.
- Refactoring unrelated complexity hotspots such as `packages/pi-eforge/extensions/eforge/index.ts` or `packages/eforge/src/cli/mcp-proxy.ts`.
- Making every existing legacy oversized file compliant in one pass; this build may add explicit allowlist/ratchet entries for existing violations and reduce one hotspot.

## Acceptance Criteria

- The replacement build source states that `CLAUDE_CODE_MAX_OUTPUT_TOKENS` is not required for successful implementation.
- The replacement build source requires multiple small implementation plans instead of one monolithic monitor-server rewrite.
- The replacement build source forbids full-file replacement of `packages/monitor/src/server.ts`.
- The replacement build source requires small exact edits or contiguous route-group moves for files over 1,000 lines.
- `docs/llm-friendly-code.md` or `docs/agent-maintainability.md` documents file-size, function-complexity, marker-comment, route-contract, and bounded-edit rules for LLM-maintained code.
- `AGENTS.md` links to the new LLM-friendly code policy document.
- `AGENTS.md` states that new implementation files should stay under the selected line cap unless explicitly justified.
- `AGENTS.md` states that route constants and daemon wire shapes remain owned by `@eforge-build/client`.
- A maintainability check script exists under `scripts/` and can be run through a package.json script.
- The maintainability check script exits 0 on the repository after the build lands.
- The maintainability check script fails on a synthetic new implementation file that exceeds the selected new-file line cap.
- Existing legacy oversized files are represented by explicit ratchet exceptions or documented categories.
- Legacy ratchet exceptions record a no-growth ceiling or equivalent threshold that prevents silent file growth.
- The `createServer` callback in `packages/monitor/src/server.ts` contains only URL/pathname computation, ordered helper dispatch, unknown API handling through a helper, and static fallback delegation.
- The monitor-server route helpers use `boolean` or `Promise<boolean>` handled-return semantics.
- Each monitor-server route helper returns `false` when no route in that group matches.
- Each monitor-server route helper returns `true` only after writing a response or delegating to code that writes the response.
- The observable route order for CORS, keep-alive, control-plane, profile, extension, playbook, session-plan, model/config, monitor data, unknown API, and static fallback handling is preserved.
- Existing local-origin safety checks for extension mutation routes remain present on the same mutation routes.
- `API_ROUTES` and existing derived route-base constants remain the route source of truth.
- The `/console` static fallback is still evaluated before the legacy monitor static fallback.
- Unknown `/api/` routes are still handled before static fallback.
- `pnpm complexity:scan` reports the `createServer` callback in `packages/monitor/src/server.ts` at cognitive complexity <= 80 or no longer reports that callback as a top hotspot above 80.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
- `pnpm vitest run test/playbook-api.test.ts test/extension-tooling-routes.test.ts test/daemon-session-plan-routes.test.ts test/stack-sync-route.test.ts test/daemon-events-stream.test.ts packages/monitor/src/__tests__/auto-build-route.test.ts packages/monitor/src/__tests__/static-ui-serving.test.ts` exits 0.
- `pnpm test` exits 0, or any unrelated pre-existing failures are documented with reproduction evidence from current `main`.
