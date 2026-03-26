# npm install test environment

Docker-based isolated environment for testing eforge as end users experience it - installed from the npm registry via the Claude Code plugin marketplace, not from a local build.

## Why

Local development puts eforge on PATH via `pnpm build`, so `npx -y eforge` resolves to the local build. This container has no local eforge - npx pulls directly from npm, matching the real user install path.

## Usage

```bash
# Build and start
docker compose up -d --build

# Attach
docker compose exec eforge-test bash

# First time: authenticate Claude Code (opens URL in your browser)
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

# Destroy auth volume (to re-authenticate)
docker compose down -v
```

## Auth persistence

Claude Code credentials are stored in a named Docker volume (`claude-auth`) mounted at `/root/.claude`. This persists between `docker compose down` / `up` cycles. Only `docker compose down -v` deletes it.

## Verifying the npm version

```bash
docker compose run --rm eforge-test npx -y eforge --version
```

This should match the latest version on npm, not your local `package.json` version.
