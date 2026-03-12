import { z } from 'zod';

export const absoluteHttpUrlSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}, {
  message: 'Expected an absolute http(s) URL',
});

export const plainObjectSchema = z.custom<Record<string, unknown>>(
  (value): value is Record<string, unknown> => {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  },
  {
    message: 'Expected a plain object',
  }
);

export const nonEmptyStringSchema = z.string().trim().min(1);

export function isAbsoluteHttpUrl(value: unknown): value is string {
  return absoluteHttpUrlSchema.safeParse(value).success;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return plainObjectSchema.safeParse(value).success;
}

export function hasNonEmptyString(value: unknown): value is string {
  return nonEmptyStringSchema.safeParse(value).success;
}
