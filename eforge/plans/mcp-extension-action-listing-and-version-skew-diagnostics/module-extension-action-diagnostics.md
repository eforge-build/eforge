---
id: module-extension-action-diagnostics
name: Extension action diagnostics surface
branch: mcp-extension-action-listing-and-version-skew-diagnostics/module-extension-action-diagnostics
---

# Extension action diagnostics surface

Implement the cohesive extension action diagnostics work: return typed MCP-safe `eforge_extension` list/show action projections that preserve all action ids, names/labels, and output profile metadata while keeping schemas and large diagnostics opt-in by default; align Claude/Pi contribution guidance so MCP-only agents list contributions with pagination then show details, with fallback guidance as needed; propagate daemon `eforgeVersion` through extension failures and share CLI/MCP/Pi stale-daemon or version-skew remediation hints without treating compatible API version skew as a hard failure by itself; add whole-entry budget-aware `eforge_extension_contribution list` continuation reporting returned, total, and next offset; author focused regression coverage for id/name preservation, remediation hints, compact-schema omission, and continuation behavior.

## Traceability

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005
Aspects: ac-001:interface:command-surface, ac-001:subsystem:cli, ac-001:subsystem:extension, ac-001:subsystem:http, ac-001:subsystem:ids, ac-001:subsystem:list, ac-001:subsystem:names, ac-001:subsystem:show, ac-002:evidence:contribution-list-show, ac-002:interface:extension-surface, ac-003:interface:command-surface, ac-003:interface:extension, ac-003:interface:extension-surface, ac-003:subsystem:cli, ac-003:subsystem:daemon, ac-003:subsystem:extension, ac-003:subsystem:stale-daemon, ac-003:subsystem:version-skew, ac-004:subsystem:continuation, ac-004:subsystem:extension, ac-004:subsystem:offset, ac-004:subsystem:returned, ac-004:subsystem:total, ac-005:interface:test, ac-005:subsystem:extension, ac-005:subsystem:test

## Validation

Required final validation commands:
- `pnpm test`
- `pnpm type-check`
- `pnpm maintainability:check`

During development, run focused vitest targets for touched extension/CLI/client suites first if useful. Passing behavior preserves action ids/names/labels/output profiles, keeps large schemas out of compact defaults, shows list-then-show guidance, includes daemon version and remediation hints on skew, and returns continuation metadata without dropping actions.

## Fragment: CLI action projection surface

Plan:
- Inspect the CLI extension contribution command path before editing; most CLI handler files are path-only evidence in this atom.
- Implement/adjust `eforge_extension` list/show so MCP/Pi/CLI consumers receive compact or paginated action projections, not raw daemon/HTTP JSON.
- Preserve every action id, action name/label, and output profile. Compact/default projections must omit large schemas and diagnostics; detailed schemas remain available only through explicit detail/show/actionDetails-style opt-in.
- Grounded id evidence shows extension contribution ids are composed as `extensionName:localId` with local ids validated by a lowercase hyphenated regex.
- Consume route/client data through shared typed helpers from `@eforge-build/client`; do not inline `/api` paths or daemon wire shapes.
- Sync existing user-facing docs/integration notes if command arguments or output change, and keep existing CLI/extension tests green.

## Fragment: Boundary-safe list continuation

Plan AC-004 around whole-entry pagination for `eforge_extension_contribution list`.

- Localize the real list implementation and any shared formatter before editing; referenced paths include `packages/eforge/src/cli/extension-contributions.ts`, `packages/eforge/src/cli/mcp-extension-contributions.ts`, and extension contribution output-formatting tests.
- Build output entry-by-entry. Before appending an entry, measure the full serialized response with that complete entry and stop if it would exceed the host budget. Never slice entry text.
- Emit metadata with every response: `returned` is the number of complete entries emitted, `total` is the total available before paging, and `next offset` is present only when more entries remain.
- Continuation guidance should tell the caller how to request the next page using the next offset. If the budget is too small for any entry, prefer an explicit zero-entry boundary response or clear guidance over a partial entry.
- Validate with a constrained-budget fixture containing more than 70 entries that forces continuation, then request the next offset and assert no gaps, duplicates, or mid-entry truncation.

## Fragment: Prefer contribution list/show pagination in MCP guidance

Plan the `eforge_extension` guidance update as a wording/source synchronization task, not a new daemon API feature.

- Locate the user-facing guidance for MCP-only agents in the Claude plugin and Pi extension surfaces.
- Replace or qualify any primary recommendation to inspect raw JSON/HTTP with the sanctioned flow: page through contribution list results, then use contribution show for selected detail.
- Do not invent pagination parameter names from this atom; implementation should use the exact list/show identifiers and continuation fields exposed by the existing contribution surface.
- Keep `eforge-plugin/` and `packages/pi-eforge/` behavior/wording aligned. If plugin files change, bump `eforge-plugin/.claude-plugin/plugin.json`; do not bump the Pi package version.
- Treat raw JSON/HTTP as a fallback or diagnostic path only after the MCP contribution list/show flow is unavailable or insufficient.

## Fragment: Stale-daemon/version-skew error hinting

Plan AC-003 around adding remediation context to extension domain errors without changing daemon API compatibility semantics.

- Localize the extension list/show non-2xx error formatting path for CLI, MCP, and Pi surfaces before editing.
- Use the existing `/api/version` `eforgeVersion` signal through `@eforge-build/client` route helpers to compare the daemon build and caller build when extension errors occur.
- For extension domain errors, especially `404 Extension not found`, append a stale-daemon/version-skew hint with daemon version, caller version, and restart/update remediation when `eforgeVersion` differs.
- Do not fail a request solely because daemon and caller `eforgeVersion` differ when the daemon API version is compatible; the version difference is diagnostic/remediation context, not an additional hard error.
- Keep daemon wire shapes, route constants, and response typing owned by `@eforge-build/client`.

## Fragment: Extension action listing regression tests

Add regression tests for ac-005 only.

Scope:
- Use existing test files around extension contribution/action listing and CLI wiring rather than creating broad new harnesses.
- Candidate paths from localized evidence include `packages/client/src/__tests__/events-schemas-extension-actions.test.ts`, `packages/client/src/__tests__/extension-contribution-output-formatting.test.ts`, `test/extension-cli-commands.test.ts`, `test/extension-tooling-wiring-cli.test.ts`, and related `eforge/extensions/eforge-plan/__tests__/*` list/query coverage.

Required cases:
1. All-action compact/detail preservation: construct or reuse a fixture with multiple extension actions and assert every action id plus its name/label and output profile appears in the list/output payload/rendering, while compact/default projections omit large schemas by default.
2. Stale-daemon error hinting: simulate the existing non-2xx extension failure path, especially a 404 under daemon/caller `eforgeVersion` mismatch with compatible API version, and assert the user-facing error includes the expected hint/remediation text without treating version mismatch alone as the failure.
3. Budget-aware list continuation: exercise list truncation/continuation behavior with more than 70 entries and a low host budget, and assert the response communicates returned/total/next offset continuation while preserving deterministic coverage of included action ids.

Validation:
- Run focused vitest targets for touched tests during development where useful.
- Run the required final validation commands from this plan before handoff.