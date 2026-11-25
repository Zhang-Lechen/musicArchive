import Dexie, { type Table, type TransactionMode } from 'dexie';
import type { ArchiveDB } from '../db/database';
import { listeningDateKey } from '../domain/dates';
import { equal, payloadSchema, type Payload, type Remote } from './protocol';
import type { SyncEntity } from './types';

const tracked = new WeakSet<object>();
type Local = { key: string; localId: string; payload: Payload };
export async function reference(database: ArchiveDB, kind: 'work' | 'composer', localId: string) {
  const sources = (await database.source_mappings.where('internalId').equals(localId).toArray())
    .filter((row) => row.entityType === kind)
    .sort(
      (a, b) => a.sourceName.localeCompare(b.sourceName) || a.sourceId.localeCompare(b.sourceId),
    );
  const source = sources.find((row) => row.sourceName === 'Open Opus') ?? sources[0];
  return JSON.stringify([kind, source?.sourceName ?? 'archive-local', source?.sourceId ?? localId]);
}
export async function snapshot(database: ArchiveDB): Promise<Map<string, Local>> {
  const result = new Map<string, Local>();
  const [progress, records, preferences, composers] = await Promise.all([
    database.work_progress.toArray(),
    database.listening_records.toArray(),
    database.work_preferences.toArray(),
    database.composer_preferences.toArray(),
  ]);
  const progressMap = new Map(progress.map((row) => [row.workId, row]));
  const preferenceMap = new Map(preferences.map((row) => [row.workId, row]));
  const recordMap = new Map<string, typeof records>();
  for (const row of records) recordMap.set(row.workId, [...(recordMap.get(row.workId) ?? []), row]);
  for (const localId of new Set([
    ...progressMap.keys(),
    ...preferenceMap.keys(),
    ...recordMap.keys(),
  ])) {
    const work = await database.works.get(localId);
    if (!work) throw new Error('个人记录引用的作品不存在，请先修复备份。');
    const key = await reference(database, 'work', localId);
    if (result.has(key)) throw new Error('多个本地作品映射到同一云端作品，请先核对目录。');
    result.set(key, {
      key,
      localId,
      payload: payloadSchema.parse({
        kind: 'work',
        title: work.titleZh ?? work.titleOriginal,
        status: progressMap.get(localId)?.status ?? 'unheard',
        favorite: preferenceMap.get(localId)?.isFavorite ?? false,
        queued: preferenceMap.get(localId)?.isInQueue ?? false,
        following: false,
        records: Object.fromEntries(
          (recordMap.get(localId) ?? []).map((row) => [
            row.id,
            {
              datePrecision: row.datePrecision,
              dateValue: row.dateValue,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            },
          ]),
        ),
      }),
    });
  }
  for (const row of composers) {
    const composer = await database.composers.get(row.composerId);
    if (!composer) throw new Error('偏好引用的作曲家不存在。');
    const key = await reference(database, 'composer', row.composerId);
    if (result.has(key)) throw new Error('作曲家来源映射不唯一。');
    result.set(key, {
      key,
      localId: row.composerId,
      payload: {
        kind: 'composer',
        title: composer.nameZh ?? composer.nameOriginal,
        status: 'unheard',
        favorite: row.isFavorite,
        following: row.isFollowing,
        queued: false,
        records: {},
      },
    });
  }
  return result;
}
export async function stage(
  database: ArchiveDB,
  before: Map<string, Local>,
  after: Map<string, Local>,
) {
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(key),
      next = after.get(key);
    if (equal(old?.payload, next?.payload)) continue;
    const current = await database.sync_entities.get(key);
    const desired = next?.payload ?? null;
    await database.sync_entities.put({
      key,
      kind: (next ?? old)!.payload.kind,
      localId: (next ?? old)!.localId,
      revision: '0',
      base: null,
      ...current,
      desired,
      dirty: equal(current?.base ?? null, desired) ? 0 : 1,
    });
  }
}
// Wrap every repository write and restore in the same transaction as its durable journal.
export function syncTransaction<T>(
  database: ArchiveDB,
  mode: TransactionMode,
  _tables: Table[],
  callback: () => Promise<T>,
): Promise<T> {
  if (mode === 'r') return database.transaction(mode, _tables, callback);
  const parent = Dexie.currentTransaction;
  if (parent && tracked.has(parent)) return callback();
  return database.transaction('rw', database.tables, async () => {
    const tx = Dexie.currentTransaction!;
    tracked.add(tx);
    const before = await snapshot(database);
    const result = await callback();
    await stage(database, before, await snapshot(database));
    return result;
  });
}
export async function seedJournal(database: ArchiveDB) {
  await database.transaction('rw', database.tables, async () => {
    const rows = await snapshot(database);
    for (const row of rows.values()) {
      if (!(await database.sync_entities.get(row.key))) {
        await database.sync_entities.put({
          ...row,
          kind: row.payload.kind,
          revision: '0',
          base: null,
          desired: row.payload,
          dirty: 1,
        });
      }
    }
  });
}
async function findLocal(database: ArchiveDB, key: string, kind: 'work' | 'composer') {
  const parts: unknown = JSON.parse(key);
  if (
    !Array.isArray(parts) ||
    parts.length !== 3 ||
    parts[0] !== kind ||
    parts.some((p) => typeof p !== 'string')
  )
    throw new Error('云端作品引用无效。');
  const [, namespace, id] = parts as string[];
  if (namespace === 'archive-local') {
    const row = await (kind === 'work' ? database.works : database.composers).get(id!);
    return row?.id;
  }
  const maps = await database.source_mappings
    .where('[sourceName+entityType+sourceId]')
    .equals([namespace!, kind, id!])
    .toArray();
  return maps.length === 1 ? maps[0]!.internalId : undefined;
}
export async function applyPayload(
  database: ArchiveDB,
  entity: SyncEntity,
  payload: Payload | null,
  remote: Remote,
): Promise<boolean> {
  const localId = entity.localId ?? (await findLocal(database, entity.key, entity.kind));
  if (
    !localId ||
    !(await (entity.kind === 'work' ? database.works : database.composers).get(localId))
  ) {
    entity.unresolved = remote;
    return false;
  }
  entity.localId = localId;
  const updatedAt = new Date().toISOString();
  if (entity.kind === 'composer') {
    if (payload)
      await database.composer_preferences.put({
        composerId: localId,
        isFollowing: payload.following,
        isFavorite: payload.favorite,
        updatedAt,
      });
    else await database.composer_preferences.delete(localId);
  } else {
    // Validate IDs before deleting anything. An event cannot move between works silently.
    for (const id of Object.keys(payload?.records ?? {})) {
      const existing = await database.listening_records.get(id);
      if (existing && existing.workId !== localId) throw new Error('聆听事件 ID 与其他作品冲突。');
    }
    const existing = new Map(
      (await database.listening_records.where('workId').equals(localId).toArray()).map((row) => [
        row.id,
        row,
      ]),
    );
    await database.listening_records.where('workId').equals(localId).delete();
    if (!payload) {
      await database.work_progress.delete(localId);
      await database.work_preferences.delete(localId);
    } else {
      await database.work_progress.put({
        workId: localId,
        status: payload.status,
        isHeard: payload.status === 'completed',
        updatedAt,
      });
      await database.work_preferences.put({
        workId: localId,
        isFavorite: payload.favorite,
        isInQueue: payload.queued,
        updatedAt,
      });
      await database.listening_records.bulkPut(
        Object.entries(payload.records).map(([id, date]) => ({
          id,
          workId: localId,
          ...date,
          dateKey: listeningDateKey(date.datePrecision, date.dateValue),
          createdAt: date.createdAt ?? existing.get(id)?.createdAt ?? updatedAt,
          updatedAt: date.updatedAt ?? updatedAt,
        })),
      );
    }
  }
  delete entity.unresolved;
  return true;
}
