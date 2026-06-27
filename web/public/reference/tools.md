<!-- Generated file. Do not edit. -->
<!-- Source: packages/eforge/src/cli/mcp-proxy.ts, packages/eforge/src/cli/mcp-extension-contributions.ts, packages/pi-eforge/extensions/eforge/index.ts, packages/pi-eforge/extensions/eforge/extension-contributions.ts, eforge-plugin/skills/, packages/pi-eforge/skills/ -->

# eforge MCP Tools and Skills Reference

eforge exposes its capabilities through two integration surfaces:
- **MCP tools** for the Claude Code plugin (`eforge-plugin/`)
- **Native Pi commands and tools** for the Pi extension (`packages/pi-eforge/`)

Both surfaces are kept in parity per `AGENTS.md`.

Extension-provided workflows are discovered, inspected, and invoked through generic contribution APIs: `eforge_extension_contribution` for MCP/Pi hosts and `eforge extension contributions list|show|invoke` for the CLI. Hosts treat contribution IDs as opaque extension-owned identifiers; session-plan host tools manage project-local planning artifacts separately.

## MCP tools (Claude Code)

Total tools: 19

| Tool name | Description |
|-----------|-------------|
| `eforge_build` | Enqueue a PRD source for the eforge daemon to build. Returns a sessionId and autoBuild status. |
| `eforge_auto_build` | Get or set the daemon auto-build state. When enabled, the daemon automatically builds PRDs as they are enqueued. |
| `eforge_status` | Get the current run status including plan progress, session state, event summary, and the daemon vs CLI version. |
| `eforge_queue_list` | List all PRDs currently in the eforge queue with their metadata. |
| `eforge_queue_priority` | Update priority for a pending or waiting PRD queue item. Lower numbers run earlier; cancel running builds by session id instead. |
| `eforge_queue_remove` | Remove a non-running PRD queue item, including failed recovery sidecars. Refuses running items and live-dependent conflicts. |
| `eforge_config` | Show resolved eforge configuration or validate eforge/config.yaml. Config merges three tiers: user (~/.config/eforge/config.yaml), project (eforge/config.yaml), and project-local (.eforge/config.yaml, gitignored). Pass verbose: true with action "show" to see per-tier file presence. |
| `eforge_profile` | Manage named profiles in eforge/profiles/ (project), .eforge/profiles/ (local, gitignored), or ~/.config/eforge/profiles/ (user). Actions: "list" enumerates profiles and reports which is active; "show" returns the resolved active profile; "use" writes the active-profile marker to switch profiles; "create" writes a new profile (pass `agents.tiers` with self-contained tier recipes; optionally pass `metadata` with `description`, `whenToUse`, and `tags` — descriptive only, does not affect runtime behavior); "delete" removes a profile (refuses when active unless force: true). |
| `eforge_extension` | Manage native eforge extensions with compact host-safe output by default; use CLI --json or daemon/client HTTP surfaces for raw schemas, diagnostics, and detail arrays. Actions: "list" returns compact extension entries with status/provenance/diagnostic counts; "show" returns one compact extension by name; "validate" returns valid:false when extension load errors exist, optionally scoped to a name or ad-hoc path; "test" dry-runs onEvent hooks against fixture or monitor events; "new" scaffolds an extension; "reload" refreshes discovery and restarts the runtime watcher when running; "trust" writes a local trust record for a project-team extension without executing it; "untrust" removes the trust record for a project-team extension; "install" installs a package extension from npm, a local path, or tarball; "update" updates an installed extension package; "remove" removes an installed extension package; "promote" promotes a project-local extension to project-team scope; "demote" demotes a project-team extension to project-local scope. |
| `eforge_models` | List providers or models available for a given harness. Actions: "providers" returns provider names (claude-sdk is implicit / returns []); "list" returns models, optionally filtered to a single provider, newest-first. |
| `eforge_daemon` | Manage the eforge daemon lifecycle: start, stop, or restart the daemon. |
| `eforge_init` | Initialize eforge in a project. The skill is responsible for picking harness/model/effort per tier interactively; the tool is a pure persister. Pass `profile.tiers` with one self-contained recipe per tier (planning/implementation/review/evaluation). Each tier carries its own harness + model + effort. Pass `trunkBranch` and `allowLocalMergeToTrunk` to configure the branch protection policy. |
| `eforge_recover` | Trigger failure recovery analysis for a failed build plan. Spawns the recovery agent as a background subprocess and returns its sessionId and pid. |
| `eforge_read_recovery_sidecar` | Read the recovery analysis sidecar files for a failed build plan. Returns both the markdown summary and the structured JSON verdict produced by the recovery agent. |
| `eforge_apply_recovery` | Apply the recovery verdict for a failed build plan: requeue from scratch (retry), queue continue-and-repair from preserved artifacts, archive (abandon), or report manual no-action. |
| `eforge_continue_repair` | Queue a continue-and-repair build from preserved compiled artifacts for scheduler dispatch. Returns queued metadata including PRD id, set name, branches, moved descendants, and optional profile; no sessionId or pid is returned. |
| `eforge_session_plan` | Manage session plans in eforge. Actions: "list-active" returns all active (planning/ready) session plans; "show" returns a single session plan's data and readiness detail; "create" creates a new session plan file; "set-section" writes a dimension section to the session file; "skip-dimension" records a skipped dimension with a reason; "set-status" updates the session plan status (e.g. to "ready" or "abandoned"); "select-dimensions" sets planning type and depth and populates the required/optional dimension lists from the selected planning template; "readiness" checks whether all required dimensions are covered; "migrate-legacy" converts a legacy boolean-dimensions session file to the current shape. Pass open: true on "create" or "show" to best-effort open the session plan file in the default application. |
| `eforge_stack_sync` | Synchronize the git-spice stack for the current project. Runs the stack sync operation via the eforge daemon and returns a structured report. Set dryRun: true to preview what commands would run without executing them. Requires stacking.enabled: true in eforge/config.yaml. When active builds are running, check the outcome field: 'skipped' means no sync was performed (default activeBuildPolicy), 'deferred' means the sync was blocked by active builds and recorded for potential retry (requires activeBuildPolicy: 'defer'). |
| `eforge_extension_contribution` | List, show, and invoke extension-provided actions, integration commands, and action-backed deep links with compact formatted output by default. List supports kind, extensionName, search, idPrefix, outputProfile, limit, offset, includeInputSchema, includeDiagnostics, and full; show supports id, kind, includeInputSchema, includeDiagnostics, and full. Failed invocations return a summarized error envelope without target.input. Distinct from eforge_extension extension management. |

## Native tools (Pi extension)

Total tools: 20

| Tool name | Description |
|-----------|-------------|
| `eforge_build` | Enqueue a PRD source for the eforge daemon to build. Returns a sessionId and autoBuild status. |
| `eforge_status` | Get the current run status including plan progress, session state, event summary, and the daemon vs Pi-extension version. |
| `eforge_queue_list` | List all PRDs currently in the eforge queue with their metadata. |
| `eforge_queue_priority` | Update priority for a pending or waiting PRD queue item. Lower numbers run earlier; cancel running builds by session id instead. |
| `eforge_queue_remove` | Remove a non-running PRD queue item, including failed recovery sidecars. Refuses running items and live-dependent conflicts. |
| `eforge_config` | Show resolved eforge configuration or validate eforge/config.yaml. |
| `eforge_profile` | Manage named profiles in eforge/profiles/. Actions: "list" enumerates profiles and reports which is active; "show" returns the resolved active profile with harness; "use" writes eforge/.active-profile to switch profiles; "create" writes a new eforge/profiles/<name>.yaml (optionally pass `metadata` with `description`, `whenToUse`, and `tags` — descriptive only, does not affect runtime behavior); "delete" removes a profile (refuses when active unless force: true). |
| `eforge_extension` | Manage native eforge extensions with compact host-safe output by default; use CLI --json or daemon/client HTTP surfaces for raw schemas, diagnostics, and detail arrays. Actions: "list" returns compact extension entries with status/provenance/diagnostic counts; "show" returns one compact extension by name; "validate" returns valid:false when extension load errors exist, optionally scoped to a name or ad-hoc path; "test" dry-runs onEvent hooks against fixture or monitor events; "new" scaffolds an extension; "reload" refreshes discovery and restarts the runtime watcher when running; "trust" writes a local trust record for a project-team extension without executing it; "untrust" removes the trust record for a project-team extension; "install" installs a package extension from npm, a local path, or tarball; "update" updates an installed extension package; "remove" removes an installed extension package; "promote" promotes a project-local extension to project-team scope; "demote" demotes a project-team extension to project-local scope. |
| `eforge_models` | List providers or models available for a given harness. Actions: "providers" returns provider names (claude-sdk is implicit / returns []); "list" returns models, optionally filtered to a single provider, newest-first. |
| `eforge_daemon` | Manage the eforge daemon lifecycle: start, stop, or restart the daemon. |
| `eforge_auto_build` | Get or set the daemon auto-build state. When enabled, the daemon automatically builds PRDs as they are enqueued. |
| `eforge_init` | Initialize eforge in a project. The skill is responsible for picking provider/model interactively; the tool is a pure persister. Pass `profile` with the assembled multi-runtime spec (every runtime must use harness: 'pi'). With migrate: true, extracts legacy harness config from a pre-overhaul config.yaml. Pass `trunkBranch` and `allowLocalMergeToTrunk` to configure the branch protection policy. |
| `eforge_confirm_build` | Open an editor-first review flow so the user can revise, confirm, or cancel a build source before enqueuing. Returns the user's choice and confirmed source. |
| `eforge_recover` | Trigger failure recovery analysis for a failed build plan. Spawns the recovery agent as a background subprocess and returns its sessionId and pid. |
| `eforge_read_recovery_sidecar` | Read the recovery analysis sidecar files for a failed build plan. Returns both the markdown summary and the structured JSON verdict produced by the recovery agent. |
| `eforge_apply_recovery` | Apply the recovery verdict for a failed build plan. The action is performed in-process by the daemon and completes synchronously — no worker subprocess is spawned. Response shape includes verdict: 'retry' \| 'continue-repair' \| 'abandon' \| 'manual'. retry starts fresh, continue-repair queues preserved compiled artifacts for repair, abandon archives the failed PRD, and manual returns noAction: true without mutation. |
| `eforge_continue_repair` | Queue a continue-and-repair build from preserved compiled artifacts. Use when a failed PRD has eligible compiled artifacts and should continue from them with repair work. Returns queued metadata including PRD id, set name, branches, moved descendants, and optional profile; no sessionId or pid is returned. Always confirm with the user before calling this tool. |
| `eforge_session_plan` | Manage session plans in eforge. Actions: "list-active" returns all active (planning/ready) session plans; "show" returns a single session plan's data and readiness detail; "create" creates a new session plan file; "set-section" writes a dimension section to the session file; "skip-dimension" records a skipped dimension with a reason; "set-status" updates the session plan status (e.g. to "ready" or "abandoned"); "select-dimensions" sets planning type and depth and populates the required/optional dimension lists from the selected planning template; "readiness" checks whether all required dimensions are covered; "migrate-legacy" converts a legacy boolean-dimensions session file to the current shape. Pass open: true on "create" or "show" to best-effort open the session plan file in the default application. |
| `eforge_stack_sync` | Synchronize the git-spice stack for the current project. Runs the stack sync operation via the eforge daemon and returns a structured report. Set dryRun: true to preview what commands would run without executing them. When active builds are running, the sync may be deferred — check the outcome field in the response and retry when active builds complete, or use activeBuildPolicy: 'defer' to get a retryable deferred result instead of skipping. |
| `eforge_extension_contribution` | List, show, and invoke extension-provided actions, integration commands, and action-backed deep links with compact formatted output by default. List supports kind, extensionName, search, idPrefix, outputProfile, limit, offset, includeInputSchema, includeDiagnostics, and full; show supports id, kind, includeInputSchema, includeDiagnostics, and full. Failed invocations return a summarized error envelope without target.input. Distinct from eforge_extension extension management. |

## Skill surfaces

Slash-command skills for Claude Code (plugin) and Pi are kept in parity.
Rows are generated from the docs generator skill-pair map and frontmatter in `eforge-plugin/skills/` and `packages/pi-eforge/skills/`.
`scripts/check-skill-parity.mjs` verifies narrative parity for its checked skill subset.

| Skill (Claude Code `/eforge:<name>`) | Skill (Pi `eforge:<name>`) | Description |
|--------------------------------------|---------------------------|-------------|
| `profile` | `eforge-profile` | List, inspect, and switch agent runtime profiles |
| `profile-new` | `eforge-profile-new` | Create a new agent runtime profile in eforge/profiles/ |
| `build` | `eforge-build` | Enqueue a source for the eforge daemon to build via MCP tool |
| `config` | `eforge-config` | Initialize or edit eforge/config.yaml team-wide settings, with validation via MCP tool |
| `init` | `eforge-init` | Initialize eforge in the current project with an interactive setup form |
| `workflow` | `eforge-workflow` | Set up or reconfigure the eforge workflow preset — landing action, stacking, PR settings, and automatic stack sync |
| `stack` | `eforge-stack` | Synchronize the git-spice stack, preview with dry-run, interpret the sync report, and recover from manual sync conflicts |
| `extend` | `eforge-extend` | Author eforge TypeScript extensions from a natural-language request using the existing extension tooling and docs/examples |
| `restart` | `eforge-restart` | Safely restart the eforge daemon, checking for active builds first |
| `status` | `eforge-status` | Check eforge run status and queue state via MCP tools |
| `update` | `eforge-update` | Check for eforge updates and guide through updating the CLI package, daemon, and plugin |
| `recover` | `eforge-recover` | Inspect the recovery verdict for a failed PRD and apply the recommended action (retry, continue-repair, abandon, or manual) |
