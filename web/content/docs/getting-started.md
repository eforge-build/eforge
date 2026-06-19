---
title: Getting Started
description: Install eforge and run your first delegated build.
---

# Getting Started

eforge turns normalized build source into reviewed, validated code changes. For your first build, start directly from a prompt, PRD, or file path; optional workflow surfaces such as playbooks, session plans, and first-party planning extensions can prepare build source before it reaches the same kernel.

## Prerequisites

- **Node.js 22+**
- One of: [Pi](https://github.com/earendil-works/pi-mono), [Claude Code](https://claude.ai/code), or an npm-capable shell
- An LLM credential for the runtime you choose: a provider-specific API key or OAuth token for the recommended `pi` harness, or an Anthropic API key for the supported secondary `claude-sdk` harness

## Install

### Pi package (recommended)

Pi is the recommended harness for new users: you choose the providers, pay API prices directly, and keep orchestration local and inspectable.

```bash
pi install npm:@eforge-build/pi-eforge
/eforge:init
```

Add `-l` to write to project settings (`.pi/settings.json`) instead of your global Pi settings:

```bash
pi install -l npm:@eforge-build/pi-eforge
```

### Claude Code plugin

Use the Claude Code plugin if Claude Code is already your daily environment. Claude Code can host the workflow while your active profile executes builds through the recommended Pi harness.

Run these three commands inside Claude Code:

```
/plugin marketplace add eforge-build/eforge
/plugin install eforge@eforge
/eforge:init
```

The `/eforge:init` command creates `eforge/config.yaml` with sensible defaults and adds runtime-state entries such as `.eforge/` and `eforge/.active-profile` to your `.gitignore`. It walks you through a Quick setup (one harness/provider with suggested tier models, including an optional separate implementation model) or a Mix-and-match flow (different harness, provider, or model per tier). Choose Pi for the recommended provider-flexible path; `claude-sdk` remains available as a supported Anthropic-specific secondary path for users with Anthropic Claude Agent SDK credentials. Check your provider's current account and pricing terms before running large builds.

After initialization, run `/eforge:workflow` to choose the workflow preset for this repository. It writes the landing action, pull-request auto-merge policy, and stacking setup to `eforge/config.yaml`, including optional automatic stack sync for git-spice stacks.

### CLI

```bash
npx @eforge-build/eforge build "Add rate limiting to the API"
```

Or install globally: `npm install -g @eforge-build/eforge`

The CLI has no init command yet: run `/eforge:init` once in Pi or Claude Code to create `eforge/config.yaml` and an agent runtime profile. After that one-time setup, the CLI drives builds without either host - suited to scripting and automation.

## Your First Build

Once eforge is installed and initialized, enqueue directly with a prompt:

```
/eforge:build Add a dark mode toggle to the settings page
```

From the standalone CLI:

```bash
eforge build "Add a dark mode toggle to the settings page"
eforge build plans/my-feature-prd.md
eforge build ./docs/my-feature.md
eforge build --landing-action pr plans/my-feature-prd.md
```

The daemon normalizes the prompt, PRD, or file into build source, queues it, and runs the full pipeline in the background. Console at `http://localhost:<port>/console/` (port deterministically assigned per project in the 4567-4667 range) tracks progress, cost, and token usage in real time.

Use `--profile <name>` for a one-off agent runtime profile override, and `--landing-action pr|merge|leave` when one build should use a different landing action from `eforge/config.yaml`.

## Optional planning and workflow surfaces

Optional producers can prepare build source before the kernel sees it. [Playbooks](./playbooks) are reusable workflow artifacts: autonomous playbooks normalize to build source and enqueue a build, while planning-mode playbooks route to eforge-plan when that optional first-party extension is available. Optional first-party extension behavior is documented in the [eforge-plan guide](./eforge-plan).

When eforge-plan is loaded and trusted, hosts can discover and invoke its planning entry through extension contributions; from the standalone CLI, use `eforge extension contributions list` and `eforge extension contributions invoke eforge-plan:open-planning-entry --kind command`. Follow the [eforge-plan guide](./eforge-plan) for extension-owned handoff details; ready build source can still be submitted as a normal file build.

## What Happens Next

1. **Formatting** - eforge normalizes your input into a structured PRD.
2. **Acceptance criteria inventory** - enqueue canonicalizes acceptance criteria and rejects vague, unverifiable, or duplicate criteria before the build is queued. [Concepts](./concepts#the-queue-and-daemon) covers the full validation rules.
3. **Planning** - A planner agent assesses complexity and selects a workflow profile ([Errand, Excursion, or Expedition](./concepts#workflow-profiles)), then writes a detailed plan or set of plans.
4. **Building** - Builder agents implement each plan in isolated git worktrees, in parallel where the dependency graph allows.
5. **Review** - Blind reviewers evaluate each plan's output without builder context. A fixer applies suggestions; an evaluator accepts only strict improvements.
6. **Merge** - Completed plans merge back to your branch in topological order.
7. **Validation** - Post-merge validation runs your configured commands. On failure, a validation-fixer agent attempts repairs.

## Where to Look Next

- [Concepts](./concepts) - How the pipeline works, what blind review means, and what harnesses do
- [Configuration](./configuration) - The most important config options and how to tune them
- [Profiles](./profiles) - Create and switch agent runtime profiles that control harness, model, and effort
- [Playbooks](./playbooks) - Optional workflow artifacts that prepare build source for recurring work
- [eforge-plan](./eforge-plan) - Optional first-party extension behavior
- [Integrations](./integrations) - How to use eforge from Claude Code, Pi, the CLI, and external issue trackers
- [Troubleshooting](./troubleshooting) - Daemon startup, failed builds, and common error remedies
- [Glossary](./glossary) - Definitions for eforge-specific terms such as profiles, worktrees, and playbooks
- [CLI Reference](/reference/cli) - All CLI commands and flags
- [Configuration Reference](/reference/config) - Full `eforge/config.yaml` schema
