---
id: plan-03-docs-issue-tracker-example
name: Docs and Issue Tracker Example
branch: extend-11-runtime-input-transformers-and-prd-enrichers/plan-03-docs-issue-tracker-example
agents:
  builder:
    effort: medium
    rationale: Documentation and example updates span several consumer-facing
      surfaces but depend on contracts from the first two plans.
  reviewer:
    effort: high
    rationale: Example code handles issue tracker URLs and environment tokens, so
      docs, API, security, and test review are useful.
---

# Docs and Issue Tracker Example

## Architecture Context

After runtime preprocessing lands, extension authors need examples and reference documentation that no longer label input sources as deferred. Eforge also maintains parity between Claude Code plugin skills and Pi extension skills, and plugin edits require a plugin version bump.

## Implementation

### Overview

Add a safe-by-default issue tracker extension example covering GitHub, Linear, and Jira patterns. Update extension docs, SDK README, generated public docs mirrors, examples README, and `/eforge:extend` skills to describe runtime input sources, PRD enrichers, explicit source URI syntax, failure policy, and provenance events.

### Key Decisions

1. Implement provider integrations as an example extension, not first-party production clients.
2. Use environment variables for all tokens/base URLs and return helpful markdown when credentials are absent.
3. Avoid logging secrets and redact token-bearing details from example messages.
4. Keep Pi and Claude Code extension-authoring skill text aligned; bump only the Claude Code plugin version as required by repository policy.

## Scope

### In Scope

- Example extension with `registerInputSource` adapters for GitHub, Linear, and Jira issue references.
- Example `registerPrdEnricher` that demonstrates deterministic PRD enrichment, such as repo Definition of Done injection from an environment variable or local markdown file.
- Documentation for `eforge://input/<adapter>/<id...>`, adapter/enricher ordering, session-plan normalization order, source failure behavior, enricher fail-open behavior, timeouts, and provenance events.
- Skill docs updates for both `eforge-plugin` and `packages/pi-eforge`.
- Claude Code plugin version bump.
- Tests/static imports ensuring the example compiles and docs no longer mark `registerInputSource` as deferred.

### Out of Scope

- Network-dependent tests against GitHub, Linear, or Jira.
- OAuth flows, token storage, retries, pagination, or webhook sync.
- Pi package version bump.
- New scaffold templates unless implementation remains a small addition; if omitted, docs must point to the example.

## Files

### Create

- `examples/extensions/issue-tracker-inputs.ts` — example extension registering GitHub, Linear, and Jira input adapters plus one PRD enricher. Use `GITHUB_TOKEN`, `LINEAR_API_KEY`, `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and optional Definition of Done env/file inputs. Use global `fetch`; no secrets in thrown messages.

### Modify

- `examples/extensions/README.md` — list the new example, source URI examples, and required environment variables.
- `test/extension-sdk-example.test.ts` — import the new example, add it to `importedExampleFiles`, and assert it satisfies `sdk.EforgeExtensionFactory`.
- `docs/extensions.md` — replace deferred input-source language with runtime support; add PRD enricher section, source URI syntax, ordering, failure policy, timeouts, and provenance event descriptions.
- `docs/extensions-api.md` — document `registerInputSource` runtime behavior, new `InputSourceAdapter`/result/context types, `registerPrdEnricher`, `PrdEnricher` types, and event payload summaries.
- `packages/extension-sdk/README.md` — update API table and examples for runtime input sources and PRD enrichers.
- `web/public/docs/extensions.md` — sync generated/public mirror after docs generation.
- `web/public/docs/extensions-api.md` — sync generated/public mirror after docs generation.
- `packages/pi-eforge/skills/eforge-extend/SKILL.md` — describe runtime input sources and PRD enrichers instead of deferred input sources.
- `eforge-plugin/skills/extend/extend.md` — same capability text as the Pi skill where technically applicable.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the plugin version because plugin skill docs changed.
- `test/extension-tooling-wiring.test.ts` — update documentation assertions so `registerInputSource` is no longer expected to contain `Deferred`; add assertions for `registerPrdEnricher`, `eforge://input/`, and the provenance event names.
- `test/extension-authoring-skill.test.ts` — update skill parity/content assertions for runtime input sources and PRD enrichers.

## Verification

- [ ] `examples/extensions/issue-tracker-inputs.ts` imports in `test/extension-sdk-example.test.ts` and satisfies `sdk.EforgeExtensionFactory`.
- [ ] The example can load without issue tracker environment variables and returns markdown that states which variable is missing for the selected provider.
- [ ] Docs contain `eforge://input/<adapter>/<id...>` and all four provenance event names.
- [ ] Docs API tables show `registerInputSource` as runtime-supported and include `registerPrdEnricher`.
- [ ] Pi and Claude Code extend skills both mention runtime input sources and PRD enrichers.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version differs from the pre-plan version.
- [ ] `pnpm docs:check` reports no generated documentation drift.
