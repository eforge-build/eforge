import {
  type ExtensionActionInvokeFailureResponse,
  type ExtensionActionInvokeResponse,
  type ExtensionActionOutputProfile,
  type ExtensionActionRequestedBy,
  type ExtensionActionSideEffect,
  type ExtensionContributionAvailability,
  type ExtensionContributionDiagnostic,
  type ExtensionJsonObject,
} from '../extension-contributions.js';

export const EXTENSION_HOST_CONTRIBUTION_KINDS = ['action', 'command', 'deep-link'] as const;
export type ExtensionHostContributionKind = typeof EXTENSION_HOST_CONTRIBUTION_KINDS[number];

export type ExtensionHostContributionProjection = 'compact' | 'full';

export interface ExtensionHostContributionProjectionOptions {
  projection?: ExtensionHostContributionProjection;
  kind?: ExtensionHostContributionKind | 'all';
  extensionName?: string;
  search?: string;
  idPrefix?: string;
  outputProfile?: ExtensionActionOutputProfile;
  limit?: number;
  offset?: number;
  includeInputSchema?: boolean;
  includeDiagnostics?: boolean;
}

export interface ExtensionHostContributionDetailOptions {
  id: string;
  kind?: ExtensionHostContributionKind;
  projection?: ExtensionHostContributionProjection;
  includeInputSchema?: boolean;
  includeDiagnostics?: boolean;
}

export interface ExtensionHostContributionInputSummary {
  inputKeys: string[];
  inputKeyCount: number;
  serializedInputSize: number;
  omittedInputKeyCount?: number;
  truncatedInputKeyCount?: number;
}

export interface ExtensionHostContributionEntry {
  kind: ExtensionHostContributionKind;
  id: string;
  label: string;
  description?: string;
  extensionName: string;
  extensionPath: string;
  actionId?: string;
  urlTemplate?: string;
  actionBacked: boolean;
  sideEffects?: ExtensionActionSideEffect[];
  outputProfile?: ExtensionActionOutputProfile;
  hasInputSchema?: boolean;
  requiredInputKeys?: string[];
  inputPropertyKeys?: string[];
  inputDefaultKeys?: string[];
  inputSchema?: ExtensionJsonObject;
  inputDefaults?: ExtensionJsonObject;
  availability?: ExtensionContributionAvailability;
}

export interface ExtensionHostContributionListResponse {
  generatedAt: string;
  entries: ExtensionHostContributionEntry[];
  diagnosticCount: number;
  total: number;
  returned: number;
  offset: number;
  limit?: number;
  hasMore: boolean;
  nextOffset?: number;
  diagnostics?: ExtensionContributionDiagnostic[];
}

export interface ExtensionHostContributionDetailResponse {
  generatedAt: string;
  entry: ExtensionHostContributionEntry;
  diagnosticCount: number;
  diagnostics?: ExtensionContributionDiagnostic[];
}

export interface ExtensionHostContributionInvokeParams {
  kind?: ExtensionHostContributionKind;
  id: string;
  input?: ExtensionJsonObject;
  requestedBy: ExtensionActionRequestedBy;
}

export interface ExtensionHostContributionInvokeTarget {
  kind: ExtensionHostContributionKind;
  id: string;
  label: string;
  extensionName: string;
  extensionPath: string;
  actionId: string;
  requestedBy: ExtensionActionRequestedBy;
  input: ExtensionJsonObject;
  outputProfile?: ExtensionActionOutputProfile;
}

export interface ExtensionHostContributionInvokeResult {
  target: ExtensionHostContributionInvokeTarget;
  response: ExtensionActionInvokeResponse;
}

export interface ExtensionHostContributionFailedInvocationEnvelope {
  ok: false;
  invocationId: string;
  target: Omit<ExtensionHostContributionInvokeTarget, 'input' | 'requestedBy'>;
  requestedBy: ExtensionActionRequestedBy;
  error: Pick<ExtensionActionInvokeFailureResponse['error'], 'code' | 'message'> & { messageTruncated?: boolean };
  inputSummary: ExtensionHostContributionInputSummary;
}
