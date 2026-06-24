---
title: eforge-plan
description: Optional first-party planning, backlog, recommendation, and revision extension for eforge.
---

# eforge-plan

`eforge-plan` is an optional first-party extension package around the eforge build-engine kernel. The kernel still consumes normalized build source and produces reviewed, validated code; `eforge-plan` owns planning-product workflows that help teams decide what build source to hand to the kernel.

The detailed, canonical product documentation lives in [`eforge/extensions/eforge-plan/README.md`](https://github.com/eforge-build/eforge/blob/main/eforge/extensions/eforge-plan/README.md). This page summarizes the public boundary for users browsing the docs site.

## What it adds

Install `@eforge-build/eforge-plan` when you want first-party planning UX in addition to direct prompt, PRD, or file builds:

- Project-local backlog capture, SQL/FTS search, board rendering, epics, dependencies, and promotion, backed by canonical private SQLite rows, with direct compact agent operations (`search-items`, `search-planning-records`, `get-item`, `get-epic`, `capture-item`, and `update-item`) and projection flags for smaller payloads (epics, lane counts, sections, lifecycle rows, dependencies, dependents, selected search fields, and body text remain opt-in or omittable where supported).
- Recommendation refresh and backlog curation workflows backed by daemon-owned agent tasks, with server-derived recommendation actionability dispositions, SQL lifecycle evidence, and duplicate planning guards.
- A Console planning workstation for investigation-first planning and handoff, including a Backlog all-domain planning search panel and Roadmap store status/maintenance card backed only by extension actions.
- Session-plan creation, including one automatic apply attempt for eligible ready creation drafts, persistence of the task summary as a leading `## Executive Summary`, visible failed apply attempts, readiness checks, and handoff into ordinary eforge builds.
- Revise with AI workflows for existing flat session plans, including durable annotations and revision turns.
- Explicit local store import and maintenance actions for dry-run-first legacy import, status, dry-run-first retention compaction, FTS rebuild/optimize, and SQLite `VACUUM`.

These are extension-owned product semantics, not kernel behavior. The engine receives the resulting normalized build source the same way it receives a prompt, PRD file, playbook output, or wrapper-app artifact.

## Install

```bash
eforge extension install @eforge-build/eforge-plan
eforge extension validate eforge-plan
eforge extension reload
```

For a team/project install, inspect the package and use the normal extension trust flow:

```bash
eforge extension install @eforge-build/eforge-plan --scope project
# Inspect the installed package, then trust and reload it.
eforge extension trust eforge-plan
eforge extension reload
```

## Storage and trust boundary

`eforge-plan` runs as trusted extension code in the daemon process. Its private planning state lives under `.eforge/storage/extensions/eforge-plan/`, including the normalized SQLite store at `.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite`, backlog records, recommendation runs/models, backlog curation previews, planning task indexes, lifecycle evidence, accepted-analysis baselines, and plan revision threads. Treat that directory as local/private project metadata.

Runtime planning mutations write canonical SQLite rows for queryable metadata, provenance, item/plan joins, lifecycle evidence, search documents, and queue/build/session/landing links. FTS-backed `search-items` and `search-planning-records` return bounded ranked/snippet results, counts by type, pagination, selected refs, and dirty-index metadata rather than scanning legacy Markdown, recommendation JSON, or session-plan bodies. Dirty indexes are reported to callers; browser and host clients do not rebuild them implicitly. The `import-planning-store` action is the dry-run-first, one-time migration path for legacy private eforge-plan Markdown/JSON, session-plan, trace, queue, recommendation, planning-task, and monitor artifacts; use `{}` for the default dry run, `{ "dryRun": false }` to apply, and `{ "dryRun": false, "replaceExisting": true }` to replace only the eforge-plan SQLite files before import. Session plans created for handoff live under `.eforge/session-plans/` and are submitted to eforge as build source when ready; SQLite records metadata and links, not the Markdown body as canonical content. AI-created session plans preserve the task summary as a leading `## Executive Summary` before readiness dimensions. They are local and gitignored; committed build provenance is still the engine's artifact-branch PRD and plan records.

### Retention and compaction

Planning-store maintenance is explicit local extension behavior. `get-store-status` reports whether the private SQLite store exists, file sizes, table counts, retention eligibility counts, FTS status, and recent maintenance runs without creating a missing store. `compact-planning-store` is dry-run-first and only applies when called with `dryRun: false`; it may compact prunable lifecycle event payloads, terminal planning-task raw payloads, superseded non-current recommendation runs, verbose import reports, and import diagnostic details.

Compaction preserves canonical backlog items, epics, dependencies, session plans and joins, current lifecycle evidence summaries, current recommendation state, actionability projections, associated links, and duplicate-coverage policy. Optional JSONL archives are written under `.eforge/storage/extensions/eforge-plan/archives/maintenance/<runId>/` before mutation and are reported by path/count rather than returned inline. Search maintenance stays explicit through `rebuild-search-index` and `optimize-search-index`; SQLite file reclamation stays separate through `vacuum-planning-store`. The planning workstation surfaces these as bounded, explicit controls: dry-run compaction by default, explicit FTS rebuild/optimize buttons, and a confirmation step before vacuum.

## Host invocation

CLI, MCP, Claude Code, Pi, and other hosts should discover and invoke the same eforge-plan action IDs through generic extension contribution tooling. This module does not add dedicated host-specific commands for SQLite import, FTS search, lifecycle/actionability projections, or maintenance; use actions such as `import-planning-store`, `get-store-status`, `search-planning-records`, `compact-planning-store`, `rebuild-search-index`, `optimize-search-index`, and `vacuum-planning-store` directly through the host's generic extension-action surface.

## Product semantics owned here

`eforge-plan` owns product-specific concepts that generic core and extension-platform docs intentionally do not describe in detail:

- `backlogCurationDraft` outputs from backlog curation tasks.
- Generated recommendations plus read-time freshness/staleness and actionability projections from current SQLite recommendation runs, canonical lifecycle evidence, and queue/build/session/landing links.
- `planRevisionTurn` output for Revise with AI, including answer-only and patch-bearing turns.
- Annotation-backed revision sessions and durable quote-context targets.
- Daemon-owned `ctx.agentTasks` execution boundaries: the extension owns product storage and apply semantics, including one-attempt workstation auto-apply for eligible ready `sessionPlanCreationDraft` tasks and summary-to-Executive-Summary persistence, while the daemon owns task records, status, cancellation, and sanitized results.
- Workstation routing, planning-entry contributions, and backlog promotion UX.

`eforge-plan` does not turn the daemon into a generic multi-turn chat runtime. Its planning and revision workflows are bounded extension UX built on daemon-owned single-shot tasks.

Use the canonical extension README for full action inputs, storage paths, workstation behavior, and revision workflow details.
