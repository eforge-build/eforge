export function createLinkedAbortController(parentSignal?: AbortSignal): AbortController & { dispose: () => void } {
  const controller = new AbortController() as AbortController & { dispose: () => void };
  const abortChild = () => controller.abort();
  if (parentSignal?.aborted) {
    controller.abort();
    controller.dispose = () => {};
  } else {
    parentSignal?.addEventListener('abort', abortChild, { once: true });
    controller.dispose = () => parentSignal?.removeEventListener('abort', abortChild);
  }
  return controller;
}
