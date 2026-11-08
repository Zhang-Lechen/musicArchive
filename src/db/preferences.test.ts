import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveDB } from './database';
import { ArchiveRepository } from './repository';
import { testDatabase } from '../test/database';
import { exportBackup, restoreBackup } from '../services/backup';
import { importCatalog, readCatalog } from '../services/catalog';
import { makeIdentifier } from '../domain/catalog';

const databases: ArchiveDB[] = [];
async function fixture() {
  const database = await testDatabase();
  databases.push(database);
  return { database, repo: new ArchiveRepository(database) };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('P2-1 个人标记与清单', () => {
  it('并发修改独立字段不会互相覆盖，重复设置幂等，默认不插入空记录', async () => {
    const { database, repo } = await fixture();
    await repo.setWorkPreference('first', 'isFavorite', false);
    await repo.setComposerPreference('composer', 'isFollowing', false);
    expect(await database.work_preferences.count()).toBe(0);
    expect(await database.composer_preferences.count()).toBe(0);
    await Promise.all([
      repo.setComposerPreference('composer', 'isFollowing', true),
      repo.setComposerPreference('composer', 'isFavorite', true),
      repo.setWorkPreference('first', 'isFavorite', true),
      repo.setWorkPreference('first', 'isInQueue', true),
    ]);
    const before = await repo.getWorkPreference('first');
    await repo.setWorkPreference('first', 'isFavorite', true);
    expect(await repo.getWorkPreference('first')).toEqual(before);
    await repo.setComposerPreference('composer', 'isFollowing', false);
    await repo.setWorkPreference('first', 'isFavorite', false);
    expect(await repo.getComposerPreference('composer')).toMatchObject({
      isFollowing: false,
      isFavorite: true,
    });
    expect(await repo.getWorkPreference('first')).toMatchObject({
      isFavorite: false,
      isInQueue: true,
    });
    expect(await database.work_progress.count()).toBe(0);
    expect(await database.listening_records.count()).toBe(0);
    await expect(repo.setComposerPreference('missing', 'isFollowing', true)).rejects.toThrow(
      '不存在',
    );
    await expect(repo.setWorkPreference('missing', 'isInQueue', true)).rejects.toThrow('不存在');
    vi.spyOn(database.work_preferences, 'put').mockRejectedValueOnce(new Error('写入失败'));
    await expect(repo.setWorkPreference('first', 'isFavorite', true)).rejects.toThrow('写入失败');
    expect(await repo.getWorkPreference('first')).toMatchObject({
      isFavorite: false,
      isInQueue: true,
    });
  });

  it('聆听完成、重置、撤销不移出待听；重开及备份往返同时保留目录与全部个人记录', async () => {
    const { database, repo } = await fixture();
    await repo.setWorkPreference('first', 'isFavorite', true);
    await repo.setWorkPreference('first', 'isInQueue', true);
    await repo.setComposerPreference('composer', 'isFavorite', true);
    await repo.setComposerPreference('composer', 'isFollowing', true);
    const preferences = await repo.getWorkPreference('first');
    await repo.saveRecord('first', 'year', '2019');
    await repo.saveRecord('first', 'month', '2021-04');
    const records = await repo.getRecords('first');
    const undo = await repo.resetUnheard('first', { confirmClearHistory: true });
    expect(await repo.getWorkPreference('first')).toEqual(preferences);
    await repo.undo(undo);
    database.close();
    await database.open();
    const backup = await exportBackup(database);
    const target = await fixture();
    await restoreBackup(backup, target.database);
    expect(await target.repo.getWorkPreference('first')).toEqual(preferences);
    expect(await target.repo.getRecords('first')).toEqual(records);
    expect(await target.database.works.toArray()).toEqual(backup.works);
    expect(await target.repo.getComposerPreference('composer')).toEqual(
      await repo.getComposerPreference('composer'),
    );
    expect(await target.repo.preferredWorks()).toHaveLength(1);
    expect(await target.repo.preferredComposers()).toHaveLength(1);
    expect((await target.repo.composerSummaries())[0]).toMatchObject({ heard: 1, total: 2 });
  });

  it('目录改名、重编号和重复导入保留稳定 ID 标记，清单带上名称/编号/别名及真实状态', async () => {
    const { database, repo } = await fixture();
    await repo.setWorkPreference('first', 'isInQueue', true);
    await repo.setComposerPreference('composer', 'isFollowing', true);
    await repo.setStatus('first', 'partial');
    const catalog = await readCatalog(database);
    catalog.composers[0]!.nameOriginal = 'Renamed composer';
    catalog.works[0]!.titleOriginal = 'Renamed work';
    catalog.workIdentifiers = [makeIdentifier('first', 'K', 'K.551')];
    catalog.workAliases = [{ id: 'alias', workId: 'first', text: '朱庇特' }];
    await importCatalog(catalog, database);
    await importCatalog(catalog, database);
    const works = await repo.preferredWorks();
    expect(works).toHaveLength(1);
    expect(works[0]).toMatchObject({
      id: 'first',
      titleOriginal: 'Renamed work',
      progress: { status: 'partial' },
      composer: { nameOriginal: 'Renamed composer' },
      preference: { isInQueue: true },
      identifiers: [{ value: 'K.551' }],
      aliases: [{ text: '朱庇特' }],
    });
    expect((await repo.preferredComposers())[0]?.preference.isFollowing).toBe(true);
    await repo.setWorkPreference('first', 'isInQueue', false);
    expect(await repo.preferredWorks()).toEqual([]);
    expect(await repo.listWorks('composer')).toHaveLength(2);
  });
});
