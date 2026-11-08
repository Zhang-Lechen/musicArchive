import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { ArchiveDB, schemaV1 } from './database';
import type { ListeningRecord, WorkProgress } from '../domain/types';

const databases: Dexie[] = [];
const now = '2020-06-01T12:00:00.000Z';
async function legacyFixture() {
  const database = new Dexie(`test-migration-${crypto.randomUUID()}`);
  database.version(1).stores(schemaV1);
  databases.push(database);
  await database.table('composers').add({
    id: 'composer',
    nameOriginal: 'Legacy composer',
    aliases: [],
    coverageStatus: 'sample',
  });
  await database.table('works').bulkAdd(
    ['dated', 'unknown', 'unheard'].map((id) => ({
      id,
      composerId: 'composer',
      titleOriginal: id,
      kind: 'work',
      catalogStatus: 'confirmed',
    })),
  );
  await database.table('work_progress').bulkAdd(
    ['dated', 'unknown', 'unheard'].map((workId) => ({
      workId,
      isHeard: workId !== 'unheard',
      updatedAt: now,
    })),
  );
  await database.table('listening_records').bulkAdd([
    {
      id: 'year-id',
      workId: 'dated',
      datePrecision: 'year',
      dateValue: '2019',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'month-id',
      workId: 'dated',
      datePrecision: 'month',
      dateValue: '2019-06',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'day-id',
      workId: 'dated',
      datePrecision: 'day',
      dateValue: '2019-06-15',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'unknown-id',
      workId: 'dated',
      datePrecision: 'unknown',
      dateValue: null,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await database.table('app_metadata').put({ key: 'seedVersion', value: 'legacy' });
  return database;
}
function upgrade(old: Dexie) {
  old.close();
  const database = new ArchiveDB(old.name);
  databases.push(database);
  return database;
}
afterEach(async () => {
  const names = new Set(databases.map((database) => database.name));
  databases.splice(0).forEach((database) => database.close());
  await Promise.all([...names].map((name) => Dexie.delete(name)));
});

describe('真实 v1 → v2 非破坏性迁移', () => {
  it('保留 ID、时间戳、全部精度和元数据；零日期已听仍 completed，false 映射 unheard', async () => {
    const old = await legacyFixture();
    const oldRecords = await old.table('listening_records').toArray();
    const database = upgrade(old);
    await database.open();
    expect(database.verno).toBe(2);
    expect(await database.work_progress.get('unknown')).toEqual({
      workId: 'unknown',
      status: 'completed',
      isHeard: true,
      updatedAt: now,
    });
    expect((await database.work_progress.get('unheard'))?.status).toBe('unheard');
    const records = await database.listening_records.toArray();
    for (const record of oldRecords)
      expect(records.find((item) => item.id === record.id)).toMatchObject(record);
    expect(records.map((record) => record.dateKey).sort()).toEqual([
      'day:2019-06-15',
      'month:2019-06',
      'unknown',
      'year:2019',
    ]);
    expect((await database.works.get('dated'))?.countPolicy).toBe('countable');
    expect((await database.app_metadata.get('seedVersion'))?.value).toBe('legacy');
    expect((await database.app_metadata.get('schemaVersion'))?.value).toBe(2);
    database.close();
    await database.open();
    expect(await database.listening_records.toArray()).toEqual(records);
    expect(await database.work_progress.count()).toBe(3);
  });

  it.each(['contradictory-date', 'duplicate-unknown'] as const)(
    '异常 %s 让整个升级回滚，v1 原记录可恢复',
    async (scenario) => {
      const old = await legacyFixture();
      if (scenario === 'contradictory-date') {
        await old.table('listening_records').add({
          id: 'contradiction',
          workId: 'unheard',
          datePrecision: 'year',
          dateValue: '2018',
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await old.table('listening_records').add({
          id: 'duplicate',
          workId: 'dated',
          datePrecision: 'unknown',
          dateValue: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      const before = {
        works: await old.table('works').toArray(),
        progress: await old.table('work_progress').toArray(),
        records: await old.table('listening_records').toArray(),
      };
      const database = upgrade(old);
      await expect(database.open()).rejects.toThrow();
      database.close();
      await old.open();
      expect(old.verno).toBe(1);
      expect(await old.table('works').toArray()).toEqual(before.works);
      expect(await old.table<WorkProgress>('work_progress').toArray()).toEqual(before.progress);
      expect(await old.table<ListeningRecord>('listening_records').toArray()).toEqual(
        before.records,
      );
      expect(await old.table('app_metadata').get('schemaVersion')).toBeUndefined();
    },
  );
});
