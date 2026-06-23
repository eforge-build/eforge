/**
 * Hook that fetches all System surfaces on mount and on demand refresh.
 * Aborts stale requests on unmount or refresh. Each surface has independent Loadable state
 * so one failed endpoint does not hide other available daemon data.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import type { SystemSurfacesState } from './system-types';
import {
  SYSTEM_MODEL_HARNESSES,
  fetchSystemHealth,
  fetchSystemVersion,
  fetchSystemProjectContext,
  fetchSystemConfigShow,
  fetchSystemConfigValidate,
  fetchSystemProfileList,
  fetchSystemProfileShow,
  fetchSystemExtensionList,
  fetchSystemExtensionValidate,
  fetchSystemExtensionContributionManifest,
  fetchSystemModelProviders,
  fetchSystemModelList,
} from './system-fetches';

function makeInitialState(): SystemSurfacesState {
  return {
    daemon: {
      health: { status: 'idle' },
      version: { status: 'idle' },
      projectContext: { status: 'idle' },
    },
    config: {
      show: { status: 'idle' },
      validate: { status: 'idle' },
    },
    profiles: {
      list: { status: 'idle' },
      active: { status: 'idle' },
    },
    extensions: {
      list: { status: 'idle' },
      validate: { status: 'idle' },
      contributions: { status: 'idle' },
    },
    models: {
      catalogs: {
        pi: { providers: { status: 'idle' }, models: { status: 'idle' } },
        'claude-sdk': { providers: { status: 'idle' }, models: { status: 'idle' } },
      },
    },
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useSystemSurfaces() {
  const [state, setState] = useState<SystemSurfacesState>(makeInitialState);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const now = Date.now();

    setState((prev) => ({
      daemon: {
        health: { status: 'loading', data: prev.daemon.health.data },
        version: { status: 'loading', data: prev.daemon.version.data },
        projectContext: { status: 'loading', data: prev.daemon.projectContext.data },
      },
      config: {
        show: { status: 'loading', data: prev.config.show.data },
        validate: { status: 'loading', data: prev.config.validate.data },
      },
      profiles: {
        list: { status: 'loading', data: prev.profiles.list.data },
        active: { status: 'loading', data: prev.profiles.active.data },
      },
      extensions: {
        list: { status: 'loading', data: prev.extensions.list.data },
        validate: { status: 'loading', data: prev.extensions.validate.data },
        contributions: { status: 'loading', data: prev.extensions.contributions.data },
      },
      models: {
        catalogs: {
          pi: {
            providers: { status: 'loading', data: prev.models.catalogs.pi.providers.data },
            models: { status: 'loading', data: prev.models.catalogs.pi.models.data },
          },
          'claude-sdk': {
            providers: { status: 'loading', data: prev.models.catalogs['claude-sdk'].providers.data },
            models: { status: 'loading', data: prev.models.catalogs['claude-sdk'].models.data },
          },
        },
      },
    }));

    fetchSystemHealth(signal)
      .then((data) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, daemon: { ...prev.daemon, health: { status: 'success', data, updatedAt: now } } }));
      })
      .catch((err) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, daemon: { ...prev.daemon, health: { status: 'error', error: errorMessage(err), data: prev.daemon.health.data, updatedAt: prev.daemon.health.updatedAt } } }));
      });

    fetchSystemVersion(signal)
      .then((data) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, daemon: { ...prev.daemon, version: { status: 'success', data, updatedAt: now } } }));
      })
      .catch((err) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, daemon: { ...prev.daemon, version: { status: 'error', error: errorMessage(err), data: prev.daemon.version.data, updatedAt: prev.daemon.version.updatedAt } } }));
      });

    fetchSystemProjectContext(signal)
      .then((data) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, daemon: { ...prev.daemon, projectContext: { status: 'success', data, updatedAt: now } } }));
      })
      .catch((err) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, daemon: { ...prev.daemon, projectContext: { status: 'error', error: errorMessage(err), data: prev.daemon.projectContext.data, updatedAt: prev.daemon.projectContext.updatedAt } } }));
      });

    fetchSystemConfigShow(signal)
      .then((data) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, config: { ...prev.config, show: { status: 'success', data, updatedAt: now } } }));
      })
      .catch((err) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, config: { ...prev.config, show: { status: 'error', error: errorMessage(err), data: prev.config.show.data, updatedAt: prev.config.show.updatedAt } } }));
      });

    fetchSystemConfigValidate(signal)
      .then((data) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, config: { ...prev.config, validate: { status: 'success', data, updatedAt: now } } }));
      })
      .catch((err) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, config: { ...prev.config, validate: { status: 'error', error: errorMessage(err), data: prev.config.validate.data, updatedAt: prev.config.validate.updatedAt } } }));
      });

    fetchSystemProfileList(signal)
      .then((data) => {
        if (signal.aborted) return;
        const status = data.profiles.length === 0 ? 'empty' : 'success';
        setState((prev) => ({ ...prev, profiles: { ...prev.profiles, list: { status, data, updatedAt: now } } }));
      })
      .catch((err) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, profiles: { ...prev.profiles, list: { status: 'error', error: errorMessage(err), data: prev.profiles.list.data, updatedAt: prev.profiles.list.updatedAt } } }));
      });

    fetchSystemProfileShow(signal)
      .then((data) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, profiles: { ...prev.profiles, active: { status: 'success', data, updatedAt: now } } }));
      })
      .catch((err) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, profiles: { ...prev.profiles, active: { status: 'error', error: errorMessage(err), data: prev.profiles.active.data, updatedAt: prev.profiles.active.updatedAt } } }));
      });

    fetchSystemExtensionList(signal)
      .then((data) => {
        if (signal.aborted) return;
        const status = data.extensions.length === 0 && data.diagnostics.length === 0 ? 'empty' : 'success';
        setState((prev) => ({ ...prev, extensions: { ...prev.extensions, list: { status, data, updatedAt: now } } }));
      })
      .catch((err) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, extensions: { ...prev.extensions, list: { status: 'error', error: errorMessage(err), data: prev.extensions.list.data, updatedAt: prev.extensions.list.updatedAt } } }));
      });

    fetchSystemExtensionValidate(signal)
      .then((data) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, extensions: { ...prev.extensions, validate: { status: 'success', data, updatedAt: now } } }));
      })
      .catch((err) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, extensions: { ...prev.extensions, validate: { status: 'error', error: errorMessage(err), data: prev.extensions.validate.data, updatedAt: prev.extensions.validate.updatedAt } } }));
      });

    fetchSystemExtensionContributionManifest(signal)
      .then((data) => {
        if (signal.aborted) return;
        const status = data.actions.length === 0
          && data.consoleContributions.length === 0
          && data.consoleWorkstations.length === 0
          && data.integrationCommands.length === 0
          && data.deepLinks.length === 0
          && (data.diagnostics?.length ?? 0) === 0
          ? 'empty'
          : 'success';
        setState((prev) => ({ ...prev, extensions: { ...prev.extensions, contributions: { status, data, updatedAt: now } } }));
      })
      .catch((err) => {
        if (signal.aborted) return;
        setState((prev) => ({ ...prev, extensions: { ...prev.extensions, contributions: { status: 'error', error: errorMessage(err), data: prev.extensions.contributions.data, updatedAt: prev.extensions.contributions.updatedAt } } }));
      });

    for (const harness of SYSTEM_MODEL_HARNESSES) {
      const h = harness;
      fetchSystemModelProviders(h, signal)
        .then((data) => {
          if (signal.aborted) return;
          const status = data.providers.length === 0 ? 'empty' : 'success';
          setState((prev) => ({
            ...prev,
            models: {
              catalogs: {
                ...prev.models.catalogs,
                [h]: { ...prev.models.catalogs[h], providers: { status, data, updatedAt: now } },
              },
            },
          }));
        })
        .catch((err) => {
          if (signal.aborted) return;
          setState((prev) => ({
            ...prev,
            models: {
              catalogs: {
                ...prev.models.catalogs,
                [h]: { ...prev.models.catalogs[h], providers: { status: 'error', error: errorMessage(err), data: prev.models.catalogs[h].providers.data, updatedAt: prev.models.catalogs[h].providers.updatedAt } },
              },
            },
          }));
        });

      fetchSystemModelList(h, signal)
        .then((data) => {
          if (signal.aborted) return;
          const status = data.models.length === 0 ? 'empty' : 'success';
          setState((prev) => ({
            ...prev,
            models: {
              catalogs: {
                ...prev.models.catalogs,
                [h]: { ...prev.models.catalogs[h], models: { status, data, updatedAt: now } },
              },
            },
          }));
        })
        .catch((err) => {
          if (signal.aborted) return;
          setState((prev) => ({
            ...prev,
            models: {
              catalogs: {
                ...prev.models.catalogs,
                [h]: { ...prev.models.catalogs[h], models: { status: 'error', error: errorMessage(err), data: prev.models.catalogs[h].models.data, updatedAt: prev.models.catalogs[h].models.updatedAt } },
              },
            },
          }));
        });
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [refresh]);

  return { state, refresh };
}
