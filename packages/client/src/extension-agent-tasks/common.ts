import { Type } from '@sinclair/typebox';

export const EforgePlanPlanningNonEmptyStringSchema = Type.String({ minLength: 1, pattern: '\\S' });
export const EforgePlanPlanningSha256HexSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });
export const EforgePlanPlanningBacklogSafeIdSchema = Type.String({ minLength: 1, pattern: '^(?!\\.\\.?$)(?!.*[\\\\/\\u0000]).+$' });
