<!-- Generated file. Do not edit. -->
<!-- Source: packages/eforge/src/cli/index.ts, packages/eforge/src/cli/daemon-lifecycle.ts, packages/eforge/src/cli/queue-control.ts -->

# eforge CLI Reference

Autonomous plan-build-review CLI for code generation.

**Usage:** `eforge [command] [options]`

## Commands

### `playbook`

**Full command:** `eforge playbook`

Manage eforge playbooks through eforge-playbooks host contributions


#### `list`

**Full command:** `eforge playbook list`

List playbooks


**Options:**

| Flag | Description |
|------|-------------|
| `--scope <scope>` | Filter by scope |
| `--mode <mode>` | Filter by mode |
| `--include-shadowed` | Include shadowed playbooks |
| `--json` | Output JSON |

#### `show`

**Full command:** `eforge playbook show`

Show a playbook


**Options:**

| Flag | Description |
|------|-------------|
| `--scope <scope>` | Resolve from an exact scope |
| `--json` | Output JSON |

#### `new`

**Full command:** `eforge playbook new`

Create a playbook in $EDITOR


**Options:**

| Flag | Description |
|------|-------------|
| `--scope <scope>` | Target scope |
| `--mode <mode>` | Playbook mode |
| `--profile <profile>` | Agent profile |
| `--json` | Output JSON |

#### `edit`

**Full command:** `eforge playbook edit`

Edit a playbook in $EDITOR


**Options:**

| Flag | Description |
|------|-------------|
| `--scope <scope>` | Resolve from an exact scope |
| `--json` | Output JSON |

#### `save`

**Full command:** `eforge playbook save`

Save a playbook


**Options:**

| Flag | Description |
|------|-------------|
| `--scope <scope>` | Target scope |
| `--raw <markdown>` | Raw playbook Markdown |
| `--file <path>` | Read raw playbook Markdown from a file |
| `--overwrite <boolean>` | Overwrite existing playbook |
| `--json` | Output JSON |

#### `validate`

**Full command:** `eforge playbook validate`

Validate raw playbook Markdown


**Options:**

| Flag | Description |
|------|-------------|
| `--raw <markdown>` | Raw playbook Markdown |
| `--file <path>` | Read raw playbook Markdown from a file |
| `--scope <scope>` | Validation scope |
| `--json` | Output JSON |

#### `copy`

**Full command:** `eforge playbook copy`

Copy a playbook to another scope


**Options:**

| Flag | Description |
|------|-------------|
| `--target-scope <scope>` | Target scope |
| `--source-scope <scope>` | Source scope |
| `--overwrite <boolean>` | Overwrite target playbook |
| `--json` | Output JSON |

#### `promote`

**Full command:** `eforge playbook promote`

Promote a playbook


**Options:**

| Flag | Description |
|------|-------------|
| `--overwrite <boolean>` | Overwrite target playbook |
| `--json` | Output JSON |

#### `demote`

**Full command:** `eforge playbook demote`

Demote a playbook


**Options:**

| Flag | Description |
|------|-------------|
| `--overwrite <boolean>` | Overwrite target playbook |
| `--json` | Output JSON |

#### `run`

**Full command:** `eforge playbook run`

Run a playbook


**Options:**

| Flag | Description |
|------|-------------|
| `--scope <scope>` | Resolve from an exact scope |
| `--mode <mode>` | Expected playbook mode |
| `--profile <profile>` | Agent profile override |
| `--after <queue-id>` | Queue after an upstream queue item |
| `--landing-action <action>` | Landing action: pr, merge, or leave |
| `--landing-auto-merge <boolean>` | Enable or disable PR auto-merge |
| `--json` | Output JSON |

### `play`

**Full command:** `eforge play`

Alias for eforge playbook run <name>


**Options:**

| Flag | Description |
|------|-------------|
| `--scope <scope>` | Resolve from an exact scope |
| `--mode <mode>` | Expected playbook mode |
| `--profile <profile>` | Agent profile override |
| `--after <queue-id>` | Queue after an upstream queue item |
| `--landing-action <action>` | Landing action: pr, merge, or leave |
| `--landing-auto-merge <boolean>` | Enable or disable PR auto-merge |
| `--json` | Output JSON |

### `enqueue`

**Full command:** `eforge enqueue`

Normalize input and add it to the PRD queue


**Options:**

| Flag | Description |
|------|-------------|
| `--name <name>` | Override the inferred PRD title |
| `--verbose` | Stream agent output |
| `--no-plugins` | Disable plugin loading |
| `--profile <name>` | Override active profile for this enqueue + build |
| `--landing-action <action>` | Landing action for this build (pr\|merge\|leave) |
| `--landing-auto-merge` | Enable PR auto-merge for this build |
| `--no-landing-auto-merge` | Disable PR auto-merge for this build |
| `--after <queue-id>` | Explicit upstream dependency: waits in waiting/ if the upstream is active; enqueues immediately as an eligible dependent if the upstream completed with a usable artifact |
| `--post-merge <command>` | Per-enqueue post-merge validation command (repeatable) |

### `build`

**Full command:** `eforge build`

Compile + build + validate in one step

**Alias:** `run`


**Options:**

| Flag | Description |
|------|-------------|
| `--auto` | Run without approval gates |
| `--verbose` | Stream agent output |
| `--name <name>` | Plan set name (inferred from source if omitted) |
| `--queue` | Process all PRDs from the queue |
| `--max-concurrent-builds <n>` | Max parallel queue PRDs |
| `--dry-run` | Compile only, then show execution plan without building |
| `--foreground` | Run in-process instead of delegating to daemon |
| `--no-cleanup` | Keep plan files after successful build |
| `--no-monitor` | Disable web monitor |
| `--no-plugins` | Disable plugin loading |
| `--watch` | Watch mode: continuously poll the queue for new PRDs |
| `--poll-interval <ms>` | Poll interval in milliseconds for watch mode |
| `--profile <name>` | Override active profile for this build |
| `--landing-action <action>` | Landing action for this build (pr\|merge\|leave) |
| `--landing-auto-merge` | Enable PR auto-merge for this build |
| `--no-landing-auto-merge` | Disable PR auto-merge for this build |
| `--after <queue-id>` | Explicit upstream dependency: waits in waiting/ if the upstream is active; enqueues immediately as an eligible dependent if the upstream completed with a usable artifact |

### `monitor`

**Full command:** `eforge monitor`

Start or connect to the monitor dashboard


**Options:**

| Flag | Description |
|------|-------------|
| `--port <port>` | Preferred port |

### `status`

**Full command:** `eforge status`

Check running builds


### `queue`

**Full command:** `eforge queue`

Manage PRD queue


#### `priority`

**Full command:** `eforge queue priority`

Update the priority for a pending or waiting PRD queue item


#### `remove`

**Full command:** `eforge queue remove`

Remove a non-running PRD queue item


#### `list`

**Full command:** `eforge queue list`

Show PRDs in the queue


#### `run`

**Full command:** `eforge queue run`

Process PRDs from the queue


**Options:**

| Flag | Description |
|------|-------------|
| `--all` | Process all pending PRDs |
| `--auto` | Run without approval gates |
| `--verbose` | Stream agent output |
| `--no-monitor` | Disable web monitor |
| `--no-plugins` | Disable plugin loading |
| `--max-concurrent-builds <n>` | Max parallel queue PRDs |
| `--watch` | Watch mode: continuously poll the queue for new PRDs |
| `--poll-interval <ms>` | Poll interval in milliseconds for watch mode |
| `--landing-action <action>` | Landing action for this build (pr\|merge\|leave) |
| `--landing-auto-merge` | Enable PR auto-merge for this build |
| `--no-landing-auto-merge` | Disable PR auto-merge for this build |

#### `exec`

**Full command:** `eforge queue exec`

Build a single PRD directly (subprocess entry point for the queue scheduler)


**Options:**

| Flag | Description |
|------|-------------|
| `--auto` | Run without approval gates |
| `--verbose` | Stream agent output |
| `--no-monitor` | Disable web monitor |
| `--no-plugins` | Disable plugin loading |
| `--session-id <uuid>` | Session ID injected by parent scheduler (skips child session:start emission) |
| `--profile <name>` | Override active profile for this build |
| `--landing-action <action>` | Landing action for this build (pr\|merge\|leave) |
| `--landing-auto-merge <bool>` | Enable PR auto-merge for this build (true\|false) |

### `extension`

**Full command:** `eforge extension`

Manage native eforge extensions


#### `list`

**Full command:** `eforge extension list`

List discovered native extensions


**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Output JSON |

#### `show`

**Full command:** `eforge extension show`

Show one native extension by name


**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Output JSON |

#### `validate`

**Full command:** `eforge extension validate`

Validate configured native extensions, or a single extension name/path


**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Output JSON |

#### `test`

**Full command:** `eforge extension test`

Dry-run native extension event hooks against fixture or monitor events


**Options:**

| Flag | Description |
|------|-------------|
| `--run <run>` | Replay monitor DB events: latest or a session/run id |
| `--event <type>` | Filter replay input by exact event type |
| `--fixture <path>` | Replay project-local fixture events from a JSON or JSONL file |
| `--json` | Output JSON |

#### `new`

**Full command:** `eforge extension new`

Scaffold a native eforge extension


**Options:**

| Flag | Description |
|------|-------------|
| `--scope <scope>` | Extension scope: local, project, or user |
| `--template <template>` | Scaffold template |
| `--force` | Overwrite an existing extension file |
| `--json` | Output JSON |

#### `reload`

**Full command:** `eforge extension reload`

Reload native extension discovery and restart the daemon watcher when running


**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Output JSON |

#### `trust`

**Full command:** `eforge extension trust`

Trust a project-team native extension by name or path


**Options:**

| Flag | Description |
|------|-------------|
| `--trusted-by <identity>` | Optional annotation identifying who is trusting the extension |
| `--json` | Output JSON |

#### `untrust`

**Full command:** `eforge extension untrust`

Remove trust for a project-team native extension by name or path


**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Output JSON |

#### `install`

**Full command:** `eforge extension install`

Install a native extension package from an npm package, local path, or tarball


**Options:**

| Flag | Description |
|------|-------------|
| `--scope <scope>` | Extension scope: local, project, or user |
| `--name <name>` | Logical extension name override |
| `--force` | Overwrite an existing extension at the target scope |
| `--trust` | Trust the extension after install (project-team scope only) |
| `--trusted-by <identity>` | Optional annotation identifying who is trusting the extension |
| `--json` | Output JSON |

#### `update`

**Full command:** `eforge extension update`

Update an installed extension package to the latest version


**Options:**

| Flag | Description |
|------|-------------|
| `--version <specifier>` | Version specifier or dist-tag for npm-installed extensions |
| `--trust` | Trust the extension after update (project-team scope only) |
| `--trusted-by <identity>` | Optional annotation identifying who is trusting the extension |
| `--json` | Output JSON |

#### `remove`

**Full command:** `eforge extension remove`

Remove an installed extension package


**Options:**

| Flag | Description |
|------|-------------|
| `--force` | Remove without confirmation |
| `--json` | Output JSON |

#### `promote`

**Full command:** `eforge extension promote`

Promote a project-local extension to project-team scope


**Options:**

| Flag | Description |
|------|-------------|
| `--force` | Overwrite an existing extension at project-team scope |
| `--trust` | Trust the extension after promotion |
| `--trusted-by <identity>` | Optional annotation identifying who is trusting the extension |
| `--json` | Output JSON |

#### `demote`

**Full command:** `eforge extension demote`

Demote a project-team extension to project-local scope


**Options:**

| Flag | Description |
|------|-------------|
| `--force` | Overwrite an existing extension at project-local scope |
| `--json` | Output JSON |

#### `contributions`

**Full command:** `eforge extension contributions`

Discover and invoke extension-provided host contributions


##### `list`

**Full command:** `eforge extension contributions list`

List extension-provided actions, integration commands, and deep links


**Options:**

| Flag | Description |
|------|-------------|
| `--kind <kind>` | Contribution kind: action, command, deep-link, or all |
| `--extension-name <name>` | Filter to one extension name |
| `--search <text>` | Search id, label, description, extension, and action metadata |
| `--id-prefix <prefix>` | Filter to contribution ids with this prefix |
| `--output-profile <profile>` | Filter by action output profile |
| `--limit <number>` | Maximum entries to return |
| `--offset <number>` | Zero-based pagination offset |
| `--include-schema` | Include input schemas/defaults in the list projection |
| `--include-diagnostics` | Include manifest diagnostics in the list projection |
| `--full` | Use the full projection, including schemas and diagnostics |
| `--json` | Output JSON |

##### `show`

**Full command:** `eforge extension contributions show`

Show one extension action, integration command, or deep link contribution


**Options:**

| Flag | Description |
|------|-------------|
| `--kind <kind>` | Contribution kind: action, command, or deep-link |
| `--include-schema` | Include input schema/defaults in the detail projection |
| `--include-diagnostics` | Include manifest diagnostics in the detail projection |
| `--full` | Use the full projection, including schema and diagnostics |
| `--json` | Output JSON |

##### `invoke`

**Full command:** `eforge extension contributions invoke`

Invoke an extension action, integration command, or action-backed deep link


**Options:**

| Flag | Description |
|------|-------------|
| `--kind <kind>` | Contribution kind: action, command, or deep-link |
| `--input-json <json>` | JSON object input for the action |
| `--input-file <path>` | Path to a JSON object input file |
| `--json` | Output JSON |

### `config`

**Full command:** `eforge config`

Manage eforge configuration


#### `validate`

**Full command:** `eforge config validate`

Validate eforge/config.yaml configuration


#### `show`

**Full command:** `eforge config show`

Show resolved eforge configuration


### `debug-composer`

**Full command:** `eforge debug-composer`

Run only the pipeline-composer stage under one or more backend profiles and dump the request payload each backend constructs (system prompt, tools, model, thinking) for side-by-side diffing. Use --backend <name> to select profiles; repeat to compare multiple.


**Options:**

| Flag | Description |
|------|-------------|
| `--backend <name>` | Backend profile to test (repeatable). Defaults to the currently-active profile. |
| `--out <dir>` | Output directory for captured payloads |
| `--verbose` | Stream composer agent messages to stdout |

### `daemon`

**Full command:** `eforge daemon`

Manage persistent daemon server


#### `start`

**Full command:** `eforge daemon start`

Start the persistent daemon server


**Options:**

| Flag | Description |
|------|-------------|
| `--port <port>` | Preferred port |

#### `stop`

**Full command:** `eforge daemon stop`

Stop the persistent daemon server


**Options:**

| Flag | Description |
|------|-------------|
| `--force` | Skip active-build safety check |

#### `restart`

**Full command:** `eforge daemon restart`

Restart the persistent daemon server


**Options:**

| Flag | Description |
|------|-------------|
| `--force` | Skip active-build safety check |

#### `status`

**Full command:** `eforge daemon status`

Show daemon status


#### `kill`

**Full command:** `eforge daemon kill`

Force-kill the daemon (SIGKILL)


### `ignite`

**Full command:** `eforge ignite`

Playful alias for `eforge daemon start`


**Options:**

| Flag | Description |
|------|-------------|
| `--port <port>` | Preferred port |

### `douse`

**Full command:** `eforge douse`

Playful alias for `eforge daemon stop`


**Options:**

| Flag | Description |
|------|-------------|
| `--force` | Skip active-build safety check |

### `reignite`

**Full command:** `eforge reignite`

Playful alias for `eforge daemon restart`


**Options:**

| Flag | Description |
|------|-------------|
| `--force` | Skip active-build safety check |

### `recover`

**Full command:** `eforge recover`

Analyse a failed build and write recovery sidecar files


**Options:**

| Flag | Description |
|------|-------------|
| `--cwd <cwd>` | Working directory override |
| `--verbose` | Stream agent output |
| `--no-monitor` | Disable web monitor |

### `apply-recovery`

**Full command:** `eforge apply-recovery`

Apply the recovery verdict for a failed build plan (retry from scratch, continue-and-repair, abandon, or manual)


**Options:**

| Flag | Description |
|------|-------------|
| `--cwd <cwd>` | Working directory override |
| `--no-monitor` | Disable web monitor |

### `continue-repair`

**Full command:** `eforge continue-repair`

Continue and repair build from preserved compiled artifacts


**Options:**

| Flag | Description |
|------|-------------|
| `--set-name <setName>` | Override the set name; when omitted, resolved from recovery sidecar or derived from the prdId |
| `--profile <name>` | Override active profile for this continue-and-repair build |
| `--cwd <cwd>` | Working directory override |
| `--verbose` | Print additional queued metadata |

### `mcp-proxy`

**Full command:** `eforge mcp-proxy`

Run the MCP stdio proxy server (used by Claude Code plugin)


### `stack`

**Full command:** `eforge stack`

Stack management commands


#### `sync`

**Full command:** `eforge stack sync`

Sync the git-spice stack with remote and restack eligible branches


**Options:**

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what commands would run without executing them |
| `--cwd <cwd>` | Working directory override |

## Global options

**Options:**

| Flag | Description |
|------|-------------|
| `-V, --version` | output the version number |
