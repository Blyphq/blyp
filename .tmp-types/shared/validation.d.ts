import { z } from 'zod';
export declare const absoluteHttpUrlSchema: z.ZodEffects<z.ZodString, string, string>;
export declare const plainObjectSchema: z.ZodType<Record<string, unknown>, z.ZodTypeDef, Record<string, unknown>>;
export declare const nonEmptyStringSchema: z.ZodString;
export declare function isAbsoluteHttpUrl(value: unknown): value is string;
export declare function isPlainObject(value: unknown): value is Record<string, unknown>;
export declare function hasNonEmptyString(value: unknown): value is string;
