import { Type } from '@sinclair/typebox';

export const EventEnvelopeSchema = Type.Object({
  sessionId: Type.Optional(Type.String()),
  runId: Type.Optional(Type.String()),
  timestamp: Type.String(),
});
