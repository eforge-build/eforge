# Changelog

## [0.8.1] - 2026-07-12

### Bug Fixes

- **release**: remove stale exact-version assertions from host-surface tests
- **release**: run the full test suite on version-bumped release PRs
- **release**: preserve complete changelog sections in GitHub Release notes

This release supersedes the incomplete `v0.8.0` publication.

## [0.8.0] - 2026-07-12

### Features

- **accept-success-recovery-backend**: Accept Build as Successful Backend Recovery Action
- **acceptance-evidence-model**: Acceptance Evidence Inventory and Policy Foundation
- **acceptance-guidance-diagnostics**: Acceptance Criteria Guidance and Inconclusive Validation Diagnostics
- **acceptance-recovery-evidence**: Enrich Acceptance Validation Recovery Evidence
- **acceptance-unknown-resolution**: Acceptance Unknown Resolution
- **actionable-planning-playbooks**: Make Planning Playbooks Produce Actionable Session Plans
- **activity-contract-daemon-core**: Activity Log Contract and Daemon Append Flow
- **adapter-foundation**: SDK Storage Helper and Session Planning Adapter Foundation
- **add-shared-landing-gate-ux-for-autonomous-playbook-runs**: Add shared landing-gate UX for autonomous playbook runs and propagate playbook onSuccess through daemon/API/tool surfaces.
- **agent-docs-and-guidance**: Agent workflow docs and guidance for body-safe updates
- **agent-maintainability-policy**: Add LLM-Friendly Code Policy and Ratchet
- **agent-retry-pipeline-tests**: Split Agent Wiring, Retry, and Pipeline Tests
- **agent-task-contracts-engine-runner**: Shared Agent Task Contracts and Engine Runner
- **agent-task-contribution-contract**: Agent Task Contribution Contract
- **ai-first-workstation-ux**: Replace Backlog Promotion UI with AI-first Workstation Flow
- **analyze-all-evidence-integration**: Analyze-All Evidence Integration and Recommendation Overlay
- **annotation-backend**: Persist annotation state, snapshot annotations into revision turns, include them in source context, and auto-resolve after successful patch applies.
- **annotation-workstation**: Add rendered plan annotation capture, fallback controls, unresolved annotation management, and sticky annotation-driven revision UX.
- **api-cli**: Resume API, Daemon, and CLI Surfaces
- **artifact-aware-queue-base-resolution**: Artifact-Aware Queue and Stack-Aware Base Resolution
- **artifact-hot-path**: Remove Rich Board Payload From Workstation Artifact Load
- **artifact-registry-dependencies**: Provider-Neutral Artifact Registry and Dependency Readiness
- **artifact-validation**: Fail closed by validating required compile artifacts before reporting compile success, including expedition module completeness.
- **authoritative-acceptance-recovery**: Preserve Authoritative Acceptance Validation Recovery Evidence
- **backend-planning-state**: Backend Live Coverage and Readiness Projection
- **backend-validation-and-apply**: Backend Dependency Projection and Curation Apply Validation
- **backlog**: add browser status and priority pickers
- **backlog**: add interactive browser and split extension
- **backlog**: add local epic support
- **backlog**: add portable HTML backlog view
- **backlog**: add structured recommendations output
- **backlog-curation-prompts-and-engine-removal**: Backlog Curation Contributions and Engine Removal
- **backlog-query-projections**: eforge-plan Backlog Query Projection Controls
- **base-sync-events-contract-cli**: Base-sync event contract, CLI rendering, and import discipline
- **blocked-dependent-failure-semantics**: Blocked Dependent Failure Semantics
- **body-safe-update-action**: Body-safe update-item action and canonical storage
- **bound-recovery-analyst-context**: Bound Recovery Analyst Prompt Context
- **boundary-docs-validation**: Add source-wide boundary tests, enabled/disabled extension coverage, Console contribution coverage, and update architecture/public/generated docs.
- **boundary-removal**: Remove direct playbook daemon/client/workflow-adapter surfaces and update route/client tests to assert extension-owned boundaries.
- **bounded-agent-execution**: Add bounded unit prompt/source/compact-handoff support to planner-family agent runners and inspection helpers.
- **branch-aware-landing**: Branch-aware landing: trunk policy, non-trunk PR-after-local-merge, cleanup-before-PR
- **branch-aware-landing-and-queue-provenance-split-for-eforge-builds**: Rework eforge successful-build landing to be branch-aware, move runtime queue state to .eforge/queue, replace enqueue commits with a temporary PRD provenance artifact on the eforge work branch, and add an explicit solo-dev opt-in for local trunk merge.
- **branding-fonts-label-foundation**: Branding, Fonts, Tokens, and Label Foundation
- **broad-action-diagnostics**: Structured Broad Action Diagnostics
- **build-artifact-provenance**: Build Artifact Provenance Links
- **build-dependency-core**: Build Dependency Handoff Core Plumbing
- **build-detail-base**: Build detail route with Log tab and ported pipeline
- **build-detail-tabs**: Build detail Changes, Graph, and Plan tabs
- **builder-discovery-continuation**: Builder Discovery-Only Continuation
- **canonical-ac-inventory**: Canonical Acceptance Criteria Inventory
- **canonical-write-paths**: Move eforge-plan mutation paths to SQLite repositories while keeping session-plan Markdown as build artifacts and centralizing duplicate planning suppression.
- **cap-pi-planner-output-reserve**: Cap Pi Planner Output Reserve
- **changedfiles-extension-contexts**: Propagate changedFiles into extension contexts
- **claude-sdk**: disable subagents by default
- **claude-socket-transport-classifier**: Classify Claude SDK Socket Closures as Transient Transport
- **cleanup-marker-stripping**: Cleanup Marker Stripping
- **cli-event-renderer**: Decompose CLI Event Rendering
- **client-contracts**: Add client-owned workstation bundle manifest schemas, route constants, browser exports, and daemon API version bump.
- **client-contracts**: Client-owned wire contracts, route constants, helpers, event/snapshot schemas, queue capability types, failed-enqueue types, and API version bump.
- **client-engine-task-contract**: Add the shared planRevisionTurn task result contract, engine submit/prompt handling, monitor metadata counting, and client/engine contract tests.
- **client-event-tests**: Split Client Event Schema and Wire Parity Tests
- **client-host-output**: Shared Client Host Output and Extension Management Projections
- **client-profile-contract**: Profile route/type source-of-truth contract
- **client-surfaces-and-console**: Client Surfaces and Console Stack Sync Visibility
- **client-traceability-contract**: Client Event Traceability Contract
- **committed-work-artifact-safety**: Committed Work Enforcement and Artifact Safety
- **compact-list-actions**: Compact Paginated eforge-plan List Actions
- **compact-pagination-hot-path**: Harden Compact Board Pagination Hot Path
- **compact-workstation-reads**: Compact Workstation Board Reads
- **compile-orchestration-synthesis**: Route bounded-decomposition compile runs through the controller, schedule unit planning, and synthesize existing compile artifacts.
- **compile-resilience**: deterministic cross-artifact cohesion validation
- **compiled-resume-policy-context**: Expose Compiled Resume Metadata in Queue Dispatch Policy Context
- **complete-ac-quality-gate**: Complete Acceptance Criteria Quality Gate
- **concise-recovery-sidecar-contract**: Concise Recovery Sidecar Contract and Consumers
- **config-and-trunk-resolution**: Config foundation: trunk branch policy and .eforge/queue default
- **config-profile-stack-routes**: Create registered route modules for health/version/project context, config, profiles, models, stack layers, and stack sync/status.
- **config-profile-tests**: Split Config and Profile Wiring Tests
- **conservative-test-thinning**: Conservative Test Thinning
- **console**: dismiss failed enqueue warnings
- **console-command-palette**: Console Command Palette Foundation
- **console-contribution-rendering**: Render declarative extension Console contributions in the System route and invoke bound actions through browser-safe client helpers.
- **console-direct-base-sync-lanes**: Pipeline lane labels for base-sync and merge-resolver activity
- **console-direct-base-sync-selectors**: Console selector labels for direct base-sync recovery
- **console-extension-management**: Console Extension Management Surface
- **console-failed-queue-cleanup**: Console Failed Queue Cleanup Controls
- **console-level-terminology**: Console Reduce Level Terminology
- **console-linked-traces**: Console Linked Review-Cycle Traces
- **console-override-control**: Console Dependency Override Control
- **console-plan-set-browsing**: Console Plan-Set Browsing
- **console-plans-route-removal**: Remove the Core Console Plans Route
- **console-plans-workspace**: Console Plans Workspace UI
- **console-queue-controls**: Console Queue Priority and Removal Actions
- **console-queue-recovery-workflow**: Console Queue Recovery Workflow
- **console-recovery-completion-ux**: Console Recovery Completion UX and Queue Preview
- **console-recovery-ui**: Console Recovery Dialog and Actions
- **console-resolved-status**: Console Accepted-Success Resolved Status Display
- **console-review-fix-stage**: Console Review-Fix Stage Mapping
- **console-surface**: Remove the core Console Playbooks System section and rely on eforge-playbooks extension Console contributions or workstation entries for playbook management.
- **console-ui**: add active build plan swimlane
- **console-ui**: add map/reduce orchestration board
- **console-ui**: add map/reduce orchestration summary view
- **console-ui**: add rich tooltip to Now dashboard duration bars
- **console-ui**: add Storybook with shared test factories
- **console-ui**: add token and dollar spend card to Now dashboard
- **console-ui**: animate eforge logo during active builds
- **console-ui**: consolidate Now dashboard and add data visualizations
- **console-ui**: improve active build progress cards
- **console-ui**: improve build detail plan rows and preview
- **console-ui**: refine Now dashboard active-build cards
- **console-ui**: streamline spend card breakdown
- **console-ui**: surface gap-close lanes in plan swimlane
- **console-ui**: visualize stacked queue dependencies
- **console-ui-lane-registry**: console-ui: single lane registry and phase-lane consumers
- **console-ux**: Now dashboard failed-enqueue attention, re-enqueue UX, held/capability-driven queue controls, scheduler pause/resume, and cascade preview confirmations.
- **console-workstation-rendering**: Render srcDoc and frameBundle workstations in sandboxed iframes and preserve bridge validation semantics.
- **console-workstations-ui**: Console Workstations Route and Iframe Action Bridge
- **consolidate-playbook-test-matrices**: Consolidate Playbook and Command Test Matrices
- **consumer-parity**: Pi and Claude Consumer Parity
- **consumer-surfaces**: Reconcile CLI MCP Pi and Claude Consumer Surfaces
- **consumer-surfaces-docs**: Consumer Surfaces and Documentation
- **context-recovery**: Classify provider/proactive context failures and route capped retry-as-expedition or bounded-decomposition guidance.
- **continuation-split-recovery**: Continuation-aware split recovery
- **continue-repair-recovery**: Continue-and-Repair Recovery Refactor
- **contracts-config**: Define client-owned decomposition event/failure schemas and engine config defaults for planning-unit budgets and parallelism.
- **contracts-config-docs**: Contracts, default-off config, docs
- **contribution-output-profiles-validation**: Contribution Output Profiles and Validation Warnings
- **control-monitor-routes**: Create registered route modules for control-plane, recovery/resume, queue recovery, monitor data, run details, plans, diffs, and SSE attach routes.
- **control-plane-profile-routes**: Extract Control-Plane and Profile Route Groups
- **core**: add backlog extension and console pipeline fixes
- **core**: PRD Gap Close
- **core-daemon-stack-sync**: Core Daemon-Owned Stack Sync
- **core-engine-auto-merge**: Core Config, Wire Events, and Engine PR Auto-Merge
- **core-queue-control**: Core Queue Control API, Engine Helpers, and Scheduler Reconciliation
- **curation-milestones**: Backlog Curation Source and Map/Reduce Milestones
- **curation-packets-cache**: Backlog Curation Packets and Item Audit Cache
- **curation-workflow**: Analyze-all backlog curation backend actions, workflow purpose, source fingerprints, validation-first apply, and recommendation freshness.
- **daemon-action-routes**: Add daemon manifest and action invocation routes, typed action lifecycle events, route security, and route/event regression coverage.
- **daemon-cli-aliases**: Add daemon lifecycle CLI aliases
- **daemon-client-resume-api**: Daemon and Client Queued Resume API
- **daemon-dependency-override**: Daemon Dependency Override API
- **daemon-integration-docs**: Daemon Service Adapter Integration and Documentation
- **daemon-map-reduce-integration**: Daemon Map/Reduce Orchestration and Compatibility
- **daemon-routes-projections**: Monitor routes, recorder/projection changes, auto-build pause/resume wiring, failed-enqueue re-enqueue, queue capability projection, and snapshot/live parity.
- **daemon-task-service-extension-api**: Daemon Task Service and Extension Action API
- **decomposition-core**: Implement pure decomposition graph, coverage assignment, recursive splitting, budget derivation, and safe scheduling helpers.
- **deps-and-shadcn**: Add dependencies and shadcn primitives
- **deterministic-recovery-verdicts**: Deterministic Recovery Verdicts and Analyst Validation
- **deterministic-timer-tests**: Replace Timer-Heavy Tests with Deterministic Synchronization
- **dev**: add event tail commands
- **direct-base-sync-budget-config**: Direct base-sync budget configuration
- **direct-base-sync-budget-flow**: Direct base-sync fixed budget flow
- **direct-epic-reference-validation**: Direct Epic Reference Validation
- **direct-pr-base-sync**: Direct PR Base Sync and Freshness Guard
- **direct-pr-landing**: Replace Non-Trunk PR Aggregation with Direct PR Landing
- **docs-and-dogfood-config**: Update Documentation Generated References and Dogfood Config
- **docs-and-examples**: Update extension, SDK, Console, and generated public docs for srcDoc versus frameBundle workstation authoring boundaries.
- **docs-and-generated-reference**: Docs, Skills, Generated Config Reference, and Plugin Parity
- **docs-and-regression-guards**: Update user/reference docs and add final boundary, planning-dependency, extension-unavailable, package-registration, and cross-host regression guards.
- **docs-and-workflow-guidance**: Documentation and Workflow Guidance
- **docs-assets-validation**: README contract updates, generated workstation assets, drift guards, and final validation alignment.
- **docs-boundary-and-eforge-plan-docs**: Refocus public docs/nav/manifest on the kernel boundary, move eforge-plan product semantics into optional first-party extension docs, and add allowlist-based docs boundary tests without regenerating artifacts.
- **docs-examples-compat**: Update docs, SDK README, examples, generated references, and compatibility guidance for shipped and deferred extension platform seams.
- **docs-integration-vocabulary**: Docs, Skills, and Landing Vocabulary Alignment
- **docs-llm-authoring**: Documentation, LLM Artifacts, and Migration Guidance
- **docs-reference-boundary**: Update eforge-plan and shared extension docs/reference artifacts, preserve generic chat boundary language, and perform Pi/Claude integration-surface parity check.
- **docs-semantics**: Validation Provider Recovery Documentation
- **docs-skills-generated-references**: Docs, Skills, and Generated References
- **docs-sweep**: Console UI README and AGENTS.md sweep
- **docs-validation**: Console/client documentation updates and final validation alignment for the new recovery and queue-control UX.
- **dogfood-docs**: Dogfood Extension Storage Convention and Update Docs
- **durable-recovery-applied-state**: Durable Recovery Applied State and Split Idempotency
- **efficiency-analytics-foundation**: Efficiency Metrics Contracts and Historical Aggregation
- **eforge-dev**: include maintainability in dev checks
- **eforge-dev-safe-panels**: Project-local eforge-dev safe panels
- **eforge-plan**: add backlog item drawer and compact board cards
- **eforge-plan**: add compact backlog query actions
- **eforge-plan**: add live daemon workstation dev script
- **eforge-plan**: add PlanDetailWorkspace storybook story
- **eforge-plan**: add React workstation dev app
- **eforge-plan**: add routed backlog workstation views
- **eforge-plan**: add session plan deletion
- **eforge-plan**: add workstation storybook
- **eforge-plan**: auto-apply plan revision patches
- **eforge-plan**: contextual annotation affordances for plan sections
- **eforge-plan**: editable convergence — draft plan units (Slice 3)
- **eforge-plan**: editable convergence — merge/split + dependency advisor (Slice 3b)
- **eforge-plan**: enforce session-ready backlog captures
- **eforge-plan**: harden promote-to-build-plan workflow
- **eforge-plan**: improve backlog analysis progress view
- **eforge-plan**: improve planning workflow readability
- **eforge-plan**: polish planning workstation UI
- **eforge-plan**: redesign the plan review rail UX
- **eforge-plan**: refine workstation planning UI
- **eforge-plan**: reflect running curation in analyze trigger
- **eforge-plan**: report backlog curation progress
- **eforge-plan**: retire legacy Pi backlog surface
- **eforge-plan**: select recommendations in backlog
- **eforge-plan**: simplify backlog analysis UX
- **eforge-plan**: strengthen backlog curation audits
- **eforge-plan**: structured plans workstation view
- **eforge-plan**: unify planning workstation (continuum, lens, context rail)
- **eforge-plan-ai-workstation-flow**: eforge-plan AI Planning Actions and Workstation Flow
- **eforge-plan-annotation-revisions**: Audit and close any remaining eforge-plan annotation-driven Revise with AI gaps in private storage, actions, source-context snapshotting, workstation UI, and tests while preserving existing extension-owned behavior.
- **eforge-plan-cleanup**: Clean Removed Queue Coverage in eforge-plan
- **eforge-plan-foundation**: Eforge Plan Foundation: Storage, Domain, Kanban, and Trace
- **eforge-plan-profile-options-action**: Read-only eforge-plan profile options action
- **eforge-plan-registration**: Eforge Plan Promotion, Lifecycle, Registration, and Docs
- **eforge-plan-task-workflows**: Add eforge-plan Durable Task Workflows and Creation Draft Apply
- **engine-acceptance-gates**: Engine Acceptance Gate Enforcement
- **engine-build-single-prd**: Extract Queued PRD Build Phases
- **engine-contract**: Model-Aware Pi Compile Guard and Event Contract
- **engine-item-audit-reducer**: Engine Item Audit and Reducer Agents
- **engine-lane-assignment**: Engine: assign orchestrator-phase lane ids to plan-less agents
- **engine-monitor-reconciliation**: Engine and Monitor Accepted-Success Landing Reconciliation
- **engine-pipelined-scheduler**: Engine Pipelined Map/Reduce Scheduler
- **engine-queue-controls**: Engine queue hold/unhold, scheduler held gating, cascade preview/apply primitives, capabilities, and PRD-owned cancellation helpers.
- **engine-queued-resume**: Engine Queued Compiled-Build Resume
- **engine-recovery-guidance**: Idempotent root-only Recovery Guidance patching for compiled plan artifacts and continue/resume integration.
- **engine-registration-manifest-trust**: Validate/projection frameBundle workstations, generate asset metadata, and include workstation-assets in trust hashing.
- **engine-registry-runtime**: Record, validate, de-duplicate, project, replay-summarize, and invoke extension actions/contributions/commands/deep links in the engine registry/runtime.
- **engine-resume**: Engine Resume Reconstruction
- **evaluator**: gate review cycles on issue outcomes
- **evaluator-issue-references**: Evaluator Verdict Issue References
- **evaluator-late-error-preservation**: Evaluator Late Error Verdict Preservation
- **evaluator-no-verdict-retry**: Retry Build Evaluator No-Verdict Completions
- **executive-summary-disclosure**: Executive Summary Persistence and Progressive Disclosure
- **executive-summary-prompt**: Executive Summary Prompt and Regression Coverage
- **exploration-outcome-resilience**: Structured exploration budget-exhaustion outcomes
- **extension-content-routes**: Create registered route modules and narrow services for extensions, playbooks, session plans, and session plan sets.
- **extension-dependency-contracts**: Extension Dependency and Capability Contracts
- **extension-planning-workstation**: Extension-Owned Planning Workstation and Actions
- **extension-routes**: Extract Extension Route Group
- **extension-sdk**: add bounded contribution helpers
- **extension-sdk-api**: Add source-level frameBundle workstation types and the browser-safe v1 workstation SDK entrypoint.
- **extension-tasks**: Add deferred source providers
- **extension-tooling-tests**: Split Extension Tooling Route and Wiring Tests
- **extractor-json-parsing**: Shared Balanced JSON Parsing for Acceptance Criteria Extractor
- **failed-resume-sidecars**: Finalize Failed Resume Recovery Sidecars
- **filter-synthetic-resume-lanes**: Filter Synthetic Resume IDs From Engine and Console Lanes
- **final-validation-gates**: Final Validation Gates, Waivers, and Gap-Close Reruns
- **first-party-planning-contract-adoption**: First-Party Planning Contract Adoption
- **foundation-contracts**: Define shared client wire schemas, terminal subtype, recovery option union, and reusable compile-resilience helper contracts.
- **foundation-http-context**: Create MonitorContext, public monitor types, and shared HTTP router/request/response/security/static primitives without moving feature routes yet.
- **foundation-queue-contract**: Add any producer-agnostic generic queue handoff fields needed by extension-owned playbook runs, with tests for ctx.buildQueue.enqueue behavior.
- **freshness-foundation**: Recommendation Freshness Foundation and Apply Validation
- **fts-search-bounded-actions**: Implement FTS5 ranked/snippet search and swap agent-facing list/search/read contribution actions to bounded SQL-backed projections with filters and pagination.
- **full-audit-evidence**: Bounded Full Implementation Audit Evidence
- **generated-public-docs**: Regenerate Public Docs Artifacts
- **generated-reference-artifacts**: Regenerate and verify public docs mirrors, reference docs, JSON schemas, and LLM artifacts after source docs, client contracts, and config schema changes land.
- **guardrails-parser-and-docs**: Guardrails Parser, Examples, and Documentation
- **historical-analytics-ui-docs**: Historical Efficiency Analytics UI and Documentation
- **hook-signature-and-consumers**: Replace useActiveSessionStreams return shape with reduced RunState
- **host-contribution-surfaces**: MCP, Pi, and CLI Contribution Surfaces
- **host-integration-surfaces**: Expose generic extension contribution discovery and invocation in Pi, Claude/MCP, and CLI while keeping management dispatch separate.
- **host-migration**: Migrate CLI, MCP/Claude, Pi tools/commands, and playbook skills to generic eforge-playbooks contribution invocation while preserving user-facing workflows.
- **host-output-safeguards-docs**: Host Output Safeguards and Documentation
- **host-queue-controls**: CLI, MCP, and Pi Queue Control Surfaces
- **host-surface-neutrality**: Remove CLI, MCP, Pi, and Claude plugin host-owned playbook commands/tools/skills and rely on generic extension contribution invocation.
- **importer-reporting**: Implement dry-run-first, idempotent legacy importer/reporting for existing Markdown, JSON sidecars, session plans, traces, queue/build/session/landing records, and recommendations.
- **input-neutrality**: Remove playbook-specific files, exports, session-plan seed helpers, and docs from @eforge-build/input while preserving generic session-plan behavior.
- **input-session-plan-sets**: Read-Only Input Session Plan Sets
- **inspection-foundation**: Planner Inspection Budget and Handoff Foundation
- **json-safe-list-board**: JSON-safe eforge-plan list-board output
- **landing-preflight-and-observability**: Landing Preflight Repair and Observability Metadata
- **landing-stack-tests**: Split Landing Action and Stack Runtime Landing Tests
- **landing-vocabulary-clean-break**: Landing Vocabulary Clean Break
- **lifecycle-projections**: Lifecycle Projections and Conservative Evidence Semantics
- **live-dependency-projection**: Live Queue Dependency Projection
- **live-efficiency-surfaces**: Live Build Detail and Active Now Efficiency Surfaces
- **localized-evidence-pipeline**: Localized Evidence Pipeline
- **maintainability-baseline**: Remove Stale Test Baseline Entries and Run Final Gates
- **manual-only-ac-gate**: Reject Manual-Only Hard-Gated Acceptance Criteria
- **mcp-host-boundary**: MCP Host-Boundary Caps and Compact Extension Management
- **mod-ac008-regression-coverage**: AC-008 adoption/reconciliation regression coverage
- **mod-ac010-quality-gates**: AC-010 quality gates
- **mod-adopt-success-state-artifact-preservation**: Adopted successful build state/artifact preservation
- **mod-adopted-failure-cancel-control**: Adopted failure and cancellation control
- **mod-idempotent-queue-finalizer**: Shared idempotent queued-build finalizer
- **mod-recovery-visibility-refusal-regressions**: Recovery visibility/refusal regressions
- **mod-resubmit-recovery-provenance**: Identity-preserving resubmit recovery and provenance
- **mod-same-plan-recovery-core**: Same-plan recovery core
- **mod-session-plan-status-surfaces**: Session-plan status/projection surfaces
- **mod-startup-adoption-reconciliation**: Startup adoption and lock reconciliation
- **model-config-monitor-data-routes**: Extract Model, Config, Stack, and Monitor Data Routes
- **module-extension-action-diagnostics**: Extension action diagnostics surface
- **monitor-dispatcher-skeleton**: Extract Monitor Dispatcher Skeleton and Fallback Routes
- **monitor-frame-assets**: Serve eforge-owned workstation frame shells and declared bundle assets with CSP/cache/path containment security.
- **monitor-queue-tests**: Split Monitor Reducer and Queue Scheduler Tests
- **now-extension-trust-attention**: Now Extension Trust Attention
- **now-page-rewrite**: Now page rewrite with mini-Gantt cards and activity drawer
- **one-time-marker-cleanup**: One-Time Plan-ID Marker Removal
- **package-foundation**: Convert eforge-plan into a buildable first-party package and replace runtime source-path imports with public package imports.
- **packaging-docs-validation**: Finalize package artifact contents, install/update/trust/reload tests, release wiring, asset serving checks, and documentation.
- **parser-and-committed-work-hardening**: Reviewer Parser and Committed Work Hardening
- **pi-docs-regressions**: Pi Host-Boundary Caps, Regression Tests, and Documentation
- **pi-eforge**: add native build and plan selectors
- **pi-extension-contribution-ux**: Pi Extension Contribution Invocation UX
- **pi-headless-isolation**: Pi Harness Headless Isolation, Tool-Infra Error Classification, and Config Surface
- **pi-status-renderer**: Decompose Pi Status Tool Rendering
- **pi-workflow-wizard-and-stack-sync**: Pi Workflow Wizard and Stack Sync Entry Point
- **plan-01-git-delta-baseline**: Add accepted-analysis baseline sidecar, bounded git-delta scanning, diagnostics, and source/fingerprint projection for analyze-all curation.
- **plan-02-evidence-classification**: Make shipped/affected evidence range-aware, add deterministic commit-to-item matching and superseded/ambiguous evidence classification, and enforce required evidence prefixes.
- **plan-03-prospective-overlay-apply**: Build the shared prospective backlog/recommendation overlay used by preview and apply, add placement validation, and record accepted analysis baselines after explicit applies.
- **plan-04-trace-lifecycle-freshness**: Refine active versus historical trace classification and recommendation freshness projection so stale submitted traces do not imply active/planned work.
- **plan-05-workstation-ui**: Surface git-delta diagnostics, effective recommendation overlay counts, ambiguous needs-input evidence, and truthful freshness labels in the planning workstation.
- **plan-06-docs-validation**: Update eforge-plan documentation for baseline storage, git-delta diagnostics, overlay-first apply behavior, and active-versus-historical trace semantics.
- **plan-artifact-lifecycle-projection**: Plan Artifact Lifecycle Projection and Handoff State
- **plan-revision-extension-backend**: Implement eforge-plan-owned revision-session storage, action schemas/actions, fingerprinted context/apply orchestration, registration, and backend tests.
- **plan-revision-workstation**: Add the Plans tab Revise with AI panel, thread hook/rendering, patch preview/apply UX, stale/clarification states, frontend fixtures, bridge support, UI tests, and workstation build verification.
- **plan-set-api-contracts**: Plan-Set API Contracts and Daemon Routes
- **planner**: add aspect coverage accounting
- **planner**: add atom planning contracts
- **planner**: add bounded atom map execution
- **planner**: add bounded compiler runner
- **planner**: add bounded planning atom graph foundation
- **planner**: add bounded reduce execution
- **planner**: add bounded source evidence materialization
- **planner**: add plan artifact synthesis
- **planner**: add residue synthesis
- **planner**: add shared planning brief
- **planner**: emit map/reduce orchestration events
- **planner**: enforce exclusive test ownership
- **planner**: integrate bounded compiler planning path
- **planner-compiler**: adaptive source-localization rescoping for degraded exploration
- **planner-compiler**: add bounded module repair
- **planner-compiler**: add machine-readable compiler-diagnostics.json artifact
- **planner-compiler**: derive doc/test stages from declared module work
- **planner-compiler**: deterministic per-plan pipeline derivation
- **planner-compiler**: make shared-brief budgets tunable via compile config
- **planner-compiler**: model-led plan intent with deterministic floors
- **planner-compiler**: normalize model proposals deterministically
- **planner-compiler**: repository exploration hints for compiler localization
- **planner-compiler**: single-atom passthrough fast path
- **planner-compiler**: synthesize rich architecture.md from compiler data
- **planner-compiler**: unconditional planning-quality-review-cycle gate
- **planner-continuation-surfaces**: Compact Planner Continuation Integration and Surfaces
- **planner-guardrails**: Bound planner submission diagnostics and add prompt/live context guardrails around planner-family agent runs.
- **planner-orchestration-workstation**: Planner Orchestration Actions and Workstation Controls
- **planning**: add the deletion grep gate and align docs with the single planning path
- **planning**: delete retry-as-expedition recovery and preflight risk machinery
- **planning**: delete the expedition planning path from the engine
- **planning**: delete the pipeline-composer role
- **planning**: delete the planning wire surface and its console/monitor/CLI renderers
- **planning**: route all compiles through the bounded planner compiler
- **planning**: skip compile when the PRD is already satisfied
- **planning-contract-neutralization**: Remove playbookDraft and playbook-specific planning capability/contracts from client, monitor, and eforge-plan planning task surfaces.
- **planning-quality**: add typed structural simplification fixes
- **planning-task-contract**: Client/engine extension planning task contract for structured backlog curation drafts, prompt/tool schema, and API version gate.
- **platform-contracts**: Define SDK registration methods plus client-owned TypeBox manifest/action wire contracts, helpers, exports, and daemon API v52 bump.
- **playbook-ac-quality-gates**: Dependency-Update Playbook AC Quality Gates
- **playbook-domain-extraction**: Move canonical playbook model, parser, serializer, validation, storage, compiler, and planning seed behavior into eforge-playbooks and rewire its actions/tests.
- **playbook-inventory**: Persist Playbook Acceptance Inventory
- **playbook-onsuccess-api**: Playbook Run onSuccess API Propagation
- **playbook-placement-parity**: Playbook Dependency Placement Parity
- **playbook-session-plan-routes**: Extract Playbook and Session-Plan Route Groups
- **playbook-session-tests**: Split Playbook and Session Plan Route Tests
- **playbook-workflow-adapter**: Add Bundled Playbook Workflow Adapter
- **playbooks-extension**: Create and register the @eforge-build/eforge-playbooks extension package with playbook actions, schemas, capabilities, optional eforge-plan dependency, Console contribution, README, and package tests.
- **plugin-docs-and-generated-reference**: Claude Plugin Parity, Docs, and Generated References
- **policy-resume-core**: Guarded resume policy
- **pr-metadata**: Deterministic PR Metadata for Direct and Stacked Landings
- **pre-compile-trunk-sync-gate**: Pre-Compile Trunk Sync Gate
- **preflight-compaction**: Implement deterministic compile source risk estimation and generated-inventory prompt compaction before composer/planner prompts.
- **preserve-tester-results**: Preserve Tester Results After Late Transport Errors
- **preview-labels-and-docs**: Preview Labels and Documentation
- **project-team-test-thinning-playbooks**: Project-Team Test-Thinning Playbooks
- **projections-lifecycle**: Implement SQL-derived board lanes, item/session lifecycle, recommendation actionability, associated plan/build links, active build linkage, and compact projections.
- **projections-read-models**: Extract reusable read-side projections for run summaries, run state, plans, queue items, stack layers, auto-build state, config redaction, and event hydration.
- **promotion-selection**: Multi-Source and Epic Promotion
- **public-docs-audit**: Audit and Update Public Guide Sources
- **public-docs-audit-refresh**: Audit and Refresh Public Web Docs
- **public-docs-regeneration**: Regenerate and Validate Public Web Artifacts
- **public-web-docs-audit**: Audit Public Web Docs and Refresh Generated Artifacts
- **published-pi-safe-panels**: Published Pi eforge safe panels and build review
- **queue-control-docs**: Queue-Control Documentation and Generated References
- **queue-control-race-safety**: Queue-Control Race-Safety Remediation
- **queue-recovery-api-engine**: Queue Recovery API and Engine Cascade Repair
- **queue-removal-signal**: Emit Queue Removal Signal
- **queue-runtime-and-prd-provenance**: Decouple runtime queue state from git; commit PRD provenance on the eforge work branch
- **queue-view**: Implement Read-Only Console Queue View
- **readiness-contract**: Enforce AI Session-Plan Creation Readiness Contract
- **rebase-provider-recovery-foundation**: Rebase Provider Recovery Foundation
- **recommendation-actionability-server**: Server Recommendation Actionability and Duplicate Guards
- **recommendation-actionability-workstation**: Workstation Recommendation Actionability Rendering
- **recommendation-freshness-state**: Recommendation Freshness State and Workstation Surfacing
- **recommendations**: Recommendation Store and Board Projection
- **recover-completed-console-branch**: Recover Completed Console Branch on Current Main
- **recovery-and-acceptance-reporting**: Recovery and Acceptance Reporting for Inconclusive Criteria
- **recovery-and-docs**: Recovery Guidance and Stacking Documentation
- **recovery-api**: Recovery API Helpers and Resume Eligibility
- **recovery-contracts-and-engine**: Add client-owned recovery/dispatch-failure contracts and engine recovery preflight, dependency classification, explicit repair operations, and durable pre-session dispatch failure events.
- **recovery-daemon-console**: Project recovery contracts through daemon routes/SSE snapshots and render failed queue blocker, dependency classification, repair confirmation, and Needs attention UX in Console without local wire-shape redeclarations.
- **recovery-orchestration-resume-tests**: Split Recovery, Orchestration, and Resume Tests
- **recovery-rendering**: Render decomposition progress and classify decomposition exhaustion in recovery sidecars, CLI, Console, registry, and fixtures.
- **recovery-run-selection**: Prefer Failed Build Runs for Recovery Summaries
- **recovery-run-selection**: Update Recovery Event-History Resume Run Selection
- **recovery-split-canonical-inventory**: Recovery Split Canonical Inventory
- **recovery-summary-reconstruction**: Recovery Summary Multi-Plan Reconstruction
- **reducer-port**: Port session reducer into console-ui
- **refresh-console-docs**: Refresh Console Documentation and Stale Monitor UI Comments
- **refresh-invalidation**: Recommendation Refresh Action and Stale Invalidation
- **release**: automate protected-main release flow
- **remove-duplicate-low-value-tests**: Remove Duplicate Low-Value Tests
- **remove-eforge-plan-host-surfaces**: Remove Hardcoded /eforge:plan Host Surfaces
- **remove-monitor-ui-code**: Remove Monitor UI Package and Route Dashboard Traffic to Console
- **render-docs**: Render Guard Diagnostics and Update Documentation
- **rendering-and-docs**: Validation Rendering and Documentation Sync
- **repair-loop-and-residue-gating**: Repair Loop and Residue Gating
- **request-surfaces-and-pi-ux**: Daemon, CLI, MCP, and Pi Auto-Merge Selection
- **resolved-planning-tasks**: Resolved Planning Task Execution
- **restack-before-stacked-pr-submit**: Restack Before Stacked PR Submit
- **resume**: support profile overrides
- **resume-artifacts-projection**: Emit and Render Recovered Resume Artifacts
- **resume-docs-and-reference**: Queued Resume Documentation and Reference
- **resume-projections**: Accurate Resumed Build Plan Projections
- **resume-queue-reactivation**: Resume Queue Reactivation and Finalization
- **retention-maintenance**: Add explicit compaction/archive/VACUUM/FTS maintenance helpers that preserve canonical rows and current projection explainability.
- **review-cycle**: feed evaluator guidance into retries
- **review-cycle-dirty-worktree-safety**: Review Cycle Dirty Worktree Safety
- **review-cycle-inspector**: Console Run Detail Review-Cycle Inspector Sheet
- **review-fixer-continuation**: Review-Fixer Turn Budget and Continuation Handoff
- **review-fixer-references**: Review-Fixer Issue References
- **review-rail-annotations**: Review Rail Annotation and Revision Controls
- **reviewer-contract-hardening**: Reviewer Contract Hardening
- **reviewer-isolation**: Reviewer Isolation and Read-Only Harness Tools
- **reviewer-issue-ids**: Reviewer Issue ID Assignment
- **reviewer-late-transport-recovery**: Reviewer Late Transport Recovery
- **roadmap-backend**: Implement local-first roadmap state/actions and replace hardcoded roadmap evidence in planner, curation, refresh, and freshness flows.
- **roadmap-workstation**: Add workstation roadmap source status, local focus editing, and recommendation refresh paths after roadmap changes.
- **round-metadata**: Review-Cycle Round Metadata in Wire Events and Engine Emission
- **runs-filters-day-groups-detail-density**: Runs Filters, Day Groups, and Detail Density
- **runtime-artifact-diagnostics**: Runtime Artifact Finalization and Completion Diagnostics
- **runtime-choice-core**: Runtime Choice Config and Core Resolution
- **runtime-choice-docs-integrations**: Runtime Choice Docs and Profile Creation Surfaces
- **runtime-choice-events-extensions**: Runtime Choice Events and Extension Routers
- **runtime-recovery**: Validation Provider Recovery Runtime
- **safe-mermaid-markdown**: Safe Mermaid Rendering for eforge-plan Markdown
- **scan-mode-plumbing**: Scan Mode Plumbing and Baseline Metadata
- **sdk-runtime-paths**: SDK Scoped Path Helpers and Runtime Context Wiring
- **selector-dedup-and-run-grouping**: Selector Deduplication, Display Labels, and Run Grouping
- **server-composition-coverage**: Wire the final router and stream hub in server.ts, preserve compatibility exports, trim server.ts, add registry/security/static/compatibility coverage, and satisfy maintainability marker gates.
- **session-plan-agent-profile-select**: Session plan agent profile select UI and persistence
- **session-plan-list-api**: Session Plan List API Submitted Visibility
- **shared-contribution-projection**: Shared Contribution Projection and Formatting
- **shared-extension-dispatch**: Shared eforge_extension Dispatcher
- **shared-pi-landing-gate**: Shared Pi Landing Gate UX for Build and Playbook Run
- **shell-and-routes**: Replace sidebar with header, delete legacy routes
- **shell-now-queue-system-status**: Shell, Now, Queue, and System Status Consolidation
- **shipped-evidence-provider**: Shipped Evidence Provider
- **sidecar-resume-option**: Add Sidecar Compiled-Build Resume Option
- **source-docs-positioning**: Reorient Source Docs and Site Positioning
- **source-first-audit-core**: Source-First Audit Core and Validation
- **source-first-audit-ui-docs**: Source-First Audit Workstation and Docs
- **source-localization-foundation**: Source Localization Foundation
- **spend**: add model-level spend breakdown
- **split-client-event-schemas**: Split Client Event Schemas
- **stack-base-and-provider-foundation**: Stack Base Normalization and Provider Retarget Foundation
- **stack-daemon-ui**: Expose Stack Layers through Client, Daemon, and Monitor UI
- **stack-foundation-sync**: Synchronize Existing Stack Foundation and Provider Baseline
- **stack-landing-integration-docs**: Stack Landing Integration and Documentation
- **stack-landing-lifecycle-cleanup**: Stack Landing Lifecycle Status and Cleanup
- **stack-provider-runtime**: Wire git-spice Runtime Landing and Durable Stack State
- **stack-sync-daemon-cli**: Stack Sync Daemon Route, Client Helper, and CLI
- **stacked-pr-landing-freshness**: Stacked PR Landing Remote Base Freshness
- **stage-local-retry-recovery**: Stage-local retry and checkpoint recovery for Pi tool failures
- **stale-parent-landing-repair**: Stale Parent Stack Landing Repair
- **static-serving-package-integration**: Integrate Console Static Serving and Packaging
- **storage-foundation**: Canonical private backlog storage helpers with legacy read-through/import compatibility and private-only writes.
- **storage-schema**: Build the eforge-plan SQLite store foundation: DB path/opening, pragmas, migrations, schema constraints, core typed repositories, and FTS5 capability validation.
- **stream-hub**: Extract session and daemon SSE streams, event parsing, polling, heartbeat, semantic daemon-event reactions, broadcast, and subscriber cleanup into stream-focused modules.
- **surfaces-docs**: Render new typed preflight/failure/recovery guidance in existing CLI, Console, recovery, and documentation surfaces as needed.
- **system-activity-progressive-disclosure-and-guards**: System and Activity Progressive Disclosure with Theme Guards
- **system-boundary-docs**: Remove System Session-Plan Summary and Sync Boundary Docs
- **system-extension-trust-actions**: System Extension Trust Actions
- **task-contracts-progress**: Extend Planning Task Contracts and Progress Telemetry
- **terminal-curation-byte-cap**: Preserve Terminal Curation Findings Under Reducer Byte Caps
- **terminal-failure-contract**: Authoritative Terminal Failure Contract and Recovery Precedence
- **thin-monitor-ui-tests**: Thin Legacy monitor-ui Duplicate Tests
- **thin-test-suite**: Thin Automated Test Suite
- **transport-terminal-subtypes**: Classify Codex SSE Timeouts and Preserve Terminal Subtypes
- **trust-cleanup**: Remove the deprecated extensions.trustProjectExtensions field from config schema/types/defaults/compatibility handling, extension loader options, monitor/Pi consumers, tests, and active docs references.
- **trusted-creation-linkage**: Trusted AI Creation-Draft Source Linkage
- **unified-pi-landing-ux**: Unified Pi Landing-Action UX
- **update-workspace-dependencies**: Update Workspace Dependencies and Validation Evidence
- **ux-init-build-and-docs**: UX surface: eforge_init schema, init/build skills, CLI confirmation, docs
- **validation**: handle acceptance criteria conflicts
- **validation-evidence-contract**: Validation Evidence Contract and PRD Validator Output
- **validation-guidance-contract**: Validation Guidance Contract and Normalization
- **validation-repair-routing**: Validation Repair Routing, Structural Fixer, and Checkpoints
- **visibility-provenance**: Queue/run and Console visibility
- **workspace-dependency-update**: Workspace Dependency Update and Validation Evidence
- **workstation-activity-timeline**: Planning Task Projections and Workstation Timeline
- **workstation-contract-runtime**: Workstation Contract, SDK, and Runtime Projection
- **workstation-curation-ui**: Backlog workstation analyze-all control, curation task labels, read-only previews, two-step apply confirmation, mocks, and bundle guards.
- **workstation-docs**: Workstation Recommendation Status UX and Documentation
- **workstation-docs**: Workstation UI, Preview Rendering, and Documentation
- **workstation-docs-integration**: Update the eforge-plan workstation, user-facing docs/help text, and integration parity notes to consume and explain the SQLite-backed store, import workflow, search, lifecycle, and retention semantics.
- **workstation-docs-lifecycle-ui**: Workstation Lifecycle UI and Documentation
- **workstation-plan-eligibility**: Workstation Uses Backend Plan Eligibility
- **workstation-preview-and-docs**: Workstation Preview and Documentation for Curation-Only Apply
- **workstation-session-plan-auto-apply**: Workstation Session Plan Auto-Creation
- **workstation-session-plan-consumption**: Consume Applied Session-Plan Creation Tasks
- **workstation-subview-contract**: Workstation Subview Contribution Contract
- **workstation-ux-polish**: Workstation UX Polish

### Bug Fixes

- **add-comprehensive-console-recovery-options**: resolve rebase conflicts
- **backlog**: reduce freshness evidence noise
- **client**: classify backend upstream idle timeouts as transient
- **config**: preserve default tier fields in profiles
- **console-ui**: assign planning agents to lanes and fix validation swimlane rendering
- **console-ui**: base build health on build runs
- **console-ui**: ignore stack sync run-state events
- **console-ui**: render recovery reports in side panel
- **console-ui**: repair plans workspace layout
- **console-ui**: show gap closer in gap-close lane
- **console-ui**: show PRD titles and animate active agents
- **console-ui**: unify active build phase status
- **console-ui**: unify auto-start scheduler control
- **console-ui**: use shared eforge logo
- **console-ui**: wire auto-build toggle
- **core**: add console-ui as a vitest project to enable running its tests from root
- **core**: add missing restackCandidates field to skipped StackSyncResponse
- **core**: harden recovery sidecars and shared brief ids
- **core**: honor allowNoAcceptanceCriteria waiver regardless of criteria count
- **core**: ignore node_modules symlinks for artifact landing
- **core**: omit validation evidence instruction from prompt when no commands provided
- **core**: recover reviewer output and show backlog item bodies
- **core**: reduce playbook-api test file to fit 1200-line cap
- **core**: resolve validation failures
- **core**: resolve validation failures for stack provider boundary, docs drift, and retry-deferred docs
- **core**: Surface terminated runs as failed
- **core**: update maintainability baselines to match current line counts
- **eforge-dev**: exempt local eforge state from main guard
- **eforge-plan**: allow replacing abandoned session plans
- **eforge-plan**: gate session plan handoff actions
- **eforge-plan**: ignore stale planning task coverage
- **eforge-plan**: improve action error UX
- **eforge-plan**: lazy-load backlog curation previews
- **eforge-plan**: make bundled ESM import-safe
- **eforge-plan**: preserve sqlite migration history
- **eforge-plan**: Reduce backlog curation recheck noise
- **eforge-plan**: Resolve stale dependency projections
- **eforge-plan**: surface standalone horizon epics
- **engine**: allow recovery continuations with global stacking
- **engine**: avoid false compile context guard failures
- **engine**: bound planner inspection handoffs
- **engine**: constrain compact planner synthesis
- **engine**: guard queued resume rollback restoration
- **engine**: Harden source-localization repair
- **engine**: inject validate stage when validation providers are loaded
- **engine**: move max turn defaults to tiers
- **engine**: preserve canonical manifest fence in architecture review fixes
- **engine**: quote PRD frontmatter titles that break YAML plain scalars
- **engine**: re-derive manifest deps after orchestration fixes
- **engine**: retry intake on transient backend transport failures
- **engine**: skip guidance patches for terminal recovery scopes
- **engine**: verify resolver command stdout evidence
- **enqueue**: preserve explicit acceptance criteria
- **monitor**: avoid agent task event race
- **monitor**: preserve recovery summary when applying split verdicts
- **monitor**: restore gap-close plan preview content
- **monitor**: submit kebab-case session plans
- **monitor-ui**: scope stack layers to selected run
- **pi**: preserve streamed assistant result text (#5)
- **pi-eforge**: align native selector parity checks
- **pi-eforge**: ignore dirty suffix in daemon version checks
- **pi-eforge**: prompt for trunk landing policy choices
- **pi-harness**: avoid infra false positives in tool output
- **plan**: recover actionable playbook review fixes
- **planner**: adapt reduce fan-in to prompt budget
- **planner**: bound reducer inputs with digests
- **planner**: budget-plan reduce prompts across tree
- **planner**: derive reducer digest budget
- **planner**: enforce bounded unit budget limits
- **planner**: Harden compiler submissions
- **planner**: recover from live context guard trips
- **planner**: Retry compiler agent infra failures
- **planner**: stream bounded compiler events
- **planner-compiler**: cap surface localization fan-out and collapse small PRDs to one atom
- **planner-compiler**: demote advice gaps, allow residue no-op merges
- **planner-compiler**: derive build stages from risk score
- **planner-compiler**: enforce shared-brief budgets by construction
- **planner-compiler**: fail fast on map reduce failures
- **planner-compiler**: harden adaptive rescope loop and persist fail-closed state
- **planner-compiler**: improve adaptive rescope budgeting
- **planner-compiler**: keep exploration-only issue kinds out of repair inference
- **planner-compiler**: narrow adaptive rescope critical gate
- **planner-compiler**: prioritize repair source evidence
- **planner-compiler**: rank evidence materialization by value, not path order
- **planner-compiler**: reject invalid atom submissions
- **planner-compiler**: treat exploration hints as evidence
- **plugin**: prompt for build profile selection
- **prd**: normalize acceptance criteria heading
- **queue**: infer stack parent during enqueue
- **queue**: remove completed PRDs from runtime queue
- **recovery**: Include review failures in sidecars
- **recovery**: preserve resume progress through landing
- **recovery**: preserve terminal resume failure sidecars
- **recovery**: support v3 accepted-success projections
- **recovery**: tighten terminal failure synthesis
- **release**: use merge commits for auto-merge
- **resume**: recover compiled artifacts from branch history
- **review**: ignore generated eforge artifacts
- **stacking**: make git-spice recovery noninteractive
- **stacking**: submit git-spice PRs non-interactively
- **ui**: preserve text selection in SafeMarkdown across re-renders
- **validation**: fail when commands dirty merge worktree
- **validation**: reduce acceptance verdict matching brittleness

### Refactoring

- **client**: split daemon route contracts
- **console-ui**: clean up Now dashboard queue and analytics UI
- **console-ui**: fold map-reduce board into pipeline
- **console-ui**: merge intake work into queue card
- **console-ui**: move activity log from Now to System
- **console-ui**: move failure recovery into Needs attention strip
- **console-ui**: move stack housekeeping off Now dashboard to System
- **console-ui**: rename run detail to build detail and roll up build history
- **eforge-plan**: defer backlog-curation source assembly on retry/redraft
- **eforge-plan**: drop obsolete recommendation-start test and rebuild bundle
- **eforge-plan**: remove legacy import paths
- **eforge-plan**: split session plan schemas
- **engine**: consolidate PRD intake into single structured agent
- **engine**: split compile review cycle stages
- **planner**: retire legacy decomposition runtime
- **planner-compiler**: one shared evidence-value comparator for both budget rankers
- **planner-compiler**: remove dead code from planning consolidation

### Performance

- **planner-compiler**: thread min digest slot as cap across node searches

### Documentation

- **core**: regenerate API reference for failed enqueue dismiss
- **core**: regenerate llms full artifact
- **core**: regenerate playbooks public mirror
- **core**: update Console screenshots
- **plan**: add recovery guidance for plan 02 resume
- **playbooks**: plan parallel test thinning audits
- **roadmap**: add console workbench direction
- **roadmap**: add overseer observability direction
- **roadmap**: align planning visibility with extension migration
- **web**: refresh positioning and setup copy
- **webux**: add workspace design

### Maintenance

- **body-safe-update-action**: add tests
- **ci**: remove redundant docs builds from checks
- **ci**: streamline validation gates
- **claude-socket-transport-classifier**: fix builder retry regression test to use withRetry
- **client**: relax daemon API version assertions
- **config**: enable git-spice stacking
- **config**: enable PR auto-merge
- **console-ui**: cover pending plan lifecycle transition
- **console-ui**: thin high-level UI test coverage
- **core**: align trunk sync fixture remote head
- **core**: cache giant schemas in host output cap test
- **core**: cover explicit dependency enqueue handoff gaps
- **core**: harden extension timeout process tests
- **core**: make temp directory cleanup resilient
- **core**: remove planning artifacts
- **core**: remove tracked tmp artifact
- **core**: skip generated workstation assets in boundary scan
- **core**: speed up playbook planning contract test
- **core**: stabilize accepted-success PR freshness hook
- **daemon**: isolate api version guard
- **deps**: update pnpm workspace dependencies
- **deps**: update workspace dependencies
- **eforge**: add browser UI toolbelt
- **eforge**: remove completed reduction plan artifacts
- **eforge-dev**: defer branch naming to agent
- **eforge-dev**: delegate git workflow commands
- **eforge-plan**: add extension type checking
- **eforge-plan**: align curation contract assertions
- **eforge-plan**: ignore generated workstation assets
- **eforge-plan**: resolve maintainability and schema drift
- **extensions**: promote eforge guardrails
- **harden-session-plan-canonical-status-recovery**: record PRD provenance
- **planner**: add compiler runtime hardening coverage
- **planner-compiler**: parity fixtures for errand, excursion, and expedition PRDs
- **plans**: remove stale adaptive-rescoping plan artifacts
- **plans**: remove stale eforge plan artifacts
- **playbooks**: add dependency update playbook
- **recovery-summary-reconstruction**: add regression tests for multi-plan synthesis
- **trusted-creation-linkage**: fix test issues
- **watch-queue**: avoid subprocess in requeue test
- **watch-queue**: make requeue rediscovery deterministic

### Other

- **branch-aware-landing-and-queue-provenance-split-for-eforge-builds**: failed - retry
- **branch-aware-landing-and-queue-provenance-split-for-eforge-builds**: requeue per recovery verdict
- **console-ui**: keep active logo ring green
- **core**: Add planner compact inspection continuation
- **core**: eforge-dev: issue-pr by default
- **core**: feat/dev extension existing pr (#4)
- **core**: Fix eforge-plan post-merge validation failures
- **core**: fixup tests
- **core**: Parameterize eforge on-success landing actions (#6)
- **core**: remove dependency handoff plan artifacts
- **core**: remove old build
- **core**: remove stale eforge plan and PRD artifacts
- **direct-pr-base-sync-recovery-ux**: add compiled plan guidance
- **parameterize-eforge-on-success-landing-actions**: move to skipped

## [0.7.21] - 2026-05-20

### Features

- **core**: PRD Gap Close
- **fix-gap-close-runtime-profile-inheritance-and-fatal-agent-stop-handling**: Fix Gap-Close Runtime Inheritance and Builder Stop Failures
- **improve-adaptive-reviewer-selection-and-follow-up**: Risk-Budgeted Adaptive Review Selection

### Maintenance

- **deps**: update workspace dependencies

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

---
For older releases, see [GitHub Releases](https://github.com/eforge-build/eforge/releases).
