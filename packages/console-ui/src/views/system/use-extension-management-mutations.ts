/**
 * System-only management hook for the extension management surface.
 *
 * Backs reload, selected validate, and the row mutations (trust, re-trust,
 * untrust, promote, demote). Tracks a single in-flight row mutation plus
 * per-extension error and success messages keyed by path, the most recent
 * reload result, and the most recent selected-validation result. After every
 * successful mutating action it invokes the caller-supplied refresh callback
 * before recording success feedback, so the section reloads authoritative data
 * first. Selected validation is a read and is stored separately from the global
 * validation summary.
 */
import { useCallback, useRef, useState } from 'react';
import {
  reloadSystemExtensions,
  validateSelectedSystemExtension,
  trustSystemExtension,
  untrustSystemExtension,
  promoteSystemExtension,
  demoteSystemExtension,
} from './system-fetches';
import { extensionKey, selectValidateTarget } from './extension-management-selectors';
import type { ExtensionMutationAction } from './extension-management-selectors';
import type {
  ExtensionEntry,
  ExtensionReloadResponse,
  ExtensionValidateResponse,
} from './system-types';

/** Identity of the row mutation currently in flight. */
export interface PendingExtensionMutation {
  action: ExtensionMutationAction;
  path: string;
}

/** Local state for the most recent selected-extension validation. */
export interface SelectedValidationState {
  pending: boolean;
  error: string | null;
  result: ExtensionValidateResponse | null;
  /** Key of the extension the result/error/pending state belongs to. */
  key: string | null;
}

/** Local state for the most recent global reload. */
export interface ReloadState {
  pending: boolean;
  error: string | null;
  result: ExtensionReloadResponse | null;
}

/** Controls consumed by the System extension management components. */
export interface ExtensionManagementControls {
  /** The row mutation in flight, or null when idle. */
  pending: PendingExtensionMutation | null;
  /** Latest error message per extension path. */
  errors: Record<string, string>;
  /** Latest success/next-step message per extension path. */
  successes: Record<string, string>;
  /** Dispatch a mutating row action for the extension at `path`. */
  onMutate: (action: ExtensionMutationAction, path: string) => void;
  /** Reload state and trigger. */
  reload: ReloadState;
  onReload: () => void;
  /** Selected-validation state and trigger. */
  validation: SelectedValidationState;
  onValidateSelected: (ext: ExtensionEntry) => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Await the caller's refresh callback before recording success feedback. A
 * rejected refresh promise is swallowed here so it can never surface as a
 * mutation/reload error or escape as an unhandled promise rejection; the next
 * manual reload resurfaces any underlying problem.
 */
async function runRefresh(onSuccess?: () => void | Promise<void>): Promise<void> {
  try {
    await onSuccess?.();
  } catch {
    // Refresh failures must not block or corrupt success feedback.
  }
}

function dispatchMutation(action: ExtensionMutationAction, path: string) {
  switch (action) {
    case 'trust':
    case 're-trust':
      return trustSystemExtension(path);
    case 'untrust':
      return untrustSystemExtension(path);
    case 'promote':
      return promoteSystemExtension(path);
    case 'demote':
      return demoteSystemExtension(path);
  }
}

/**
 * @param onSuccess Invoked once after each successful mutating action (row
 *   mutation or reload) so the caller can refresh the underlying extension data
 *   before success feedback is recorded.
 */
export function useExtensionManagementMutations(
  onSuccess?: () => void | Promise<void>,
): ExtensionManagementControls {
  const [pending, setPending] = useState<PendingExtensionMutation | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successes, setSuccesses] = useState<Record<string, string>>({});
  const [reload, setReload] = useState<ReloadState>({ pending: false, error: null, result: null });
  const [validation, setValidation] = useState<SelectedValidationState>({
    pending: false,
    error: null,
    result: null,
    key: null,
  });

  const mutationInFlight = useRef(false);
  const reloadInFlight = useRef(false);
  const validateInFlight = useRef(false);

  const clearKey = useCallback((path: string) => {
    setErrors((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setSuccesses((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }, []);

  const onMutate = useCallback(
    (action: ExtensionMutationAction, path: string) => {
      if (mutationInFlight.current) return;
      mutationInFlight.current = true;
      setPending({ action, path });
      clearKey(path);

      void dispatchMutation(action, path)
        .then(async (response) => {
          await runRefresh(onSuccess);
          setSuccesses((prev) => ({ ...prev, [path]: response.message }));
        })
        .catch((err) => {
          setSuccesses((prev) => {
            if (!(path in prev)) return prev;
            const next = { ...prev };
            delete next[path];
            return next;
          });
          setErrors((prev) => ({ ...prev, [path]: errorMessage(err) }));
        })
        .finally(() => {
          mutationInFlight.current = false;
          setPending(null);
        });
    },
    [clearKey, onSuccess],
  );

  const onReload = useCallback(() => {
    if (reloadInFlight.current) return;
    reloadInFlight.current = true;
    setReload({ pending: true, error: null, result: null });

    void reloadSystemExtensions()
      .then(async (result) => {
        await runRefresh(onSuccess);
        setReload({ pending: false, error: null, result });
      })
      .catch((err) => {
        setReload({ pending: false, error: errorMessage(err), result: null });
      })
      .finally(() => {
        reloadInFlight.current = false;
      });
  }, [onSuccess]);

  const onValidateSelected = useCallback((ext: ExtensionEntry) => {
    if (validateInFlight.current) return;
    validateInFlight.current = true;
    const key = extensionKey(ext);
    setValidation({ pending: true, error: null, result: null, key });

    void validateSelectedSystemExtension(selectValidateTarget(ext))
      .then((result) => {
        setValidation({ pending: false, error: null, result, key });
      })
      .catch((err) => {
        setValidation({ pending: false, error: errorMessage(err), result: null, key });
      })
      .finally(() => {
        validateInFlight.current = false;
      });
  }, []);

  return { pending, errors, successes, onMutate, reload, onReload, validation, onValidateSelected };
}
