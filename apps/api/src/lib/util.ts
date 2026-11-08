import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { ApiError } from './errors.js';

export const newId = (): string => randomUUID();
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const iso = (d: Date): string => d.toISOString();
export const isoOrNull = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ApiError('validation_error', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), r.error.issues);
  }
  return r.data;
}

export function backoff(attempt: number, baseMs: number, random = Math.random): number {
  return baseMs <= 0 ? 0 : Math.round(baseMs * 2 ** attempt * (0.5 + random() * 0.5));
}
