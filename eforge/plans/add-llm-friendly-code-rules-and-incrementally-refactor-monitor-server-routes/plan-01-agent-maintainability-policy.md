---
id: plan-01-agent-maintainability-policy
name: Add LLM-Friendly Code Policy and Ratchet
branch: add-llm-friendly-code-rules-and-incrementally-refactor-monitor-server-routes/plan-01-agent-maintainability-policy
---

# Add LLM-Friendly Code Policy and Ratchet

## Architecture Context

This plan creates the project-wide guardrail layer before touching the large monitor server hotspot. `AGENTS.md` remains the concise entry point for agent-facing rules, while `docs/llm-friendly-code.md` owns the detailed policy. The executable ratchet makes the rules testable without forcing the current legacy repository to meet a universal file-size cap in one change.

This replacement build source explicitly does not require `CLAUDE_CODE_MAX_OUTPUT_TOKENS` or any other external output-token environment variable. Builders must use bounded exact edits and route-group moves instead of a monolithic rewrite.

## Implementation

### Overview

Add a documentation page, summarize it in `AGENTS.md`, add a `pnpm maintainability:check` script, and add tests proving the ratchet passes the repository and fails a synthetic oversized implementation file.

### Key Decisions

1. Use a ratchet baseline rather than a universal hard cap: current files such as `packages/monitor/src/server.ts`, `packages/engine/src/eforge.ts`, and `packages/client/src/events.schemas.ts` exceed the proposed cap.
2. Keep legacy exceptions explicit in a small checked-in baseline file so future growth fails without hiding the exception inside prose.
3. Check marker balance globally and enforce hard caps for non-excepted implementation files so new large files fail fast.
4. Keep route-contract language in both the policy and `AGENTS.md`: route constants and daemon wire shapes remain owned by `@eforge-build/client`.

## Scope

### In Scope

- Create `docs/llm-friendly-code.md` with file-size, function-complexity, marker-comment, route-contract, and bounded-edit rules.
- Update `AGENTS.md` to link the policy and summarize mandatory rules for future agents.
- Add `scripts/check-agent-maintainability.mjs` and an explicit legacy baseline, tentatively `scripts/agent-maintainability-baseline.json`.
- Add `maintainability:check` to the root `package.json` scripts.
- Add a Vitest coverage file, tentatively `test/agent-maintainability-check.test.ts`, that invokes the script against a temporary fixture containing a synthetic oversized implementation file and asserts a non-zero exit.

### Out of Scope

- Refactoring `packages/monitor/src/server.ts`; later plans do that in route-group slices.
- Making every oversized legacy file compliant in this plan.
- Changing public HTTP routes, daemon wire contracts, or client route constants.

## Files

### Create

- `docs/llm-friendly-code.md` — Detailed agent/LLM-friendly code organization policy.
- `scripts/check-agent-maintainability.mjs` — Executable ratchet for file-size caps, legacy no-growth ceilings, and balanced `// --- eforge:region <slug> ---` markers.
- `scripts/agent-maintainability-baseline.json` — Explicit legacy oversized-file exceptions with no-growth ceilings based on current line counts.
- `test/agent-maintainability-check.test.ts` — Tests that the script exits 0 for the repo and exits non-zero for a synthetic oversized implementation file.

### Modify

- `AGENTS.md` — Add `pnpm maintainability:check` to commands, link the new policy, state the 600-line new implementation cap, bounded edit rule for files over 1,000 lines, cognitive-complexity threshold 30 for new/moved functions unless justified, marker rule for large files, and the existing `@eforge-build/client` route/wire-shape ownership rule.
- `package.json` — Add `"maintainability:check": "node scripts/check-agent-maintainability.mjs"`.

## Ratchet Script Requirements

- Treat non-test implementation files as capped at 600 lines unless listed in the explicit baseline.
- Treat test files with a higher cap, proposed 1,200 lines, unless listed in the explicit baseline.
- Permit schema/generated-like legacy files only through explicit baseline entries or documented generated/schema categories.
- For each baseline entry, compare the current line count to `noGrowthCeiling`; any increase above that number exits non-zero.
- Exclude `node_modules/`, `dist/`, `.git/`, `.eforge/`, and plan artifact directories from scans.
- Check every file containing eforge region markers for balanced, matching `region`/`endregion` slugs.
- Print paths and measured line counts for every violation.

## Verification

- [ ] `pnpm maintainability:check` exits 0 on the repository.
- [ ] `pnpm vitest run test/agent-maintainability-check.test.ts` exits 0.
- [ ] The synthetic oversized implementation fixture in the test causes `scripts/check-agent-maintainability.mjs` to exit non-zero.
- [ ] `AGENTS.md` contains a link to `docs/llm-friendly-code.md` and states the 600-line cap for new implementation files.
- [ ] The baseline contains explicit no-growth ceilings for current oversized legacy files discovered by the line-count scan.