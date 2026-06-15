/**
 * Public dependency and capability contracts for native eforge extensions.
 *
 * Extension packages declare capabilities and dependencies in
 * `package.json#eforge.extension`. Runtime contexts expose immutable lookup data
 * that reports availability only; it never invokes another extension.
 */

export type ExtensionDependencyKind = 'required' | 'optional';

export interface ExtensionCapabilityDeclaration {
  /** Stable capability identifier, e.g. `com.example.backlog`. */
  name: string;
  /** Exact semantic version implemented by the provider, when versioned. */
  version?: string;
}

export interface ExtensionCapabilityRequirement {
  /** Stable capability identifier required by a dependency or contribution. */
  name: string;
  /** Exact version or comparator constraint such as `>=1.0.0, <2.0.0`. */
  version?: string;
}

export interface ExtensionDependencyDeclaration {
  /** Provider extension name. Omit only for capability-only lookups. */
  name?: string;
  /** Exact provider version or comparator constraint such as `>=1.0.0`. */
  version?: string;
  /** Capabilities that the provider must expose. */
  capabilities?: ExtensionCapabilityRequirement[];
}

export interface ExtensionDependencyManifest {
  required?: ExtensionDependencyDeclaration[];
  optional?: ExtensionDependencyDeclaration[];
}

export interface ExtensionContributionRequirements {
  /** Provider dependencies this contribution needs to be available. */
  dependencies?: ExtensionDependencyDeclaration[];
  /** Capabilities this contribution needs to be available. */
  capabilities?: ExtensionCapabilityRequirement[];
}

export interface ExtensionAvailabilityDiagnostic {
  code: string;
  message: string;
  severity?: 'warning' | 'error';
  dependencyName?: string;
  providerName?: string;
  capabilityName?: string;
  requiredVersion?: string;
  actualVersion?: string;
}

export interface ExtensionContributionAvailability {
  available: boolean;
  message?: string;
  diagnostics?: ExtensionAvailabilityDiagnostic[];
}

export interface ExtensionDependencyAvailability {
  kind?: ExtensionDependencyKind;
  name?: string;
  providerName?: string;
  providerVersion?: string;
  available: boolean;
  diagnostics: ExtensionAvailabilityDiagnostic[];
  capabilities: ExtensionCapabilityRequirement[];
}

export interface ExtensionCapabilityProviderAvailability {
  extensionName: string;
  extensionPath: string;
  version?: string;
}

export interface ExtensionCapabilityAvailability {
  name: string;
  version?: string;
  available: boolean;
  providers: ExtensionCapabilityProviderAvailability[];
  diagnostics: ExtensionAvailabilityDiagnostic[];
}

export interface ExtensionDependencyLookup {
  get(name: string): ExtensionDependencyAvailability;
  has(name: string): boolean;
  list(): ExtensionDependencyAvailability[];
}

export interface ExtensionCapabilityLookup {
  get(name: string, version?: string): ExtensionCapabilityAvailability;
  has(name: string, version?: string): boolean;
  list(): ExtensionCapabilityAvailability[];
}

export interface ExtensionDependencyLookupContext {
  dependencies: ExtensionDependencyLookup;
  capabilities: ExtensionCapabilityLookup;
}
