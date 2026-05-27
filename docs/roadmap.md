# Eforge Roadmap

## Console Workbench

**Goal**: Make console-ui the canonical local-first control surface for planning, observing, configuring, and steering eforge builds while keeping the engine headless and harness integrations thin.

- **Planning Workspace** - First-class session-plan browsing, readiness, handoff visibility, structured editing, and later agent-assisted planning workflows centered on the session-plan artifact.
- **Actionable build control** - Queue management, retry/recovery, validation waivers, stack sync, and build lifecycle actions from the console.
- **Configuration and library surfaces** - Manage profiles, playbooks, scoped config, extensions, and model/runtime preferences through typed daemon/client APIs.
- **Thin integration strategy** - Reduce Pi and Claude Code integrations to launch, deep-link, status, and build entry points that reuse daemon/client primitives instead of duplicating rich workflow UX.

---

## Daemon & MCP Server

**Goal**: Extend the daemon as the single orchestration authority with richer controls and safety checks.

- **Queue reordering & priority** - MCP tool and web UI controls for changing priority on queued PRDs at runtime (priority field exists in frontmatter and affects execution order, but there's no way to modify it after enqueue)

---

## Overseer / Multi-project Observability

**Goal**: Provide a durable unified view across many eforge projects and daemons without moving orchestration out of project-local daemons. Schaake OS epic: `cf245870-90f4-48db-b5e7-b7a0f17a458b`.

- **Local overseer service** - Machine-local server that receives project daemon events, stores them durably, and shows all reporting projects/builds in one UI.
- **Overseer publishing protocol** - First-class daemon-side event publishing with project identity, authentication, retry, batching, idempotency, and privacy controls.
- **Cross-project usage analytics** - Aggregate token, model, cost, profile, queue, daemon health, and build-status metrics across projects.
- **Cloud-ready deployment path** - Protocol and configuration suitable for hosted/team overseer instances while preserving local-first operation.

---

## Extensibility

**Goal**: Make eforge a platform that agent runtime profiles and TypeScript modules can extend without forking the engine.

- **Native TypeScript extensions (deferred phases)** - `beforeEnqueue` and `beforeValidation` policy gates, approval workflow/state/UI, and `modify` policy decisions remain deferred. Shipped capabilities are documented in `docs/extensions.md` and `docs/extensions-api.md`.

---

## Stacked PRs

**Goal**: Polish the end-to-end stacked PR workflow and expand provider support.

- **Additional stack providers** - v1 supports only git-spice. Future providers (e.g. Graphite, manual git-based stacking) may be added here.

---

## Integration & Maturity

**Goal**: Full lifecycle coverage, CI support, provider flexibility.

- **Low-fidelity input handling** - When the user provides a high-level prompt with minimal detail, launch an exploration agent (or parallel exploratory agents) that performs thorough codebase exploration before compiling plans. Bypassed for detailed PRDs. Scope levels (expedition/errand/excursion) classify intended depth but don't perform exploration; this fills that gap.
- **Schema library unification on TypeBox** - TypeBox is canonical for eforge-owned domain schemas; Zod is isolated to third-party SDK compatibility adapters. The first migration slice (client wire schemas, engine structured output, and custom-tool contracts) is complete. Config, input artifact, and MCP proxy schemas remain Zod until a follow-up PRD lands.
- **TypeScript project references** - Adopt `tsconfig.json` `references` across workspace members for automatic topological ordering.
