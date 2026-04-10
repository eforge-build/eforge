# npm install test environment

Docker-based isolated environment for testing eforge as end users experience it - installed from the npm registry via the Claude Code plugin marketplace, not from a local build.

## Why

Local development puts eforge on PATH via `pnpm build`, so `npx -y @eforge-build/eforge` resolves to the local build. This container has no local eforge - npx pulls directly from npm, matching the real user install path.

## Usage

All commands run from `test/npm-install/`.

```bash
# Build and start
docker compose up -d --build

# Attach
docker compose exec eforge-test bash

# First time only: complete Claude Code setup (opens URL in your browser)
claude

# Add the eforge plugin from marketplace
# /plugin marketplace add eforge-build/eforge
# /plugin install eforge@eforge

# Test the flow
# /eforge:build "Add a health check endpoint"

# Exit container
exit

# Stop (auth persists)
docker compose down

# Destroy auth volume (to start fresh)
docker compose down -v
```

## Auth persistence

Claude Code stores state in two places:
- `~/.claude/` - credentials, plugins, session data
- `~/.claude.json` - onboarding state, account info, feature flags

Both are persisted via a named Docker volume (`claude-auth`) mounted at `/root/.claude`. An entrypoint script symlinks `~/.claude.json` into the volume so it survives container recreation. Auth and setup persist across `docker compose down` / `up --build` cycles. Only `docker compose down -v` resets everything.

## Verifying the npm version

```bash
docker compose run --rm eforge-test npx -y @eforge-build/eforge --version
```

This should match the latest version on npm, not your local `package.json` version.
