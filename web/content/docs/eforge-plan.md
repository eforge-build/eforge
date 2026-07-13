---
title: eforge-plan
description: Optional first-party planning, backlog, recommendation, and revision extension for eforge.
---

# eforge-plan

`eforge-plan` is an optional first-party extension package around the eforge build-engine kernel. The kernel still consumes normalized build source and produces reviewed, validated code; `eforge-plan` owns planning-product workflows that help teams decide what build source to hand to the kernel.

This public guide covers installation, the first planning handoff, storage and trust, host invocation, and the extension-owned workflow boundary. The package [`README.md`](https://github.com/eforge-build/eforge/blob/main/eforge/extensions/eforge-plan/README.md) is the exhaustive reference for action inputs and maintainer-level implementation details.

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

Extensions run as trusted, unsandboxed code in the daemon process. A project-local install does not require a team trust record. Each user must trust a committed project/team installation, and package changes invalidate the stored trust hash until it is reviewed and trusted again.

![The eforge-plan planning workstation showing an epic-grouped backlog, planning search, fresh recommendations, and parallel planning lanes.](/screenshots/eforge-plan-workstation.png)

*The sandboxed eforge-plan workstation brings backlog organization, cross-artifact search, recommendations, and planning handoff into Console.*

## What it adds

Install `@eforge-build/eforge-plan` when you want first-party planning UX in addition to direct prompt, PRD, or file builds:

- Project-local backlog capture, body-safe backlog item updates, SQL/FTS search, board rendering, epics, dependencies, and promotion, backed by canonical private SQLite rows, with direct compact agent operations (`search-items`, `search-planning-records`, `get-item`, `get-epic`, `capture-item`, and `update-item`) and projection flags for smaller payloads (epics, lane counts, sections, lifecycle rows, dependencies, dependents, selected search fields, and body text remain opt-in or omittable where supported). Compact item and detail projections include backend `planEligible` and eligibility reason/link fields. For title or section edits, callers read `bodySha256` with `get-item` and send it back as `expectedBodySha256` on `update-item`; metadata-only updates preserve body content and do not require that lock.
- Recommendation refresh and backlog curation workflows backed by daemon-owned agent tasks, with server-derived recommendation actionability dispositions, SQL lifecycle evidence, backend planning eligibility, and duplicate planning guards.
- A Console planning workstation for investigation-first planning and handoff, including a Backlog all-domain planning search panel and Roadmap store status/maintenance card backed only by extension actions.
- Session-plan creation, including one automatic apply attempt for eligible ready creation drafts, persistence of the task summary as a leading `## Executive Summary`, visible failed apply attempts, readiness checks with cache/Markdown freshness metadata, handoff into ordinary eforge builds, and resubmission of submitted or removed plans with terminal failed or removed queue/build evidence.
- Revise with AI workflows for existing flat session plans, including durable annotations and revision turns.
- Explicit local store import and maintenance actions for dry-run-first legacy import, status, dry-run-first retention compaction, FTS rebuild/optimize, and SQLite `VACUUM`.

These are extension-owned product semantics, not kernel behavior. The engine receives the resulting normalized build source the same way it receives a prompt, PRD file, playbook output, or wrapper-app artifact.

## Start a planning workflow

Confirm that the extension loaded, then discover its planning contribution:

```bash
eforge extension show eforge-plan
eforge extension contributions list --extension-name eforge-plan --search planning
eforge extension contributions show eforge-plan:open-planning-entry --kind command
```

Invoke the planning entry from the CLI, or open the contributed `eforge-plan:planning-workstation` from Console's Workstations surface:

```bash
eforge extension contributions invoke eforge-plan:open-planning-entry --kind command
```

The workstation investigates the change, drafts or resumes a Markdown session plan under `.eforge/session-plans/`, supports annotations and Revise with AI, and checks readiness before handoff. A ready session plan is submitted through the ordinary `/eforge:build` or `eforge build <path>` flow, so the kernel receives the same normalized build source as any other build. If a previously submitted plan has terminal failed or removed queue/build evidence, use the contributed `resubmit-session-plan` action to preserve the plan's identity and source provenance while creating a new handoff.

## Storage and trust boundary

`eforge-plan` runs as trusted extension code in the daemon process. Its private planning state lives under `.eforge/storage/extensions/eforge-plan/`, including the normalized SQLite store at `.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite`, backlog records, recommendation runs/models, backlog curation previews, planning task indexes, lifecycle evidence, accepted-analysis baselines, and plan revision threads. Treat that directory as local/private project metadata.

Runtime planning mutations write canonical SQLite rows for queryable metadata, provenance, item/plan joins, lifecycle timestamps, lifecycle evidence, search documents, and queue/build/session/landing links. Body-safe `update-item` writes canonical backlog rows, recomputes section rows, updates Markdown mirrors, marks search documents dirty, and marks recommendation metadata stale. FTS-backed `search-items` and `search-planning-records` return bounded ranked/snippet results, counts by type, pagination, selected refs, and dirty-index metadata rather than scanning legacy Markdown, recommendation JSON, or session-plan bodies. Dirty indexes are reported to callers; browser and host clients do not rebuild them implicitly. Markdown mirrors such as `.backlog/items/<id>.md` and `.eforge/storage/extensions/eforge-plan/backlog/items/<id>.md` are compatibility/import outputs, not normal mutation targets. Session plans created for handoff live under `.eforge/session-plans/` and are submitted to eforge as build source when ready; SQLite records metadata, canonical session-plan status, readiness summaries, readiness cache freshness/source indicators, submitted handoff/resubmit state, lifecycle timestamps, lifecycle projection reasons, and links, not the Markdown body as canonical content. Resubmission preserves the existing session-plan identity and source provenance while recording fresh submitted lifecycle evidence. AI-created session plans preserve the task summary as a leading `## Executive Summary` before readiness dimensions. They are local and gitignored; committed build provenance is still the engine's artifact-branch PRD and plan records.

### Retention and compaction

Planning-store maintenance is explicit local extension behavior. `get-store-status` reports whether the private SQLite store exists, file sizes, table counts, retention eligibility counts, FTS status, and recent maintenance runs without creating a missing store. `compact-planning-store` is dry-run-first and only applies when called with `dryRun: false`; it may compact prunable lifecycle event payloads, terminal planning-task raw payloads, and superseded non-current recommendation runs.

Compaction preserves canonical backlog items, epics, dependencies, session plans and joins, current lifecycle evidence summaries, current recommendation state, actionability projections, associated links, and duplicate-coverage policy. Optional JSONL archives are written under `.eforge/storage/extensions/eforge-plan/archives/maintenance/<runId>/` before mutation and are reported by path/count rather than returned inline. Search maintenance stays explicit through `rebuild-search-index` and `optimize-search-index`; SQLite file reclamation stays separate through `vacuum-planning-store`. The planning workstation surfaces these as bounded, explicit controls: dry-run compaction by default, explicit FTS rebuild/optimize buttons, and a confirmation step before vacuum.

## Host invocation

CLI, MCP, Claude Code, Pi, and other hosts should discover and invoke the same eforge-plan action IDs through generic extension contribution tooling. For direct backlog item edits, use `get-item` to read the current lock token and `update-item` with `expectedBodySha256`, `sections`, or `sectionOperations` rather than editing Markdown mirrors. Submitted or removed session-plan recovery uses `resubmit-session-plan` through the same generic action surface when terminal failed or removed queue/build evidence makes the plan recoverable. This module does not add dedicated host-specific commands for FTS search, lifecycle/actionability projections, body editing, or maintenance; use actions such as `get-store-status`, `search-planning-records`, `compact-planning-store`, `rebuild-search-index`, `optimize-search-index`, and `vacuum-planning-store` directly through the host's generic extension-action surface.

## Product semantics owned here

`eforge-plan` owns product-specific concepts that generic core and extension-platform docs intentionally do not describe in detail:

- `backlogCurationDraft` outputs from backlog curation tasks.
- Generated recommendations plus read-time freshness/staleness and actionability projections from current SQLite recommendation runs, canonical lifecycle evidence, and queue/build/session/landing links.
- `planRevisionTurn` output for Revise with AI, including answer-only and patch-bearing turns.
- Annotation-backed revision sessions and durable quote-context targets.
- Daemon-owned `ctx.agentTasks` execution boundaries: the extension owns product storage and apply semantics, including one-attempt workstation auto-apply for eligible ready `sessionPlanCreationDraft` tasks and summary-to-Executive-Summary persistence, while the daemon owns task records, status, cancellation, and sanitized results.
- Workstation routing, planning-entry contributions, and backlog promotion UX.

`eforge-plan` does not turn the daemon into a generic multi-turn chat runtime. Its planning and revision workflows are bounded extension UX built on daemon-owned single-shot tasks.

Use the package README for the exhaustive action-input reference and maintainer-level storage and workstation details.
