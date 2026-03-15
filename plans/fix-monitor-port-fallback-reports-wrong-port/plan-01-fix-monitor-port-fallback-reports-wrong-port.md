---
id: plan-01-fix-monitor-port-fallback-reports-wrong-port
name: "Fix: Monitor port fallback reports wrong port"
depends_on: []
branch: fix-monitor-port-fallback-reports-wrong-port/main
---

# Fix: Monitor port fallback reports wrong port

## Context

When a monitor port is already in use (e.g., port 4567 taken by another eforge run), the server correctly falls back to the next port (4568). However, the CLI prints the wrong (original) port to the user. This happens because of a stale callback bug in the `listen()` function in `src/monitor/server.ts`.

## Root cause

`server.listen(port, host, callback)` internally registers `callback` via `this.once('listening', callback)`. When the listen fails with `EADDRINUSE`, the error event fires but the stale `listening` callback is **not removed**. On retry with the next port, both the stale callback (wrong port) and the new callback (correct port) fire - and the stale one fires first, resolving the promise with the wrong port number.

This cascades: `startServer` returns the wrong port, the lockfile is written with the wrong port, and the CLI displays the wrong URL.

## Fix

**File: `src/monitor/server.ts` - `listen()` function (lines 341-363)**

Stop passing the callback to `server.listen()`. Instead, explicitly manage `listening` and `error` handlers so we can clean up the stale `listening` handler in the error path:

```typescript
function listen(server: Server, port: number, maxRetries = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function tryListen(p: number): void {
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && attempts < maxRetries) {
          attempts++;
          tryListen(p + 1);
        } else {
          reject(err);
        }
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve(p);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, '127.0.0.1');
    }

    tryListen(port);
  });
}
```

Key change: `onError` now calls `server.removeListener('listening', onListening)` to remove the stale listener before retrying. No callback is passed to `server.listen()`, so Node.js doesn't add its own internal `once('listening', ...)` that we can't clean up.

## Verification

1. `pnpm build` - ensure clean build
2. Start a monitor on port 4567: `pnpm dev -- monitor`
3. In another terminal, run eforge (e.g., `pnpm dev -- plan some-prd.md --verbose`) - it should print `Monitor: http://localhost:4568` (not 4567)
4. Open `http://localhost:4568` in a browser to confirm the monitor is serving
5. `pnpm test` - ensure no regressions
