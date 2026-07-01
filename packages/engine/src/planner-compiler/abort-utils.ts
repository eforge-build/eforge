export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export function composeAbortSignal(parent: AbortSignal | undefined, child: AbortSignal): AbortSignal {
  if (!parent) return child;
  const anyAbortSignal = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (anyAbortSignal) return anyAbortSignal([parent, child]);
  const controller = new AbortController();
  const abort = (): void => { controller.abort(); };
  if (parent.aborted || child.aborted) abort();
  else {
    parent.addEventListener('abort', abort, { once: true });
    child.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}
