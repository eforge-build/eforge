import { Type } from '@sinclair/typebox';
import { ExtensionActionInvokeErrorCodeSchema, ExtensionActionRequestedBySchema, ExtensionActionValidationErrorSchema as ExtensionActionValidationErrorWireSchema } from '../../extension-contributions.js';

export const StackSyncTriggerSchema = Type.Optional(Type.Union([
  Type.Literal('manual'), Type.Literal('after-build'),
  Type.Literal('scheduled'), Type.Literal('retry-deferred'),
]));

export const ExtensionActionValidationErrorSchema = ExtensionActionValidationErrorWireSchema;

export const ExtensionActionFailedErrorCodeSchema = Type.Union([
  Type.Literal('invalid-input'),
  Type.Literal('daemon-unavailable'),
  Type.Literal('handler-error'),
  Type.Literal('invalid-output'),
  Type.Literal('output-schema-failed'),
]);

export const ExtensionActionEventBaseFields = {
  invocationId: Type.String(),
  actionId: Type.String(),
  extensionName: Type.String(),
  extensionPath: Type.String(),
  requestedBy: ExtensionActionRequestedBySchema,
} as const;

void ExtensionActionInvokeErrorCodeSchema;
