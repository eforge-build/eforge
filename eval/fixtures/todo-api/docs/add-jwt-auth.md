# Add JWT Authentication

## Overview

Add JWT-based authentication to the todo API. All todo endpoints should require a valid JWT token, while the health check endpoint (if it exists) should remain public.

## Requirements

### Auth middleware

1. Create an auth middleware that:
   - Reads the `Authorization` header (expects `Bearer <token>`)
   - Verifies the JWT using a secret from `process.env.JWT_SECRET` (default: `"dev-secret"` for development)
   - Rejects requests with 401 if no token or invalid token
   - Attaches decoded user info to the request for downstream use

2. Install the `jsonwebtoken` npm package (and `@types/jsonwebtoken` as a dev dependency) for JWT operations.

### Protected routes

3. Apply the auth middleware to all `/todos` routes.
4. The `GET /health` endpoint (if present) must remain unauthenticated.

### Data model changes

5. Add a `userId` field (string) to the `Todo` interface in `db.ts`.
6. Update `createTodo` to accept and store a `userId` parameter.
7. Update `getAllTodos`, `getTodoById`, `updateTodo`, and `deleteTodo` to accept a `userId` parameter and filter results to only that user's todos.
8. Update `clearTodos` to continue clearing all data (used by tests).

### User context

9. Each todo should be associated with the authenticated user's ID (from the JWT `sub` claim).
10. Users should only see and modify their own todos. Requests for another user's todo should return 404 (do not reveal existence).

### Tests

11. Add tests that verify:
   - Requests without a token return 401
   - Requests with an invalid token return 401
   - Requests with a valid token can create and list todos
   - Users cannot see other users' todos

## Non-goals

- No user registration or login endpoints (tokens are created externally)
- No refresh token mechanism
- No role-based access control
