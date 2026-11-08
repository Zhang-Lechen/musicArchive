import { afterEach, describe, expect, it, vi } from 'vitest';
import { testDatabase } from '../test/database';
import type { ArchiveDB } from '../db/database';
import { ArchiveRepository } from '../db/repository';
import { exportBackup, parseBackup, restoreBackup } from './backup';

const databases: ArchiveDB[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});
async function fixture() {
  const d = await testDatabase();
  databases.push(d);
  return d;
}
describe('版本化备份与事务恢复', () => {
  it('v2 往返保留 partial、收藏/待听、关注和多来源公共标签', async () => {
    const first = await fixture(),
      second = await fixture();
    const repo = new ArchiveRepository(first);
    const now = '2020-06-01T12:00:00.000Z';
    await repo.setStatus('first', 'partial');
    await repo.putWorkPreference({
      workId: 'first',
      isFavorite: true,
      isInQueue: true,
      updatedAt: now,
    });
    await repo.putComposerPreference({
      composerId: 'composer',
      isFavorite: false,
      isFollowing: true,
      updatedAt: now,
    });
    for (const id of ['one', 'two'])
      await repo.putPublicLabel({
        id,
        workId: 'first',
        labelType: 'representative',
        sourceName: id,
        reviewStatus: 'pending',
      });
    const original = await exportBackup(first);
    expect(original.formatVersion).toBe(2);
    await restoreBackup(parseBackup(JSON.stringify(original)).backup, second);
    const restored = await exportBackup(second);
    expect(restored.workProgress).toEqual(original.workProgress);
    expect(restored.workPreferences).toEqual(original.workPreferences);
    expect(restored.composerPreferences).toEqual(original.composerPreferences);
    expect(restored.workPublicLabels).toEqual(original.workPublicLabels);
    expect(restored.listeningRecords).toEqual([]);
  });
  it('可读取原 v1 备份：true 零日期不丢状态，false 无日期不猜测完成', async () => {
    const database = await fixture();
    const original = await exportBackup(database);
    const legacy = {
      formatVersion: 1,
      exportedAt: original.exportedAt,
      composers: original.composers,
      works: original.works,
      workIdentifiers: [],
      workAliases: [],
      sourceMappings: [],
      workProgress: [
        { workId: 'first', isHeard: true, updatedAt: original.exportedAt },
        { workId: 'second', isHeard: false, updatedAt: original.exportedAt },
      ],
      listeningRecords: [],
      appMetadata: [],
    };
    await restoreBackup(legacy, database);
    const repo = new ArchiveRepository(database);
    expect(await repo.getStatus('first')).toBe('completed');
    expect(await repo.getStatus('second')).toBe('unheard');
    expect(await repo.getRecords('first')).toEqual([]);
    await expect(
      restoreBackup(
        {
          ...legacy,
          listeningRecords: [
            {
              id: 'contradiction',
              workId: 'second',
              datePrecision: 'year',
              dateValue: '2019',
              createdAt: original.exportedAt,
              updatedAt: original.exportedAt,
            },
          ],
        },
        database,
      ),
    ).rejects.toThrow('必须属于已听过');
    expect(await repo.getStatus('first')).toBe('completed');
  });
  it('新表写入失败时恢复整体回滚；拒绝悬空偏好、标签及矛盾三态', async () => {
    const database = await fixture();
    const repo = new ArchiveRepository(database);
    await repo.setStatus('first', 'partial');
    const original = await exportBackup(database);
    for (const corrupted of [
      { ...original, workProgress: [{ ...original.workProgress[0], isHeard: true }] },
      {
        ...original,
        workPreferences: [
          { workId: 'missing', isFavorite: true, isInQueue: false, updatedAt: original.exportedAt },
        ],
      },
      {
        ...original,
        workPublicLabels: [
          {
            id: 'missing',
            workId: 'missing',
            labelType: 'popular',
            sourceName: 'test',
            reviewStatus: 'pending',
          },
        ],
      },
    ])
      await expect(restoreBackup(corrupted, database)).rejects.toThrow();
    vi.spyOn(database.work_public_labels, 'bulkAdd').mockRejectedValueOnce(
      new Error('标签写入失败'),
    );
    await expect(restoreBackup({ ...original, workProgress: [] }, database)).rejects.toThrow(
      '标签写入失败',
    );
    expect((await exportBackup(database)).workProgress).toEqual(original.workProgress);
  });
  it('2019 年记录往返不伪造月日，不详状态和多条日期保留', async () => {
    const first = await fixture(),
      second = await fixture();
    const repo = new ArchiveRepository(first);
    await repo.saveRecord('first', 'year', '2019');
    await repo.saveRecord('first', 'day', '2019-06-15');
    await repo.setHeard(['second'], false);
    const original = await exportBackup(first);
    await restoreBackup(parseBackup(JSON.stringify(original)).backup, second);
    const restored = await exportBackup(second);
    expect(restored.listeningRecords).toEqual(original.listeningRecords);
    expect(restored.workProgress).toEqual(original.workProgress);
  });
  it('拒绝未知版本、错误引用、非法日期、矛盾进度及循环层级', async () => {
    const database = await fixture();
    await new ArchiveRepository(database).saveRecord('first', 'year', '2019');
    const backup = await exportBackup(database);
    for (const corrupt of [
      { ...backup, formatVersion: 9 },
      { ...backup, workProgress: [] },
      { ...backup, listeningRecords: [{ ...backup.listeningRecords[0], dateValue: '9999' }] },
      { ...backup, works: backup.works.map((w) => ({ ...w, parentWorkId: w.id })) },
    ]) {
      expect(() => parseBackup(JSON.stringify(corrupt))).toThrow();
    }
    expect(() => parseBackup('{')).toThrow();
    expect(await database.listening_records.count()).toBe(1);
  });
  it('重复日期默认合并，写入失败不破坏旧库', async () => {
    const database = await fixture();
    await new ArchiveRepository(database).saveRecord('first', 'year', '2019');
    const original = await exportBackup(database);
    const duplicate = { ...original.listeningRecords[0], id: 'duplicate' };
    const parsed = parseBackup(
      JSON.stringify({ ...original, listeningRecords: [...original.listeningRecords, duplicate] }),
    );
    expect(parsed.mergedRecords).toBe(1);
    vi.spyOn(database.works, 'bulkAdd').mockRejectedValueOnce(new Error('模拟恢复失败'));
    await expect(restoreBackup(parsed.backup, database)).rejects.toThrow();
    expect((await exportBackup(database)).listeningRecords).toEqual(original.listeningRecords);
    expect(await database.works.count()).toBe(2);
  });
});
