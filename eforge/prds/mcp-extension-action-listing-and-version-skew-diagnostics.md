---
title: MCP Extension Action Listing and Version-Skew Diagnostics
created: 2026-07-08
---

# MCP Extension Action Listing and Version-Skew Diagnostics

## Problem / Motivation

User feedback from the Claude Code MCP experience shows the current extension surfaces are losing or obscuring important information:

- `eforge_extension list/show` summarized away 71 action names when `actionDetails` was omitted.
- CLI `extension show` returned a misleading 404 during daemon/CLI commit skew while MCP/daemon saw the extension.
- `eforge_extension_contribution list` with `limit 80` truncated around entry `42/71` mid-line with no continuation cursor.

Source backlog evidence:

- Backlog item id: `mcp-extension-action-listing-version-skew-hardening`
- Title: MCP extension action listing and version-skew diagnostics
- Status at handoff: candidate
- Source epic evidence: No source epic linked.
- Recommendation context: selected source order was `1. backlog item mcp-extension-action-listing-version-skew-hardening: MCP extension action listing and version-skew diagnostics`.

## Goal

Implement MCP/Pi/CLI extension surfaces that enumerate extension actions through compact paginated projections, attach daemon-version mismatch hints to domain errors, and render contribution lists with entry-boundary continuation instead of mid-line host truncation.

## Approach

- Use the backlog evidence as the source of truth; keep implementation scoped to this item.
- Keep the kernel boundary intact: this is host/client/extension-management output behavior, not an engine scheduling feature.
- Reuse shared client formatting/projection utilities so Pi and Claude Code MCP stay aligned; avoid duplicating daemon wire shapes or route literals outside `@eforge-build/client`.
- Do not increase raw host output budgets to solve list truncation. Prefer budget-aware rendering that emits complete entries plus an explicit continuation offset.
- Preserve compact defaults: schemas and large diagnostics remain opt-in, but action ids/labels/output profiles must remain enumerable by MCP-only agents.
- Version-skew hinting should use the existing `/api/version` `eforgeVersion` signal and should not fail requests solely because package versions differ when the daemon API version is compatible.
- Source handoff noted missing assumptions: state key assumptions and validation risks before implementation.

Validation plan supporting the implementation:

- Add client projection tests showing extension management compact/detail projections retain every action id/name while omitting large schemas by default.
- Add contribution-output formatting tests with `>70` entries and a low host budget; assert output ends on an entry boundary and includes returned/total plus next offset.
- Add daemon/client or CLI/MCP error-formatting tests for a 404 extension response under daemon/caller `eforgeVersion` mismatch; assert the stale-daemon restart hint is present.
- Run `pnpm test`, `pnpm type-check`, and `pnpm maintainability:check` or the narrow equivalent justified by touched packages.

## Scope

### In scope

- Backlog scope item: `mcp-extension-action-listing-version-skew-hardening`.
- MCP-safe extension action listing/showing surfaces for `eforge_extension`.
- Guidance for MCP-only agents toward sanctioned contribution/list/show pagination.
- Non-2xx daemon/CLI extension error hinting for stale daemon/version skew.
- Budget-aware `eforge_extension_contribution list` rendering with entry-boundary stopping and continuation guidance.
- Regression tests for all-action-id preservation, stale-daemon error hinting, and budget-aware list continuation.

### Dependencies and constraints

- Depends on: No dependencies declared.
- Internal dependencies: None.
- External dependencies: None.
- Blockers: None declared.
- Risks: None declared.

### Explicitly out of scope

N/A (no explicit out-of-scope items were provided).

## Acceptance Criteria

The following author-explicit acceptance criteria were listed in both the top-level and item-specific acceptance sections; they are deduplicated here without semantic changes:

- `eforge_extension list/show` expose a MCP-safe action surface: all action ids/names are available through compact or paginated projections without raw CLI/HTTP JSON.
- `eforge_extension` guidance points MCP-only agents to sanctioned contribution/list/show pagination, not raw JSON/HTTP as the primary next step.
- Non-2xx daemon/CLI extension errors include a stale-daemon/version-skew hint when daemon `eforgeVersion` differs from the caller build, especially for 404 Extension not found.
- `eforge_extension_contribution list` never truncates mid-entry; if host budget is reached, it stops on an entry boundary and emits returned/total plus next offset/continuation guidance.
- Regression tests are added for all-action-id preservation, stale-daemon error hinting, and budget-aware list continuation.