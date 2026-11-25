import { afterEach, expect, it } from 'vitest';
import { testDatabase } from '../test/database';
import { ArchiveRepository } from '../db/repository';
import { exportBackup, restoreBackup } from '../services/backup';
import { bindAccount } from './engine';
import { syncTransaction } from './local';
import type { ArchiveDB } from '../db/database';
const databases: ArchiveDB[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});
async function fixture() {
  const db = await testDatabase();
  databases.push(db);
  return { db, repo: new ArchiveRepository(db) };
}
it('批量、日期、偏好和撤销在同一事务生成日志', async () => {
  const { db, repo } = await fixture();
  const undo = await repo.setHeard(['first', 'second'], false);
  expect(await db.sync_entities.count()).toBe(2);
  await repo.undo(undo);
  expect((await db.sync_entities.toArray()).every((row) => row.desired === null)).toBe(true);
  await repo.saveRecord('first', 'year', '2019');
  await repo.setWorkPreference('first', 'isFavorite', true);
  await repo.setComposerPreference('composer', 'isFollowing', true);
  const work = (await db.sync_entities.toArray()).find((row) => row.localId === 'first')!;
  expect(work.desired?.favorite).toBe(true);
  expect(Object.values(work.desired!.records)).toMatchObject([
    { datePrecision: 'year', dateValue: '2019' },
  ]);
  const record = (await repo.getRecords('first'))[0]!;
  await repo.deleteRecord(record.id);
  expect((await db.sync_entities.get(work.key))?.desired?.records).toEqual({});
});
it('业务写入失败时日志与业务一起回滚', async () => {
  const { db } = await fixture();
  await expect(
    syncTransaction(db, 'rw', db.tables, async () => {
      await db.work_progress.put({
        workId: 'first',
        status: 'completed',
        isHeard: true,
        updatedAt: new Date().toISOString(),
      });
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(await db.work_progress.count()).toBe(0);
  expect(await db.sync_entities.count()).toBe(0);
});
it('恢复备份保留账号、游标和不可变重试操作，追踪删除', async () => {
  const { db, repo } = await fixture();
  const empty = await exportBackup(db);
  await repo.setStatus('first', 'completed');
  await bindAccount(db, 'account-a');
  await db.sync_meta.put({ key: 'cursor', value: '42' });
  const row = (await db.sync_entities.toArray())[0]!;
  const op = {
    operationId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    key: row.key,
    baseRevision: '0',
    payload: row.desired,
    submitted: row.desired,
  };
  await db.sync_operations.add(op);
  await restoreBackup(empty, db);
  expect((await db.sync_meta.get('owner'))?.value).toBe('account-a');
  expect((await db.sync_meta.get('cursor'))?.value).toBe('42');
  expect(await db.sync_operations.get(op.operationId)).toEqual(op);
  expect((await db.sync_entities.get(row.key))?.desired).toBeNull();
  await expect(bindAccount(db, 'account-b')).rejects.toThrow('另一账户');
});
