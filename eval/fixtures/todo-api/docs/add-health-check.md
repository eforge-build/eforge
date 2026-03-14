# Add Health Check Endpoint

## Overview

Add a `GET /health` endpoint to the todo API that returns the server's health status. This is needed for load balancer health checks and monitoring.

## Requirements

1. Add a `GET /health` route that returns:
   - HTTP 200 status
   - JSON body: `{ "status": "ok", "timestamp": "<ISO 8601 timestamp>" }`

2. The endpoint should be mounted at the app level (not under `/todos`).

3. Add a test that verifies:
   - The endpoint returns 200
   - The response body has `status: "ok"`
   - The response body has a valid `timestamp` field

## Non-goals

- No database connectivity checks (we use an in-memory store)
- No authentication on this endpoint
