import { z } from 'zod';
import type { ArchiveDB } from '../db/database';
import { validateDate } from '../domain/dates';
import { exportBackup } from '../services/backup';
import { applyPayload, seedJournal } from './local';
import {
  equal,
  merge,
  payloadSchema,
  remoteSchema,
  resultSchema,
  revisionSchema,
  type Payload,
  type Remote,
  type SyncRequest,
} from './protocol';
import type { SyncEntity } from './types';

export type Transport = (request: SyncRequest) => Promise<unknown>;
const pageSchema = z.object({
  changes: z.array(remoteSchema).max(200),
  cursor: revisionSchema,
  hasMore: z.boolean(),
});
const statusSchema = z.object({
  protocolVersion: z.literal(1),
  count: z.number().int().nonnegative(),
});
async function value<T>(database: ArchiveDB, key: string, fallback: T): Promise<T> {
  return ((await database.sync_meta.get(key))?.value as T | undefined) ?? fallback;
}
export async function previewSync(database: ArchiveDB, call: Transport) {
  await seedJournal(database);
  const status = statusSchema.parse(await call({ protocolVersion: 1, action: 'status' }));
  const local = await database.sync_entities.toArray();
  let cursor = '0',
    hasMore = true,
    conflicts = 0;
  const map = new Map(local.map((row) => [row.key, row]));
  // Last change per entity is sufficient for a read-only first-sync preview.
  const remote = new Map<string, Remote>();
  while (hasMore) {
    const page = pageSchema.parse(
      await call({ protocolVersion: 1, action: 'pull', cursor, limit: 200 }),
    );
    if (page.hasMore && BigInt(page.cursor) <= BigInt(cursor))
      throw new Error('云端分页游标没有前进。');
    page.changes.forEach((row) => remote.set(row.key, row));
    cursor = page.cursor;
    hasMore = page.hasMore;
  }
  for (const row of remote.values()) {
    const current = map.get(row.key);
    if (current && merge(current.base, current.desired, row.payload).conflict) conflicts++;
  }
  return { upload: local.filter((row) => row.dirty).length, download: status.count, conflicts };
}
export async function bindAccount(database: ArchiveDB, uid: string) {
  const backup = await exportBackup(database);
  await database.transaction('rw', database.sync_meta, async () => {
    const owner = await value(database, 'owner', '');
    if (owner && owner !== uid)
      throw new Error('此本地档案属于另一账户。请使用独立浏览器配置文件登录新账户。');
    if (!owner) {
      await database.sync_meta.put({ key: 'before-first-sync', value: backup });
      await database.sync_meta.put({ key: 'owner', value: uid });
      await database.sync_meta.put({ key: 'device', value: crypto.randomUUID() });
    }
  });
}
async function ingest(database: ArchiveDB, remote: Remote) {
  const current = await database.sync_entities.get(remote.key);
  if (current && BigInt(remote.revision) <= BigInt(current.revision)) return;
  const entity: SyncEntity = current ?? {
    key: remote.key,
    kind: remote.payload?.kind ?? (JSON.parse(remote.key)[0] as 'work' | 'composer'),
    base: null,
    desired: null,
    revision: '0',
    dirty: 0,
  };
  const merged = merge(entity.base, entity.desired, remote.payload);
  if (
    merged.conflict ||
    entity.conflict ||
    (remote.payload === null && entity.dirty && entity.desired !== null)
  ) {
    entity.conflict = remote;
  } else {
    await applyPayload(database, entity, merged.payload, remote);
    entity.base = remote.payload;
    entity.revision = remote.revision;
    entity.desired = merged.payload;
    entity.dirty = equal(merged.payload, remote.payload) ? 0 : 1;
  }
  await database.sync_entities.put(entity);
}
export async function synchronize(database: ArchiveDB, uid: string, call: Transport) {
  const owner = await value(database, 'owner', '');
  if (owner !== uid) throw new Error('请先确认首次同步及本地档案归属。');
  // navigator.locks is held across requests and released on tab/app termination.
  if (!globalThis.navigator?.locks)
    throw new Error('此浏览器不支持安全同步锁，请使用新版浏览器和 HTTPS。');
  return navigator.locks.request(
    `music-archive-sync:${database.name}`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw new Error('另一个标签页正在同步，请稍后重试。');
      await seedJournal(database);
      const deviceId = await value(database, 'device', '');
      let uploaded = 0,
        downloaded = 0;
      // A finite initial list permits editing during sync without an endless upload loop.
      const keys = new Set(
        (await database.sync_entities.where('dirty').equals(1).toArray()).map((row) => row.key),
      );
      (await database.sync_operations.toArray()).forEach((row) => keys.add(row.key));
      for (const key of keys) {
        const op = await database.transaction(
          'rw',
          database.sync_entities,
          database.sync_operations,
          async () => {
            const pending = await database.sync_operations.where('key').equals(key).first();
            if (pending) return pending;
            const row = await database.sync_entities.get(key);
            if (!row?.dirty || row.conflict || row.unresolved) return undefined;
            const next = {
              operationId: crypto.randomUUID(),
              deviceId,
              key,
              baseRevision: row.revision,
              payload: row.desired,
              submitted: row.desired,
            };
            await database.sync_operations.add(next);
            return next;
          },
        );
        if (!op) continue;
        const { submitted, ...operation } = op;
        const response = resultSchema.parse(
          await call({ protocolVersion: 1, action: 'push', operation }),
        );
        if (response.operationId !== op.operationId || response.remote.key !== key)
          throw new Error('云端返回了不匹配的操作结果。');
        await database.transaction('rw', database.tables, async () => {
          const row = (await database.sync_entities.get(key))!;
          if (response.conflict) row.conflict = response.remote;
          else {
            const combined = merge(submitted, row.desired, response.remote.payload);
            if (combined.conflict) row.conflict = response.remote;
            else {
              await applyPayload(database, row, combined.payload, response.remote);
              row.desired = combined.payload;
              row.dirty = equal(combined.payload, response.remote.payload) ? 0 : 1;
            }
            row.base = response.remote.payload;
            row.revision = response.remote.revision;
          }
          await database.sync_entities.put(row);
          await database.sync_operations.delete(op.operationId);
        });
        if (!response.conflict) uploaded++;
      }
      let more = true;
      while (more) {
        const cursor = await value(database, 'cursor', '0');
        const page = pageSchema.parse(
          await call({ protocolVersion: 1, action: 'pull', cursor, limit: 200 }),
        );
        if (
          BigInt(page.cursor) < BigInt(cursor) ||
          (page.hasMore && BigInt(page.cursor) === BigInt(cursor))
        )
          throw new Error('云端游标无效。');
        let last = BigInt(cursor);
        for (const row of page.changes) {
          if (BigInt(row.seq) <= last || BigInt(row.seq) > BigInt(page.cursor))
            throw new Error('云端变更顺序无效。');
          last = BigInt(row.seq);
        }
        await database.transaction('rw', database.tables, async () => {
          for (const remote of page.changes) await ingest(database, remote);
          await database.sync_meta.put({ key: 'cursor', value: page.cursor });
        });
        downloaded += page.changes.length;
        more = page.hasMore;
      }
      await retryUnresolved(database);
      const rows = await database.sync_entities.toArray();
      const result = {
        uploaded,
        downloaded,
        conflicts: rows.filter((r) => r.conflict).length,
        unresolved: rows.filter((r) => r.unresolved).length,
        pending: rows.filter((r) => r.dirty).length,
        time: new Date().toISOString(),
      };
      await database.sync_meta.put({ key: 'last-result', value: result });
      return result;
    },
  );
}
export async function retryUnresolved(database: ArchiveDB) {
  await database.transaction('rw', database.tables, async () => {
    for (const row of await database.sync_entities.toArray()) {
      if (row.unresolved && !row.conflict) {
        await applyPayload(database, row, row.desired, row.unresolved);
        await database.sync_entities.put(row);
      }
    }
  });
}
export async function resolveConflict(
  database: ArchiveDB,
  key: string,
  choice: 'local' | 'remote' | Payload,
) {
  await database.transaction('rw', database.tables, async () => {
    const row = await database.sync_entities.get(key);
    if (!row?.conflict) throw new Error('冲突已改变，请刷新。');
    const remote = row.conflict;
    const desired =
      choice === 'local'
        ? row.desired
        : choice === 'remote'
          ? remote.payload
          : payloadSchema.parse(choice);
    if (typeof choice === 'object')
      for (const record of Object.values(desired?.records ?? {}))
        validateDate(record.datePrecision, record.dateValue);
    if (desired && desired.kind !== row.kind) throw new Error('不能改变冲突实体类型。');
    await applyPayload(database, row, desired, remote);
    row.base = remote.payload;
    row.revision = remote.revision;
    row.desired = desired;
    // Even keep-remote is submitted using CAS, so a newer remote edit is detected.
    row.dirty = 1;
    delete row.conflict;
    await database.sync_entities.put(row);
  });
}
