/**
 * UI-only types for the System configuration view.
 * Imports wire types from @eforge-build/client/browser; defines no daemon response interfaces.
 */
import type {
  HealthResponse,
  VersionResponse,
  ProjectContext,
  ConfigShowVerboseResponse,
  ConfigValidateResponse,
  ProfileListResponse,
  ProfileShowResponse,
  ExtensionEntry,
  ExtensionListResponse,
  ExtensionValidateResponse,
  ExtensionReloadResponse,
  ExtensionReloadWatcherMetadata,
  ExtensionTrustResponse,
  ExtensionUntrustRequest,
  ExtensionUntrustResponse,
  ExtensionPromoteRequest,
  ExtensionPromoteResponse,
  ExtensionDemoteRequest,
  ExtensionDemoteResponse,
  ExtensionContributionManifestResponse,
  ExtensionActionManifestEntry,
  ConsoleContributionManifestEntry,
  ConsoleWorkstationManifestEntry,
  ConsoleWorkstationDetail,
  ConsoleContributionBlock,
  ExtensionActionBindingManifest,
  ExtensionActionRequestedBy,
  ExtensionActionInvokeResponse,
  ExtensionActionOutputProfile,
  FormattedExtensionContributionOutput,
  ExtensionJsonObject,
  ExtensionJsonValue,
  PlaybookListResponse,
  ModelProvidersResponse,
  ModelListResponse,
} from '@eforge-build/client/browser';

// Re-export wire types for convenience
export type {
  HealthResponse,
  VersionResponse,
  ProjectContext,
  ConfigShowVerboseResponse,
  ConfigValidateResponse,
  ProfileListResponse,
  ProfileShowResponse,
  ExtensionEntry,
  ExtensionListResponse,
  ExtensionValidateResponse,
  ExtensionReloadResponse,
  ExtensionReloadWatcherMetadata,
  ExtensionTrustResponse,
  ExtensionUntrustRequest,
  ExtensionUntrustResponse,
  ExtensionPromoteRequest,
  ExtensionPromoteResponse,
  ExtensionDemoteRequest,
  ExtensionDemoteResponse,
  ExtensionContributionManifestResponse,
  ExtensionActionManifestEntry,
  ConsoleContributionManifestEntry,
  ConsoleWorkstationManifestEntry,
  ConsoleWorkstationDetail,
  ConsoleContributionBlock,
  ExtensionActionBindingManifest,
  ExtensionActionRequestedBy,
  ExtensionActionInvokeResponse,
  ExtensionActionOutputProfile,
  FormattedExtensionContributionOutput,
  ExtensionJsonObject,
  ExtensionJsonValue,
  PlaybookListResponse,
  ModelProvidersResponse,
  ModelListResponse,
};

/**
 * A generic wrapper representing the load lifecycle of a single data surface.
 * Section components treat `status: 'error'` with `data` as partial stale data
 * and render both the error message and the retained data.
 */
export type Loadable<T> =
  | { status: 'idle' | 'loading'; data?: T; updatedAt?: number; error?: undefined }
  | { status: 'success'; data: T; updatedAt: number; error?: undefined }
  | { status: 'empty'; data?: T; updatedAt: number; error?: undefined }
  | { status: 'error'; data?: T; updatedAt?: number; error: string };

/** Harness identifiers for which model catalog data is fetched. */
export type SystemModelHarness = 'pi' | 'claude-sdk';

/** Load state for a single harness model catalog (providers + models). */
export interface SystemModelCatalog {
  providers: Loadable<ModelProvidersResponse>;
  models: Loadable<ModelListResponse>;
}

/** Combined load state for all System view surfaces. */
export interface SystemSurfacesState {
  daemon: {
    health: Loadable<HealthResponse>;
    version: Loadable<VersionResponse>;
    projectContext: Loadable<ProjectContext>;
  };
  config: {
    show: Loadable<ConfigShowVerboseResponse>;
    validate: Loadable<ConfigValidateResponse>;
  };
  profiles: {
    list: Loadable<ProfileListResponse>;
    active: Loadable<ProfileShowResponse>;
  };
  extensions: {
    list: Loadable<ExtensionListResponse>;
    validate: Loadable<ExtensionValidateResponse>;
    contributions: Loadable<ExtensionContributionManifestResponse>;
  };
  playbooks: {
    list: Loadable<PlaybookListResponse>;
  };
  models: {
    catalogs: Record<SystemModelHarness, SystemModelCatalog>;
  };
}

/** Identifier for a specific section surface. */
export type SystemSurfaceKey =
  | 'daemon.health'
  | 'daemon.version'
  | 'daemon.projectContext'
  | 'config.show'
  | 'config.validate'
  | 'profiles.list'
  | 'profiles.active'
  | 'extensions.list'
  | 'extensions.validate'
  | 'extensions.contributions'
  | 'playbooks.list'
  | 'models.pi.providers'
  | 'models.pi.models'
  | 'models.claude-sdk.providers'
  | 'models.claude-sdk.models';
