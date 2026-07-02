# Add health check endpoint

## Overview

Expose a lightweight health check endpoint so deployment tooling can verify the API process is alive.

## Requirements

1. A `GET /health` route returns HTTP 200 with a JSON body of `{ "status": "ok" }`.
2. The route is mounted at the app level (not under `/todos`) so it works without any todo state.
3. A test verifies the endpoint returns 200 and the expected JSON body.

## Non-goals

- No dependency or database connectivity checks.
- No authentication on the health endpoint.
