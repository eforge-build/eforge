# LLM-Friendly Code Policy

This policy applies to all implementation files in the eforge monorepo. Its goal is to keep individual files small and focused enough that an LLM agent can read, reason about, and edit them without losing context or making cascading mistakes.

## File Size Caps

| File Category | Hard Cap | Notes |
|---|---|---|
| New implementation files | **600 lines** | Any new `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, or `.cjs` file not in the baseline and not classified as a test file |
| New test files | **1,200 lines** | Any file matching `*.test.*`, `*.spec.*`, paths containing `/__tests__/`, paths containing `/test/`, or paths starting with `test/` |
| Legacy files (baseline) | `noGrowthCeiling` | Listed in `scripts/agent-maintainability-baseline.json` — may not grow |

**New file** means any file not present in `scripts/agent-maintainability-baseline.json`. Legacy files are frozen at their baseline ceiling; they may shrink but not grow.

Run `pnpm maintainability:check` to validate the repository against these caps.

## Legacy Baseline

`scripts/agent-maintainability-baseline.json` lists all files that currently exceed the cap, together with a `noGrowthCeiling` equal to their line count at the time they were baselined. The ratchet script enforces two things:

1. Any file in the baseline must not exceed its `noGrowthCeiling`.
2. Any file **not** in the baseline must not exceed the hard cap for its category.

When a legacy file is refactored below its ceiling, remove it from the baseline (or lower the ceiling) so future growth fails fast.

## Function Cognitive Complexity

New functions and functions moved into new files must have a Cognitive Complexity score at or below **30** (measured by `eslint-plugin-sonarjs/cognitive-complexity`). If a function genuinely requires higher complexity, document the justification inline above the function definition:

```ts
// Complexity justification: exhaustive pattern match over 15 event variants — splitting would require threading context through N small helpers.
function handleEvent(event: EforgeEvent) { /* ... */ }
```

Use `pnpm complexity:scan` to identify the highest-complexity hotspots.

## Region Markers for Large Files

Any implementation file that legitimately exceeds 300 lines (with a baseline exception or during planned incremental refactoring) must use eforge region markers to logically partition its sections:

```ts
// --- eforge:region <slug> ---
// ... code belonging to this region ...
// --- eforge:endregion <slug> ---
```

Rules:
- Every `// --- eforge:region <slug> ---` must have a matching `// --- eforge:endregion <slug> ---` with the same slug, and markers must not be crossed (i.e., regions must be properly nested or sequential, not interleaved).
- Multiple sequential (non-nested) blocks with the same slug are permitted when a plan contributes several separate sections across a large file; each block must be individually closed before the next one opens.
- Agents must only edit code within their declared region when working in a shared file (a file touched by multiple parallel plans).
- `pnpm maintainability:check` validates marker balance in TypeScript/JavaScript files under `packages/`, `test/`, `scripts/`, `web/`, and `eforge-plugin/`.

## Route Contract and Daemon Wire Shape Ownership

All HTTP route constants, route path builders, and daemon wire shapes (run info, queue items, session metadata, auto-build status) are owned by `@eforge-build/client` (`packages/client/`):

- Import `API_ROUTES` and `buildPath()` for route constants; do **not** inline `/api/...` strings.
- Import named per-route helpers (`apiEnqueue`, `apiCancel`, `apiHealth`, etc.) instead of calling `fetch` with inlined paths.
- For browser bundles (`packages/console-ui/src`, `packages/monitor-ui/src/lib/api.ts`), import from `@eforge-build/client/browser`.
- Do **not** re-declare wire-shape interfaces in monitor packages — use the exported types from `@eforge-build/client`.

Bump `DAEMON_API_VERSION` in `packages/client/src/api-version.ts` when making breaking HTTP API changes.

## Bounded Edit Rule

When an agent or developer edits a file that **exceeds 1,000 lines**, they must use **bounded exact edits** rather than rewriting the entire file:

- Identify the minimal changed region (function, block, or section demarcated by region markers).
- Apply the smallest possible diff that achieves the goal.
- Do **not** emit or overwrite the full file content.

This rule prevents context-window pressure from causing silent regressions in the surrounding unchanged code. Large monolithic rewrites are a primary source of subtle LLM-introduced bugs.

## Enforcement

| Check | How |
|---|---|
| File size caps and baseline ceilings | `pnpm maintainability:check` (exits non-zero on violations) |
| Region marker balance | Same script — validated in TypeScript/JavaScript files under `packages/`, `test/`, `scripts/`, `web/`, and `eforge-plugin/` |
| Cognitive complexity | `pnpm complexity:scan` (advisory; violations printed as a ranked table) |
| Route-contract discipline | Policy/code review; `pnpm type-check` surfaces mismatches where typed helpers (`API_ROUTES`, `apiEnqueue`, etc.) are used, but inlined path strings and locally re-declared wire-shape interfaces are not caught automatically |

These checks run automatically in the eforge build pipeline verification stage.
