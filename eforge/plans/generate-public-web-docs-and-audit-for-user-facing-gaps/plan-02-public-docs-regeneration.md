---
id: plan-02-public-docs-regeneration
name: Regenerate and Validate Public Web Artifacts
branch: generate-public-web-docs-and-audit-for-user-facing-gaps/plan-02-public-docs-regeneration
agents:
  builder:
    effort: medium
    rationale: Generated docs refresh is mechanical, but the builder must
      distinguish generated outputs from hand-authored sources and capture
      docs:check failures with actionable diagnostics.
  reviewer:
    effort: medium
    rationale: Review focuses on generated-artifact drift, link health, and absence
      of accidental hand edits to generated reference files.
  tester:
    effort: high
    rationale: Docs generation and drift checks depend on workspace builds and link
      validation; failures need careful triage between real drift and missing
      local dependencies.
---

# Regenerate and Validate Public Web Artifacts

## Architecture Context

`pnpm docs:generate` builds `@eforge-build/docs-gen` and runs `packages/docs-gen/dist/cli.js generate --all`. The generator writes reference Markdown to `web/content/reference/`, mirrors guide/reference Markdown under `web/public/`, writes JSON schemas under `web/public/schemas/`, and rebuilds `web/public/llms.txt` plus `web/public/llms-full.txt`. `pnpm docs:check` rebuilds the generator, generates into a temp directory, compares checked-in outputs byte-for-byte, and runs the internal docs link checker.

## Implementation

### Overview

After plan 01 updates hand-authored guide sources, refresh every generated documentation artifact through the repository docs-generation workflow. Do not hand-edit generated outputs except to discard accidental local changes and rerun the generator. Validate drift and link health, then capture any environment-only failure with exact follow-up commands.

### Key Decisions

1. Generated reference and public artifacts are outputs of `pnpm docs:generate`; all changes to those files must be reproducible by rerunning the generator.
2. `pnpm docs:check` is the acceptance gate for generated docs drift and internal links.
3. If the local checkout lacks dependencies and `pnpm docs:check` fails with missing binaries such as `tsup`, record the failure and rerun after `pnpm install` rather than editing generated files manually.

## Scope

### In Scope

- Run `pnpm docs:generate` from the repo root after all plan-01 source edits are present.
- Commit reproducible generated changes in web reference artifacts, public mirrors, schemas, and LLM artifacts.
- Run `pnpm docs:check` and resolve drift or link failures caused by the docs changes.
- Run web type-check and docs-related tests when dependencies are installed.

### Out of Scope

- Do not add new hand-authored guide content in this plan except for minimal link/drift fixes required by `pnpm docs:check`.
- Do not edit generated files by hand to satisfy drift.
- Do not change runtime implementation code.

## Files

### Create

- None expected.

### Modify

- `web/content/reference/cli.md` — generated CLI reference from current Commander definitions.
- `web/content/reference/api.md` — generated daemon route reference from client-owned route constants.
- `web/content/reference/events.md` — generated event protocol reference from client event schemas.
- `web/content/reference/config.md` — generated config reference and JSON schema summary.
- `web/content/reference/tools.md` — generated MCP/Pi tools and skill reference.
- `web/public/docs/*.md` — generated raw guide mirrors for every `web/content/docs/*.md` source.
- `web/public/reference/*.md` — generated raw reference mirrors.
- `web/public/schemas/config.schema.json` — generated config JSON schema.
- `web/public/schemas/events.schema.json` — generated event JSON schema.
- `web/public/llms.txt` — generated LLM-readable index from `packages/docs-gen/src/manifest.ts`.
- `web/public/llms-full.txt` — generated concatenated guide/reference bundle.

## Verification

- [ ] `pnpm docs:generate` exits 0 from the repo root.
- [ ] For every `web/content/docs/<slug>.md`, `web/public/docs/<slug>.md` has identical bytes after generation.
- [ ] For every `web/content/reference/<slug>.md`, `web/public/reference/<slug>.md` has identical bytes after generation.
- [ ] `pnpm docs:check` exits 0. If it exits non-zero because workspace dependencies are absent, the recorded failure includes the missing command name and the follow-up `pnpm install && pnpm docs:check`.
- [ ] `pnpm --filter @eforge-build/web type-check` exits 0 when dependencies are installed.
- [ ] `pnpm test` exits 0 when dependencies are installed, or the failure output identifies a non-docs test with an unrelated pre-existing cause.