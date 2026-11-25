import { z } from 'zod';
import { validateDate } from '../domain/dates';

const id = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value));
export const revisionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .max(20);
const eventSchema = z
  .object({
    datePrecision: z.enum(['day', 'month', 'year', 'unknown']),
    dateValue: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }).optional(),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      validateDate(value.datePrecision, value.dateValue, '9999-12-31');
    } catch {
      ctx.addIssue({ code: 'custom', message: '无效聆听日期' });
    }
  });
export const payloadSchema = z
  .object({
    kind: z.enum(['work', 'composer']),
    title: z.string().min(1).max(2000),
    status: z.enum(['unheard', 'partial', 'completed']),
    favorite: z.boolean(),
    following: z.boolean(),
    queued: z.boolean(),
    records: z.record(id, eventSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      Object.keys(value.records).length > 10000 ||
      (Object.keys(value.records).length > 0 && value.status !== 'completed')
    )
      ctx.addIssue({ code: 'custom', message: '日期必须属于完整听过的作品' });
    if (value.kind === 'work' && value.following)
      ctx.addIssue({ code: 'custom', message: '作品不能设置作曲家关注字段' });
    const dates = Object.values(value.records).map((r) => `${r.datePrecision}:${r.dateValue}`);
    if (new Set(dates).size !== dates.length)
      ctx.addIssue({ code: 'custom', message: '同一作品存在重复日期，需人工合并' });
    if (value.kind === 'composer' && (dates.length || value.status !== 'unheard' || value.queued))
      ctx.addIssue({ code: 'custom', message: '作曲家数据结构无效' });
  });
export type Payload = z.infer<typeof payloadSchema>;
export const operationSchema = z
  .object({
    operationId: z.string().uuid(),
    deviceId: z.string().uuid(),
    key: id,
    baseRevision: revisionSchema,
    payload: payloadSchema.nullable(),
  })
  .strict();
export type Operation = z.infer<typeof operationSchema>;
export const remoteSchema = z
  .object({
    key: id,
    revision: revisionSchema,
    seq: revisionSchema,
    payload: payloadSchema.nullable(),
    deviceId: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type Remote = z.infer<typeof remoteSchema>;
export const resultSchema = z
  .object({ operationId: z.string(), conflict: z.boolean(), remote: remoteSchema })
  .strict();
export type PushResult = z.infer<typeof resultSchema>;
export const requestSchema = z.discriminatedUnion('action', [
  z.object({ protocolVersion: z.literal(1), action: z.literal('status') }).strict(),
  z
    .object({
      protocolVersion: z.literal(1),
      action: z.literal('push'),
      operation: operationSchema,
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(1),
      action: z.literal('pull'),
      cursor: revisionSchema,
      limit: z.number().int().min(1).max(200),
    })
    .strict(),
]);
export type SyncRequest = z.infer<typeof requestSchema>;
export function equal(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
export function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
      .join(',') +
    '}'
  );
}
// Three-way field/event merge. No device timestamps participate in conflict decisions.
export function merge(
  base: Payload | null,
  local: Payload | null,
  remote: Payload | null,
): { payload: Payload | null; conflict: boolean } {
  if (equal(local, remote) || equal(base, remote)) return { payload: local, conflict: false };
  if (equal(base, local)) return { payload: remote, conflict: false };
  if (!local || !remote || local.kind !== remote.kind) return { payload: local, conflict: true };
  let conflict = false;
  const pick = <T>(b: T, l: T, r: T): T => {
    if (equal(l, r) || equal(b, r)) return l;
    if (equal(b, l)) return r;
    conflict = true;
    return l;
  };
  const merged: Payload = { ...local, records: {} };
  for (const field of ['status', 'favorite', 'following', 'queued'] as const) {
    const defaults = {
      status: 'unheard' as const,
      favorite: false,
      following: false,
      queued: false,
    };
    Object.assign(merged, {
      [field]: pick(base?.[field] ?? defaults[field], local[field], remote[field]),
    });
  }
  for (const key of new Set([
    ...Object.keys(base?.records ?? {}),
    ...Object.keys(local.records),
    ...Object.keys(remote.records),
  ])) {
    const value = pick(base?.records[key], local.records[key], remote.records[key]);
    if (value) merged.records[key] = value;
  }
  if (!payloadSchema.safeParse(merged).success) conflict = true;
  return { payload: merged, conflict };
}
