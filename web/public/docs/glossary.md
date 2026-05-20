---
title: Glossary
description: Definitions for eforge-specific terms used across the docs and agent-readable reference.
---

# Glossary

## Agent runtime profile

A named YAML file that selects the harness, model, and effort settings for eforge tiers. Profiles live at user, project, or project-local scope and can be switched without editing `eforge/config.yaml`. See [Profiles](/docs/profiles).

## Build source

The normalized input handed to the engine. It may originate from a CLI prompt, rough notes, a session plan, a playbook, a wrapper app, or a PRD file.

## Builder

The agent stage that implements a plan in an isolated worktree and commits the result.

## Compile phase

The once-per-build phase where eforge formats input, assesses complexity, chooses Errand/Excursion/Expedition, and writes the plan set and dependency graph.

## Daemon

The long-running background process that watches the queue, runs builds, exposes the HTTP API, and streams live events to the monitor and integrations.

## Errand, Excursion, Expedition

Workflow profiles selected by the planner. Errand handles small changes, Excursion handles multi-file work with plan review, and Expedition handles large decomposed work with architecture and cohesion review.

## Evaluator

The agent stage that judges proposed fixes against the original intent and accepts only strict improvements.

## Fixer

The agent stage that applies reviewer suggestions as candidate changes before evaluation.

## Harness

The agent execution backend used by a stage. eforge recommends `pi` for provider-flexible execution through pi-agent-core, and also supports `claude-sdk` as an Anthropic-specific secondary path through the Claude Agent SDK.

## Hooks

Fire-and-forget shell commands triggered by eforge events. Configured in `eforge/config.yaml` under `hooks`. See [Configuration - Hooks](/docs/configuration#hooks) and [Configuration Reference - Hooks](/reference/config#hooks).

## Input source

A TypeScript extension adapter that resolves `eforge://input/<adapter>/<id>` URIs into PRD content. Adapters fetch issues or PRs from GitHub, Linear, Jira, or any custom source. See [Extensions - Input sources and PRD enrichers](/docs/extensions#input-sources-and-prd-enrichers).

## Monitor

The web UI running locally at `http://localhost:<port>` (port range 4567-4667, deterministically assigned per project). Shows live build progress, token usage, cost, and queue management. See [Integrations - Monitor UI](/docs/integrations#monitor-ui).

## Playbook

A reusable Markdown workflow template for recurring work. Has a `mode` of either `autonomous` (enqueues a build directly) or `planning` (triggers investigation-first workflow). Optionally pins an agent runtime profile via a `profile` frontmatter field. See [Playbooks](/docs/playbooks).

## Planner

The agent stage that sizes work, chooses the workflow profile, and writes implementation plans. This is separate from the driver-side planning conversation exposed by `/eforge:plan`.

## PRD

Product Requirements Document. A PRD file is one supported input surface, but eforge can also accept prompts, notes, session plans, playbooks, and wrapper-app input.

## Queue

The committed `eforge/queue/` directory where normalized PRDs wait for daemon processing. Queue items can depend on earlier items.

## Recovery sidecar

A structured recovery analysis artifact written for a failed build plan. It records whether eforge should retry, split, abandon, or require manual intervention.

## Recovery verdict

The outcome of a recovery sidecar analysis: `requeue`, `enqueue-successor`, `archive`, or `manual`. Applied via `/eforge:recover` or `eforge_apply_recovery`. See [Troubleshooting - Recover from a failed build](/docs/troubleshooting#recover-from-a-failed-build).

## Reviewer

The blind review agent stage that evaluates a diff without the builder's reasoning or conversation context.

## Session plan

A driver-side planning artifact created by `/eforge:plan`. It captures scope, acceptance criteria, risks, and other dimensions before being converted into build source.

## Tier

A configuration slot such as `planning`, `implementation`, `review`, or `evaluation`. Tiers map agent roles to harness/model/effort settings.

## Toolbelt

A named declarative bundle of project MCP servers (from `.mcp.json`) that a tier can opt into via `toolbelt: <name>` in a profile. Filters project MCP access per tier without affecting engine tools or harness built-ins. See [Configuration - Guided Toolbelt Presets](/docs/configuration#guided-toolbelt-presets) and [Extensions API - Toolbelt-vs-extension boundary](/docs/extensions-api#toolbelt-vs-extension-boundary).

## Worktree

An isolated git working tree used to build an individual plan without blocking or contaminating other concurrently running plans.
