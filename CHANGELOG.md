# Changelog

## [0.7.20] - 2026-05-19

Maintenance release

## [0.7.19] - 2026-05-19

### Bug Fixes

- **release**: use Node 24 for trusted publishing

## [0.7.18] - 2026-05-19

### Bug Fixes

- **release**: use npm 11 for trusted publishing

## [0.7.17] - 2026-05-19

### Bug Fixes

- **release**: publish without npm token config

## [0.7.16] - 2026-05-19

### Bug Fixes

- **release**: include extension sdk in lockstep versioning

### Other

- **core**: remove auth token (using trusted publisher)

## [0.7.15] - 2026-05-19

### Bug Fixes

- **docs-gen**: remove release version from generated docs

## [0.7.14] - 2026-05-19

### Features

- **add-profile-support-to-playbook-frontmatter**: Add optional playbook frontmatter profile support, propagate planning playbook profile metadata via session-plan agent_profile, and update consumer surfaces/docs.
- **consumer-surfaces-and-docs**: Consumer Surfaces and Documentation
- **core**: PRD Gap Close
- **core-profile-propagation**: Core Playbook Profile Propagation
- **generate-public-web-docs-and-audit-for-user-facing-gaps**: Audit public docs and fill user-facing gaps
- **investigation-first-planning-playbook-invocation-semantics**: Investigation-first invocation semantics for planning-mode playbooks: daemon run returns requires-agent, clients branch on mode, and skills document agent-led investigation before planning.
- **investigation-first-skills-docs**: Investigation-First Skills and Documentation
- **keep-public-documentation-synchronized-with-the-current-implementation**: Sync public documentation with current implementation
- **pi-eforge**: add native restart overlay
- **pi-eforge**: add native status overlay
- **pi-eforge**: show extension dialogs as overlays
- **playbook-run-contract**: Playbook Run Requires-Agent Contract
- **reconcile-scheduler-state-for-stale-queue-locks-and-phantom-running-capacity**: Runtime Queue Lock Reconciliation
- **surface-and-persist-selected-build-profile-in-monitor-ui**: Persist Session Profiles and Render Plan Tab Badge

### Bug Fixes

- **docs-gen**: drop volatile commit provenance
- **pi-eforge**: render side borders on overlays

### Refactoring

- **integrations**: remove follow tool

### Maintenance

- **playbooks**: replace docs sync workflow
- **playbooks**: set public docs audit profile
- **profiles**: add docs-heavy eforge profile

### Other

- **core**: remove stale build

## [0.7.13] - 2026-05-19

### Features

- **add-build-time-syntax-highlighting-for-docs-code-blocks**: Markdown pipeline with rehype-pretty-code syntax highlighting
- **add-extend-06-eforge-extend-authoring-ux-in-pi-and-claude-code**: Add /eforge:extend authoring skills and wiring
- **add-extension-discovery-config-and-loader**: Add native eforge extension discovery, configuration, loading, registry capture, diagnostics, and provenance tooling.
- **add-extension-packaging-and-install-support**: Add packaged native extension manifest, install/update/remove/promote/demote support, provenance, and parity across CLI, MCP, Pi, docs, and tests.
- **add-guided-toolbelt-ux-and-presets-for-least-privilege-mcp-configuration**: Add guided least-privilege MCP toolbelt presets to Pi profile creation, surface toolbelts in config viewing, and update public docs plus fallback skills.
- **add-mode-autonomous-planning-to-playbooks-bundle-first-planning-mode-playbook-complexity-hotspot-reduction**: Add `mode: autonomous | planning` to playbooks, introduce session-plan seed flow, rename `playbook/enqueue` → `playbook/run` with discriminated response, update CLI/MCP/Pi/skills, and bundle the first planning-mode playbook (`complexity-hotspot-reduction`) with its measurement tooling.
- **add-monitor-ui-agent-detail-observability-for-existing-agent-events-plus-deterministic-per-agent-activity-facts**: Add monitor UI agent detail observability: clickable agent lifespan bars open a deterministic-facts drawer (final result text, lifecycle/usage, warnings/retries/tool activity, plus per-agent git diffstat facts for reliably attributable mutating stages). Adds `agentId` to `agent:result` and introduces a new `agent:activity` event; the monitor UI reducer prefers `agentId` matching with a fallback for legacy logs. No LLM summarization is introduced.
- **add-profile-metadata-fields-toolbelts-02**: Add optional profile metadata fields (description, whenToUse, tags) to agent runtime profiles, surfaced through profile list/show/create across the daemon API, Claude Code MCP/skills, Pi tool/native commands, and documentation. Metadata is descriptive only and does not affect active profile selection or runtime behavior.
- **aggressively-migrate-eforge-owned-schemas-to-typebox**: Aggressively migrate eforge-owned domain schemas from Zod to TypeBox, starting with the first coherent slice: a shared TypeBox schema utility, the @eforge-build/client event/wire schemas, and the engine's structured-output schemas plus custom-tool harness adapters. Zod is retained only inside explicit third-party SDK compatibility adapters. Preserves JSON wire shapes via parity tests and bans new Zod imports outside an allowlist.
- **build-evaluator-enforcement**: Build Evaluator Enforcement and Reporting
- **cli-mcp-pi-docs-extension-test**: CLI, MCP, Pi, and Docs Extension Test Surface
- **client-events**: Migrate @eforge-build/client Event/Wire Schemas to TypeBox
- **compile-evaluator-parity**: Compile Evaluator Parity
- **consumers-and-docs**: Surface profile metadata in MCP, Pi, skills, and docs
- **core**: PRD Gap Close
- **daemon-supervisor-integration**: Daemon Runtime and Route Integration for Auto-Build Supervisor
- **docs-and-skills**: Trust Model Documentation and Skill Guidance
- **docs-examples**: Documentation and Examples for Extension Agent Tools
- **docs-gen**: Docs generator package and checked-in generated reference artifacts
- **document-ui-profile-using-playwright-mcp-toolbelt**: Document UI Profile Toolbelt (Playwright canonical example)
- **dynamic-perspective-contracts**: Dynamic Perspective Contracts and Schema Foundation
- **emit-auto-build-disabled-events-for-connected-monitor-ui-tabs**: Emit and Project Auto-build Disabled Events
- **engine-and-api**: Profile metadata schema, parsing, and daemon API
- **engine-daemon-extension-replay**: Engine and Daemon Extension Replay Harness
- **engine-schemas-and-custom-tools**: Migrate Engine Structured-Output Schemas and Custom-Tool Contracts to TypeBox
- **engine-trust-foundation**: Engine Trust Store, Hashing, and Loader Enforcement
- **enqueue-preprocessing-runtime**: Enqueue Preprocessing Runtime
- **evaluation-application-core**: Evaluation Application Core
- **event-contract-and-engine-emission**: Event contract changes and engine emission for per-agent detail observability
- **extend-01-extension-api-design-sdk-package**: Extension SDK package, example, and docs
- **extend-04-extension-management-surface-mvp**: EXTEND_04 Extension Management Surface MVP — add extension scaffold/new and reload management API, CLI, MCP/Pi tooling, explicit enablement state, tests, and docs on top of the existing list/show/validate surface.
- **extend-05-phase-1-extension-docs-and-examples**: Synchronize Extension Docs, Examples, and Validation
- **extend-07-extension-validation-and-replay-test-harness**: extension replay test harness
- **extend-08a-agent-prompt-context-extension-hooks**: Agent prompt/context extension runtime
- **extend-08b-extension-contributed-agent-tools-and-tool-availability**: Implement EXTEND_08B extension-contributed agent tools, per-run tool availability tuning, observability events, tests, and documentation updates.
- **extend-09-usage-aware-profile-router**: Deliver pre-build runtime execution of profile router extensions so queued PRDs without explicit profile overrides are routed at dispatch time with observable provenance, validation, fail-open semantics, and best-effort usage signals.
- **extend-11-successor-docs-issue-tracker-example-and-skill-updates**: Issue-Tracker Example, Docs, and Skill Updates
- **extend-12b-validation-provider-extension-point**: Wire extension-registered validation providers into the built-in `validate` build stage as a runtime-supported per-plan quality gate, with typed/legacy results, command-style alternative, provider-specific events, fail-closed timeout semantics, and coherent projections/UI/CLI/docs/example coverage.
- **extension-docs-and-reference**: Extension Documentation and Generated Reference
- **extension-input-contracts**: Extension Input and Enricher Contracts
- **extension-management-api**: Extension Management API, Scaffold Helper, and Reload Runtime
- **extension-management-surfaces-docs**: Extension Management CLI, MCP/Pi Tooling, and Documentation
- **extension-package-daemon-operations**: Daemon Extension Package Operations
- **extension-package-foundation**: Extension Package Manifest and Provenance Foundation
- **extension-package-surfaces-docs**: Extension Package CLI, MCP, Pi, and Documentation
- **extension-perspective-runtime**: Extension Reviewer Perspective Runtime
- **extension-runtime-foundation**: Extension Runtime Foundation
- **extension-tooling-surfaces**: Extension Tooling Surfaces
- **fix-auto-build-scheduler-capacity-overrun-and-claimed-lock-dependency-unblock**: Lock-Aware Queue Scheduler and Claimed-Skip Semantics
- **fix-auto-build-scheduler-pause-resume-after-a-failed-queued-build-so-parallelism-and-independent-queued-builds-continue-correctly**: Decouple auto-build pause from watcher abort and make re-enable deterministic
- **generalize-transient-transport-retry-handling-across-eforge-agents**: Evaluator Transient Transport Retry Policy
- **harden-extension-trust-model**: Harden committed project/team native extension trust with per-extension hash trust metadata, changed-extension blocking, management surfaces, docs, and tests.
- **harden-websocket-transport-retry-handling-for-planner-failures**: Harden WebSocket Close Transport Classification
- **implement-adaptive-reviewer-subset-selection**: Adaptive Review-Cycle Perspective Selection
- **implement-blocking-policy-gates**: Implement runtime-supported blocking policy gates for queue dispatch, plan merge, and final merge with typed SDK contexts, policy runtime, config, event schemas, engine integration, docs, examples, and tests.
- **implement-durable-daemon-scoped-event-persistence-for-live-monitor-queue-updates**: Durable Daemon Event Persistence for Live Queue Updates
- **improve-monitor-daemon-scheduler-fsm-card-reporting**: Scheduler FSM Card Reporting
- **improve-monitor-ui-decision-markers-by-positioning-decision-events-on-the-pipeline-timeline-and-adding-clearer-event-timeline-console-summaries**: Position decision events on the pipeline timeline and add event-card summaries
- **input-schema-and-helpers**: Input schema, planning-mode helpers, and existing playbook migration
- **make-monitor-ui-auto-build-toggle-safer**: Safer Monitor UI Auto-build Toggle
- **make-pi-transport-websocket-close-resilient**: Pi Transport Close Resilience
- **management-surfaces**: Daemon, Client, CLI, MCP, and Pi Trust Management
- **monitor-ui-agent-detail-drawer**: Monitor UI agent detail drawer and deterministic facts rendering
- **monitor-ui-fsm-card**: Monitor UI Scheduler FSM Status Card
- **no-start-client-helpers**: Add Non-Starting Client API Helpers
- **observability-docs-examples**: Observability, Management Surfaces, Docs, and Examples
- **pi-mcp-multi-build-status**: Pi Extension and MCP Proxy Multi-Build Status Awareness
- **pi-passive-daemon-usage**: Refactor Pi Extension to Passive Daemon Usage
- **pi-toolbelt-preset-ux**: Pi Guided Toolbelt Preset UX
- **plan-a-public-eforge-marketing-documentation-site-with-agent-readable-docs-and-drift-preventing-generated-references**: Public eforge.build marketing/documentation site with agent-readable docs and drift-preventing generated references derived from code-owned sources of truth (CLI, daemon API routes, event protocol, config schema, MCP tools, Pi/Claude integration skills). Plan-01 lands a deterministic `packages/docs-gen/` generator package with provenance-bearing outputs (Markdown + JSON schemas + curated `llms.txt` / concatenated `llms-full.txt`) checked into `web/content/` and `web/public/`, plus root `docs:generate` / `docs:check` scripts and a drift-prevention test. Plan-02 scaffolds the Next.js app at `web/`, wires it into the pnpm workspace, ships a minimal human docs shell with landing + getting-started/concepts/configuration + generated-reference index, exposes stable raw `/reference/*.md` and `/schemas/*.json` routes plus the agent-readable `/llms.txt` and `/llms-full.txt`, adds `docs:dev` / `docs:build`, links from README, and extends CI to fail on stale generated docs or a broken site build.
- **policy-gate-docs-examples-skills**: Policy Gate Documentation, Examples, and Integration Skill Updates
- **policy-gate-foundation**: Policy Gate SDK, Config, Events, and Runtime Foundation
- **prevent-pi-eforge-ambient-status-polling-from-auto-starting-the-daemon**: Prevent Pi eforge ambient status polling and all non-lifecycle Pi operations from auto-starting the daemon; add no-start client helper variants, refactor Pi calls, update docs, and add regression/static tests.
- **profile-ux-and-docs**: Profile UX surfaces, monitor rendering, and docs cleanup
- **recover-extend-03-typed-event-runtime-from-websocket-close**: Recover EXTEND_03 typed event extension runtime after a transient WebSocket close by preserving the landed native event runtime foundation and wiring onEvent dispatch into CLI, queue, daemon watcher, tests, and docs.
- **recover-native-event-runtime-foundation**: Recover Native Event Runtime Foundation
- **redesign-auto-build-queue-watcher-lifecycle-around-an-fsm-supervisor**: Redesign the daemon auto-build watcher lifecycle around a supervisor/FSM and expose the resulting scheduler health in the monitor UI.
- **reference-and-mirror-content**: Enrich Generated Reference Content and Raw Mirrors
- **rendered-anchors-and-link-check**: Add Rendered Anchors and Docs Link Checking
- **repair-public-docs-links-heading-anchors-and-reference-gaps**: Repair public docs heading IDs, generated config reference gaps, raw Markdown mirrors, llms manifest entries, profile-new skill links, and add docs link/anchor validation to docs checks.
- **resolve-tier-toolbelts-into-harness-mcp-config-and-expose-toolbelt-observability**: Resolve tier toolbelts into harness MCP config and expose toolbelt observability
- **run-summary-pending-plans**: Re-apply RunSummary Pending Plans and planning:complete Seeding
- **runtime-and-integration**: Profile router runtime, scheduler integration, usage provider, example, docs
- **runtime-and-observability**: Runtime MCP filtering and observability schema
- **runtime-reviewer-perspective-extension-point**: Promote registerReviewerPerspective from loader-only provenance to a runtime-supported, bounded review-cycle extension point with dynamic perspective identifiers, applicability rules, events, observability, examples, and docs.
- **runtime-wire-contract**: Runtime and Wire Contract for Extension Agent Tools
- **runtime-wiring-and-docs**: Runtime Wiring and Documentation
- **schema-utility**: Shared TypeBox Schema Utility Layer
- **sdk-and-wire-contracts**: Profile router SDK contracts, wire events, and recorder validation
- **skills-complexity-playbook-and-tooling**: Plugin skills, complexity-hotspot-reduction playbook, and complexity scan tooling
- **stabilize-run-summary-pending-plans-and-implement-pi-mcp-multi-build-status**: Stabilize the RunSummary `pending` plans wire change (re-apply plan-01 on top of current main) and implement Pi/MCP multi-build status awareness (plan-02).
- **supervisor-foundation**: Auto-Build Supervisor Foundation and Wire Contract
- **toolbelt-docs-skills-parity**: Toolbelt Preset Documentation and Skill Parity
- **toolbelts-03-add-mcp-toolbelt-schema-and-static-validation**: Toolbelt schema and static validation
- **update-eforge-docs-to-recommend-pi-harness-and-caveat-claude-agent-sdk-pricing**: Pi-first Docs and Setup Guidance
- **use-semantic-enqueue-events-for-auto-build-wake-and-live-queue-ui**: Semantic Enqueue Wake and Queue Projection
- **validation-provider-projections-ui-docs**: Validation provider projections, monitor UI, CLI, docs, and example extension
- **validation-provider-runtime**: Validation provider runtime, build-stage execution, and event schemas
- **web**: add Vercel analytics
- **web**: improve landing page positioning
- **web-site**: Next.js web/ public site, dev/build wiring, README and CI integration
- **wire-surface-and-mode-dispatch**: Daemon route rename, mode dispatch, MCP/Pi/CLI surface, and api-version bump

### Bug Fixes

- **core**: add .npmrc with ci=true to allow pnpm install without TTY
- **core**: regenerate docs artifacts to resolve drift check failure
- **core**: remove registerValidationProvider from config table description in extensions.md
- **core**: resolve TS2454 variable used before assignment in server.ts
- **core**: resolve validation failures
- **harden-review-evaluation-cycles**: type-check enriched cycle decisions
- **pi-eforge**: send follow updates as tool results
- **web**: build docs-gen dependencies for deployment

### Documentation

- **core**: refresh generated reference artifacts
- **extension-docs-examples-sync**: sync documentation with implementation
- **llms**: improve agent-readable documentation index
- **prd**: add extensibility and toolbelt proposals
- **prd**: clarify extension epic boundaries
- **profile**: add profile toolbelts design
- **roadmap**: prune shipped roadmap items
- **roadmap**: refresh roadmap and promote wrapper-app boundary to AGENTS.md
- **web**: add why eforge positioning page

### Maintenance

- **core**: remove tracked node_modules symlinks
- **deps**: bump workspace dependency versions
- **deps**: rename Pi packages from @mariozechner to @earendil-works
- **enqueue-preprocessing-runtime**: fix test issues
- **harden-review-evaluation-cycles**: align retry expectations after rebase
- **queue**: add EXTEND_03 recovery path
- **queue**: remove failed extension loader entry
- **queue**: revise stale PRD extend-11-runtime-input-transformers-and-prd-enrichers
- **queue**: revise stale PRD make-pi-transport-websocket-close-resilient
- **queue**: revise stale PRD repair-public-docs-links-heading-anchors-and-reference-gaps
- **queue**: revise stale PRD stabilize-run-summary-pending-plans-and-implement-pi-mcp-multi-build-status
- **safer-auto-build-toggle**: add tests
- **web**: stop tracking Next build output
- **web**: stop tracking TypeScript build info

### Other

- **core**: add favicon
- **core**: add link to llms-full.txt
- **core**: cleanup
- **core**: cleanup stale prd
- **core**: Ignore .vercel
- **core**: prepare for vercel deploy of docs
- **core**: remove failed build
- **core**: remove old failed build
- **core**: Remove recovered failed builds
- **core**: update failed build analysis
- **core**: update failure sidecars
- **core**: update failure sidecars with analysis
- **core**: upgrade deps
- **core**: Upgrade deps
- **extend-07-extension-validation-and-replay-test-harness**: mark manually salvaged
- **extend-09-usage-aware-profile-router**: unblock
- **extend-11-runtime-input-transformers-and-prd-enrichers**: enqueue successor extend-11-successor-docs-issue-tracker-example-and-skill-updates
- **extend-11-runtime-input-transformers-and-prd-enrichers**: integrate feature branch into successor base
- **extend-12a-continuation-runtime-catalog-review-execution-planning-guidance-ui-docs-and-examples**: failed - manual
- **extend-12a-support-custom-reviewer-perspectives**: enqueue successor extend-12a-continuation-runtime-catalog-review-execution-planning-guidance-ui-docs-and-examples
- **improve-monitor-daemon-scheduler-fsm-card-reporting**: failed - retry
- **improve-monitor-daemon-scheduler-fsm-card-reporting**: requeue per recovery verdict
- **improve-pi-eforge-footer-status-so-active-builds-and-plan-counts-are-accurate**: enqueue successor stabilize-run-summary-pending-plans-and-implement-pi-mcp-multi-build-status
- **make-pi-transport-websocket-close-resilient**: requeue with compile transport scope
- **web**: switch docs theme to black/green with Inter + JetBrains Mono

## [0.7.12] - 2026-05-07

### Features

- **core**: Add typed orchestrator-decision events to the eforge wire protocol, emit them at every build-phase orchestrator decision site, render them in the monitor UI, and keep the Pi extension passing them through cleanly. Build-phase only; plan-phase decisions deferred to a follow-up roadmap item.
- **core**: Auto-open session plan markdown on create and resume
- **core**: Decision-event wire protocol, engine helper, and reducer foundation
- **core**: Engine emission sites, monitor-UI rendering, and integration tests
- **core**: Per-build profile override via --profile flag (CLI + MCP) with PRD-frontmatter persistence
- **core**: Planning decision events: wire, engine, and UI
- **core**: PRD Gap Close
- **core**: Remove autoAcceptBelow severity filter from config, schema, engine, UI, and tests
- **core**: require assumption validation in session plans
- **core**: Scope per-reviewer hover to perspective-specific issues in monitor UI
- **core**: Two related review-cycle cleanups: (1) remove the unused autoAcceptBelow severity filter from config/schema/engine/UI/tests; (2) fix the monitor UI so each reviewer's hover shows only that reviewer's perspective-scoped issues while the fixer hover continues to show the merged-and-deduped set.

### Bug Fixes

- **core**: resolve validation failures

### Documentation

- **roadmap**: add Orchestrator Intelligence section
- **roadmap**: refine orchestrator decision events scope

### Maintenance

- **core**: remove failed-queue sidecars after manual recovery

### Other

- **core**: add scripts

## [0.7.11] - 2026-05-06

### Features

- **core**: Add a structured daemon:* event family (lifecycle, scheduler decisions, recovery, orphan reaping, auto-build, errors) plus a live-only heartbeat, and surface them in the monitor UI via a header status pill and activity drawer
- **core**: Auto-build slice in useEforgeEvents reducer
- **core**: Close spine AC shortfalls — lifecycle events, thinking format, regression gate
- **core**: Daemon event types + monitor emission + heartbeat transport
- **core**: Daemon run-state events for monitor live/snapshot parity
- **core**: Daemon SSE skip-history + UI re-seed on reconnect
- **core**: Daemon-events SSE endpoint and client primitive
- **core**: Delete invalidateOnEvent SSE-to-SWR bridge
- **core**: earlyOrchestration as the sole orchestration source
- **core**: Engine-owned structural fields in orchestration.yaml
- **core**: Event metadata registry
- **core**: Fix daemon liveness pill on first load and drop redundant connected indicator
- **core**: Fix Re-queue PRD no-op and post-restart sidecar regression
- **core**: Lifecycle events + Zod schemas
- **core**: Make events the single source of truth for eforge runtime state
- **core**: Migrate consumers to subscribeWithSnapshot and retire v18 mechanisms
- **core**: Monitor UI: daemon status pill and activity drawer
- **core**: Monitor UI: pipeline render-gate fix and validation-command timeline bars
- **core**: PRD Gap Close
- **core**: Pure-event reducer + acceptance gate
- **core**: Remove singleton state.json/event-log.jsonl persistence and make compile/build handoff deterministic
- **core**: Replace fs.watch with event-driven QueueScheduler
- **core**: Replace v18 daemon:resync-marker and on-connect heartbeat with a designed-in stream:hello SSE handshake primitive used uniformly by every SSE consumer (per-session and daemon-wide)
- **core**: Scheduler decision events with dedup
- **core**: Simplify the monitor UI's event-consumption architecture to two SSE subscribers (one per concern) backed by reducers, eliminating the SSE-to-SWR bridge that has been the source of recurring swimlane and orchestration bugs
- **core**: Single mutation entry point
- **core**: Single-source RunInfo / QueueItem / SessionMetadata / AutoBuildState
- **core**: Surface build-config validation failures and inject valid perspectives into planner prompts
- **core**: Synthesize earlyOrchestration on planning:complete and event-driven SWR revalidation
- **core**: Tighten review-perspective schema and surface parallel-reviewer failures
- **core**: useDaemonEvents hook + UI consumer migration
- **core**: W6 daemon mutation sweep and enqueue:complete typed-field cleanup
- **monitor-ui**: pack validation spans into shared lanes
- **status**: surface daemon vs CLI version mismatch in eforge_status

### Bug Fixes

- **core**: Remove auto-clear useEffect from monitor UI app.tsx
- **core**: resolve validation failures
- **core**: supply required schema fields in daemon-sse-handshake test
- **core**: update DAEMON_API_VERSION test expectation to v18
- **engine**: raise reviewer turn budget

### Documentation

- **core**: sync documentation with implementation
- **docs**: frame pipeline through harness engineering

### Maintenance

- **core**: drop stale plan-02 wiring tests that grep source-text rather than verify behavior
- **monitor-ui**: add gap-proof tests for orchestration data drop on planning:complete
- **queue**: revise stale PRDs for w6 mutation sweep, SSE replay, and re-queue regression

### Other

- **core**: improve pi extension status line
- **core**: make sidebar full vertical height
- **core**: update planning skills

## [0.7.10] - 2026-05-04

### Features

- **eforge-init**: accept local-scope existing profiles and discover via sentinel

### Documentation

- **core**: tighten README intro and refresh execution examples

## [0.7.9] - 2026-05-03

### Features

- **core**: Collapse eforge agent configuration to a single tier axis: each tier is a self-contained recipe of harness + model + effort; eliminates ModelClass, agentRuntimes, and engine-supplied defaults
- **core**: Correct doc drift in README and docs/
- **core**: Extract playbook and session-plan logic from engine into new @eforge-build/input package, and extract scope/path resolution into new @eforge-build/scopes package
- **core**: Per-model-class agent runtime wizard
- **core**: Session-plan tools and API: daemon HTTP routes, typed client helpers, MCP/Pi tools, and skill updates so /eforge:plan and /eforge:build use shared @eforge-build/input helpers
- **engine**: list Pi custom providers/models via ModelRegistry
- **engine**: Split doc-updater into doc-author and doc-syncer
- **monitor-ui**: Adopt SWR cache layer; delete useApi and refreshTrigger chain
- **monitor-ui**: Decompose reducer.ts into typed per-group handlers, split thread-pipeline god-file, apply React.memo, and add reducer tests with regression fixtures
- **monitor-ui**: Monitor UI debt cleanup: client-owned wire types, dead code removal, cast and frontmatter fixes
- **monitor-ui**: Surface tier and reviewer perspective on agent:start
- **pi-eforge**: Replace presets with session-aware Copy from <tier> options

### Bug Fixes

- **core**: rename Agent Runtime Profiles section to Backend Profiles in docs/config.md
- **core**: resolve validation failures
- **core**: resolve validation failures in skills-docs-wiring tests

### Documentation

- **core**: author documentation
- **core**: sync documentation with implementation
- **playbook**: add docs implementation sync playbook

### Maintenance

- **core**: fix stale skills-docs-wiring test assertions
- **deps**: bump yaml to 2.8.4 and zod to 4.4.2
- **deps**: update package dependencies
- **monitor-ui**: add perspective coverage

## [0.7.8] - 2026-04-30

### Features

- **core**: Add commitEnqueuedPrd helper and adopt at both enqueue paths
- **core**: Add project-local config tier (.eforge/) to eforge
- **core**: Add Welcome Section to Init Skills
- **core**: Cancel button confirmation + global pointer cursor
- **core**: CLI and MCP proxy exit handlers
- **core**: CLI: eforge playbook commands and eforge play shortcut
- **core**: Close plugin/Pi parity gaps and extend parity script
- **core**: Daemon HTTP routes, client helpers, and MCP tool registration
- **core**: Decouple failed-PRD discovery from session state
- **core**: Disable auto-build on first failed queue:prd:complete
- **core**: Engine: generalized set-artifact resolver and playbook API
- **core**: Isolate user-tier config in vitest via XDG_CONFIG_HOME
- **core**: Phase 2: piggyback scheduling and queue-list nesting
- **core**: PRD Gap Close
- **core**: Skills: /eforge:playbook handheld UX in Claude Code plugin and Pi extension
- **core**: Structured plan-review fix submissions
- **eforge-playbooks**: add plugin/pi parity audit playbook
- **eforge-playbooks**: Codify recurring change shapes as named, three-tier playbooks (user / project-team / project-local) invokable via a handheld /eforge:playbook skill, CLI, and daemon HTTP. Phase 1 ships authoring + direct invocation; Phase 2 ships piggyback scheduling so a playbook auto-fires after a chosen build completes.
- **engine**: raise planner maxTurns default to 80

### Bug Fixes

- **core**: disable FK enforcement in DatabaseSync to allow daemon-level events
- **core**: resolve validation failures

### Maintenance

- **core**: post-parallel-group auto-commit

## [0.7.7] - 2026-04-29

### Bug Fixes

- **config**: strict schema validation; reject modelClass-keyed agents.tiers

## [0.7.6] - 2026-04-29

### Maintenance

- **profile-wiring**: floor plugin version assertion at 0.16.0

## [0.7.5] - 2026-04-29

### Maintenance

- **release**: rewrite plugin MCP proxy pin in lockstep with version

## [0.7.4] - 2026-04-29

Maintenance release

## [0.7.3] - 2026-04-28

### Features

- **consumers**: Rewrite init skill and tool API around multi-runtime profile input
- **core**: PRD Gap Close
- **fix-daemon-profile-routes-to-honor-user-scope-when-no-project-config-exists**: Daemon profile routes fall back to user scope when no project config
- **fix-eforge-init-fresh-project-bootstrap-ordering-bug**: Fix eforge_init fresh-init ordering across both consumers
- **fix-recovery-split-successor-prd-spurious-blocked-by-dependency**: Fix spurious depends_on on split-recovery successor PRDs
- **foundation**: Generalize createAgentRuntimeProfile, daemon route, API version
- **improve-eforge-init-quick-path-smarter-tier-defaults-per-harness**: Tier-aware Quick path in both init skills
- **offer-existing-user-scope-profiles-in-eforge-init**: Offer existing user-scope profiles in /eforge:init
- **redesign-eforge-init-around-multi-runtime-profiles**: Redesign /eforge:init around multi-runtime profiles: skill drives all elicitation, eforge_init becomes a pure persister, users pick quick (single-harness) or mix-and-match (per-tier) setup, and the engine helper accepts richer multi-runtime input.
- **replace-backend-with-harness-across-the-eforge-mcp-http-skill-stack**: Rename backend → harness across MCP, HTTP, client types, engine helpers, and skills
- **sharded-builds-always-go-through-review-cycle-with-a-new-verify-perspective**: Verify perspective + coordinator rewire to review-cycle

### Bug Fixes

- **core**: change agents.tiers schema key from AgentTier to ModelClass
- **core**: resolve validation failures
- **core**: update stale test expectations after backend→harness rename
- **engine**: prepend postMergeCommands to shard verification

### Maintenance

- **daemon-recovery**: drop brittle DAEMON_API_VERSION assertion
- **deps**: bump pi-* to 0.70.6 and claude-agent-sdk to 0.2.122
- **verify-perspective-and-coordinator-rewire**: fix test issues

## [0.7.2] - 2026-04-28

### Features

- **core**: Close the recovery UX loop: add engine `applyRecovery()` with verdict dispatch (retry/split/abandon/manual), wire it through the daemon, shared client, and MCP/Pi tools, then add a `/recover` skill in both the Claude Code plugin and Pi extension plus verdict-specific action buttons inside the monitor UI's existing recovery sheet.
- **core**: PRD Gap Close
- **engine**: Engine applyRecovery + Daemon Route + MCP/Pi Parity
- **engine**: Inline atomic recovery sidecar + resilient recover()
- **engine**: Move Pi `provider` from per-model refs (`agents.models.<class>.provider`) to the agentRuntime entry (`agentRuntimes.<name>.pi.provider`). Hard removal of `provider` from `modelRefSchema`; required for `harness: pi` runtimes via schema-time `superRefine`.
- **engine**: Schema, resolver, and inline test fixtures
- **engine**: Sharded implement stage with stash-based per-shard retry
- **monitor-ui**: session:profile event end-to-end + inspectable profile badge
- **monitor-ui**: Surface planner output and persist plan strategy
- **plugin**: /recover Skill (Plugin + Pi) and Monitor UI Verdict Action Buttons
- **plugin**: Adaptive /eforge:plan workflow and /eforge:build readiness updates
- **plugin**: Skill doc updates and plugin version bump

### Bug Fixes

- **core**: handle session:profile event in CLI display switch
- **engine**: restore node:sqlite prefix stripped by esbuild
- **test**: provide StubHarness to EforgeEngine.create in apply-recovery tests

### Maintenance

- **engine**: fix test issues

## [0.7.1] - 2026-04-25

### Maintenance

- **deps**: bump pi-* packages to 0.70.2 (clears uuid <14 advisory GHSA-w5hq-g745-h8pq)

---
For older releases, see [GitHub Releases](https://github.com/eforge-build/eforge/releases).
