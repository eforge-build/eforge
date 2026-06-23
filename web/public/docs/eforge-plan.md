---
title: eforge-plan
description: Optional first-party planning, backlog, recommendation, and revision extension for eforge.
---

# eforge-plan

`eforge-plan` is an optional first-party extension package around the eforge build-engine kernel. The kernel still consumes normalized build source and produces reviewed, validated code; `eforge-plan` owns planning-product workflows that help teams decide what build source to hand to the kernel.

The detailed, canonical product documentation lives in [`eforge/extensions/eforge-plan/README.md`](https://github.com/eforge-build/eforge/blob/main/eforge/extensions/eforge-plan/README.md). This page summarizes the public boundary for users browsing the docs site.

## What it adds

Install `@eforge-build/eforge-plan` when you want first-party planning UX in addition to direct prompt, PRD, or file builds:

- Project-local backlog capture, search, board rendering, epics, dependencies, and promotion, with direct compact agent operations (`search-items`, `get-item`, `get-epic`, `capture-item`, and `update-item`) and projection flags for smaller payloads (epics, lane counts, sections, lifecycle rows, dependencies, dependents, and body text remain opt-in or omittable where supported).
- Recommendation refresh and backlog curation workflows backed by daemon-owned agent tasks.
- A Console planning workstation for investigation-first planning and handoff.
- Session-plan creation, including one automatic apply attempt for eligible ready creation drafts, persistence of the task summary as a leading `## Executive Summary`, visible failed apply attempts, readiness checks, and handoff into ordinary eforge builds.
- Revise with AI workflows for existing flat session plans, including durable annotations and revision turns.

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

`eforge-plan` runs as trusted extension code in the daemon process. Its private planning state lives under `.eforge/storage/extensions/eforge-plan/`, including backlog records, recommendation models, backlog curation previews, planning task indexes, lifecycle traces, accepted-analysis baselines, and plan revision threads. Treat that directory as local/private project metadata.

Session plans created for handoff live under `.eforge/session-plans/` and are submitted to eforge as build source when ready. AI-created session plans preserve the task summary as a leading `## Executive Summary` before readiness dimensions. They are local and gitignored; committed build provenance is still the engine's artifact-branch PRD and plan records.

## Product semantics owned here

`eforge-plan` owns product-specific concepts that generic core and extension-platform docs intentionally do not describe in detail:

- `backlogCurationDraft` outputs from backlog curation tasks.
- Generated recommendations and recommendation freshness/staleness projection.
- `planRevisionTurn` output for Revise with AI, including answer-only and patch-bearing turns.
- Annotation-backed revision sessions and durable quote-context targets.
- Daemon-owned `ctx.agentTasks` execution boundaries: the extension owns product storage and apply semantics, including one-attempt workstation auto-apply for eligible ready `sessionPlanCreationDraft` tasks and summary-to-Executive-Summary persistence, while the daemon owns task records, status, cancellation, and sanitized results.
- Workstation routing, planning-entry contributions, and backlog promotion UX.

`eforge-plan` does not turn the daemon into a generic multi-turn chat runtime. Its planning and revision workflows are bounded extension UX built on daemon-owned single-shot tasks.

Use the canonical extension README for full action inputs, storage paths, workstation behavior, and revision workflow details.
