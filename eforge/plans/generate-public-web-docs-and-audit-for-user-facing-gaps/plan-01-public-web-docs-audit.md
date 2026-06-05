---
id: plan-01-public-web-docs-audit
name: Audit Public Web Docs and Refresh Generated Artifacts
branch: generate-public-web-docs-and-audit-for-user-facing-gaps/plan-01-public-web-docs-audit
agents:
  builder:
    effort: high
    rationale: Requires comparing public docs against user-facing implementation
      surfaces, updating generated reference tooling, and regenerating artifacts
      without hand-editing generated outputs.
  reviewer:
    effort: high
    rationale: Docs accuracy and generator changes need thorough review from both
      code and documentation perspectives.
---

# Audit Public Web Docs and Refresh Generated Artifacts

## Architecture Context

The public docs site uses hand-authored guide sources in `web/content/docs/` and generated reference artifacts under `web/content/reference/`, `web/public/reference/`, `web/public/docs/`, `web/public/schemas/`, and `web/public/llms*.txt`. The docs generator in `packages/docs-gen/` is the source for generated references and raw mirrors; generated outputs must be refreshed through `pnpm docs:generate`, not edited manually.

Current audit findings from exploration:

- `web/content/reference/tools.md` and `web/public/reference/tools.md` contain an empty generated description row for Pi's `eforge_apply_recovery` tool because `packages/docs-gen/src/generators/tools.ts` only extracts direct string literals and misses concatenated static string descriptions.
- `web/content/reference/config.md` and `web/public/reference/config.md` contain blank descriptions for several top-level config fields (`agents`, `build`, `daemon`, `hooks`, `langfuse`, `maxConcurrentBuilds`, `monitor`, `plan`, `plugins`, `prdQueue`, `tools`) because the generated table emits empty schema descriptions as empty cells.
- `web/content/docs/extensions.md` links public readers to the legacy root `docs/hooks.md` for event types instead of using the public events reference.
- Some public guide wording promises future queue cascade controls or future approval workflow behavior. The public docs must describe current behavior and unsupported decisions without roadmap promises.
- `pnpm docs:check` could not run in this planning worktree because dependencies are not installed (`tsup: command not found`); builders must install/use workspace dependencies normally and rerun the docs workflow.

## Implementation

### Overview

Audit the public docs against the current implementation, close the concrete public-doc gaps found above, improve generated reference extraction so current tool descriptions render, regenerate all docs artifacts, and add tests that catch these user-facing holes.

### Key Decisions

1. Treat `web/content/docs/` as the editable public guide source and update `web/public/docs/` only through `pnpm docs:generate`.
2. Fix generated reference holes at the generator/source level instead of hand-editing `web/content/reference/*.md` or `web/public/reference/*.md`.
3. Keep root `docs/` out of scope except as implementation/context evidence; do not update legacy root docs.
4. Use task-oriented current-state wording for unsupported behavior instead of future-roadmap phrasing.

## Scope

### In Scope

- Audit and update public guide sources under `web/content/docs/` for the identified stale links and roadmap-style wording.
- Improve `packages/docs-gen/src/generators/tools.ts` so generated tool descriptions include static concatenated string descriptions such as Pi `eforge_apply_recovery`.
- Improve `packages/docs-gen/src/generators/config.ts` so the top-level fields table uses non-empty public descriptions for all known top-level config keys when schema descriptions are absent.
- Regenerate generated docs artifacts with `pnpm docs:generate`.
- Update or add tests that fail on empty public reference description cells for the generated surfaces touched by this plan and fail on the stale public hooks-doc link.
- Run and document `pnpm docs:check` results.

### Out of Scope

- Updating legacy root `docs/` content.
- Adding marketing copy or speculative roadmap content.
- Changing engine behavior, daemon API behavior, CLI flags, extension APIs, or integration commands beyond generator logic needed for accurate generated docs.
- Hand-editing generated reference outputs instead of regenerating them.

## Files

### Create

- None expected.

### Modify

- `packages/docs-gen/src/generators/tools.ts` — Replace direct string-literal-only extraction with a bounded static string extractor that handles string literals, no-substitution template literals, parenthesized expressions, and `+` concatenation of static strings; reuse it for MCP and Pi tool descriptions.
- `packages/docs-gen/src/generators/config.ts` — Add deterministic fallback descriptions for every top-level `eforgeConfigSchema` key and emit those descriptions when the JSON schema lacks one.
- `web/content/docs/extensions.md` — Replace the legacy root `docs/hooks.md` event-types link with the public events reference and keep event-pattern guidance user-facing.
- `web/content/docs/concepts.md` — Reword queue removal/dependent behavior to describe the current fail-closed flow without promising future cascade controls.
- `web/content/docs/configuration.md` — Reword queue controls to describe current removal and dependency behavior without future-control promises.
- `web/content/docs/troubleshooting.md` — Reword queue-dependent removal and `require-approval` troubleshooting to describe current supported actions and unsupported decisions without roadmap promises.
- `test/docs-gen-determinism.test.ts` — Add assertions that generated tools/config references contain no empty description rows for the audited generated tables and that Pi `eforge_apply_recovery` includes its source description.
- `test/reference-content.test.ts` — Add/adjust assertions that public docs do not reference the legacy root `docs/hooks.md` path and do not include the audited future-control wording.
- `web/content/reference/tools.md` — Generated output from `pnpm docs:generate`; `eforge_apply_recovery` must have a non-empty Pi description.
- `web/public/reference/tools.md` — Generated mirror from `pnpm docs:generate`.
- `web/content/reference/config.md` — Generated output from `pnpm docs:generate`; top-level config rows must have non-empty descriptions.
- `web/public/reference/config.md` — Generated mirror from `pnpm docs:generate`.
- `web/public/docs/extensions.md` — Generated mirror from `pnpm docs:generate`.
- `web/public/docs/concepts.md` — Generated mirror from `pnpm docs:generate`.
- `web/public/docs/configuration.md` — Generated mirror from `pnpm docs:generate`.
- `web/public/docs/troubleshooting.md` — Generated mirror from `pnpm docs:generate`.
- `web/public/llms-full.txt` — Generated concatenated bundle from `pnpm docs:generate` if guide/reference content changes are included in the bundle.
- `web/public/llms.txt` — Generated manifest from `pnpm docs:generate` if generator output changes alter its contents.

## Verification

- [ ] `pnpm docs:generate` exits with code 0 and updates only generated docs artifacts plus planned source/test files.
- [ ] `pnpm docs:check` exits with code 0 after regeneration.
- [ ] `pnpm test -- test/docs-gen-determinism.test.ts test/reference-content.test.ts web/__tests__/content.test.ts` exits with code 0.
- [ ] `pnpm type-check` exits with code 0.
- [ ] `web/content/reference/tools.md` contains a non-empty description for the Pi `eforge_apply_recovery` row.
- [ ] `web/content/reference/config.md` top-level field rows for `agents`, `build`, `daemon`, `hooks`, `langfuse`, `maxConcurrentBuilds`, `monitor`, `plan`, `plugins`, `prdQueue`, and `tools` contain non-empty descriptions.
- [ ] `rg "docs/hooks.md|until future cascade|future cascade-aware|future release" web/content/docs web/public/docs` returns no matches.
