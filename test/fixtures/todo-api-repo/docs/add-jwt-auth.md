# Add JWT authentication

## Overview

Protect todo mutation routes with JWT bearer authentication while keeping read routes public.

## Requirements

1. `POST /todos` and `DELETE /todos/:id` require a valid JWT bearer token.
2. `GET` routes remain public.
3. Invalid or missing tokens receive HTTP 401 with a JSON error body.
4. Tests cover authorized, unauthorized, and malformed-token requests.

## Non-goals

- No refresh tokens or token issuance endpoints; tokens are provisioned externally.
