import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchiveRepository } from './repository';
import type { ArchiveDB } from './database';
import { testDatabase } from '../test/database';
import { localToday } from '../domain/dates';

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

describe('原子聆听仓储', () => {
  it('补录使用同样的运行时校验，子作品与佚失条目不可写独立进度', async () => {
    const { database, repo } = await fixture();
    await expect(
      repo.addManualWork(
        {
          composerId: 'composer',
          titleOriginal: 'Oversized alias',
          kind: 'work',
          catalogStatus: 'confirmed',
        },
        [],
        ['x'.repeat(2001)],
      ),
    ).rejects.toThrow();
    expect(await database.works.count()).toBe(2);
    const child = await repo.addManualWork(
      {
        composerId: 'composer',
        titleOriginal: 'Movement',
        kind: 'movement',
        parentWorkId: 'first',
        catalogStatus: 'confirmed',
      },
      [],
      [],
    );
    await expect(repo.setHeard([child], true)).rejects.toThrow('不可独立统计');
    const lost = await repo.addManualWork(
      { composerId: 'composer', titleOriginal: 'Lost work', kind: 'work', catalogStatus: 'lost' },
      [],
      [],
    );
    await expect(repo.setHeard([lost], true)).rejects.toThrow('不可独立统计');
    expect((await repo.composerSummaries())[0]?.total).toBe(2);
  });
  it('无日期已听过合法，重新打开数据库后仍保留', async () => {
    const { database, repo } = await fixture();
    await repo.setHeard(['first'], false);
    database.close();
    await database.open();
    expect((await repo.getSnapshot('first')).progress?.isHeard).toBe(true);
    expect((await repo.getSnapshot('first')).records).toEqual([]);
  });
  it('并发快速聆听同日不重复', async () => {
    const { repo } = await fixture();
    await Promise.all([repo.setHeard(['first'], true), repo.setHeard(['first'], true)]);
    const state = await repo.getSnapshot('first');
    expect(state.records).toHaveLength(1);
    expect(state.records[0]?.dateValue).toBe(localToday());
    expect(state.progress?.isHeard).toBe(true);
  });
  it('增改删日期，删空日期仍保持已听过；恢复未听过可撤销', async () => {
    const { repo } = await fixture();
    await repo.saveRecord('first', 'year', '2019');
    let state = await repo.getSnapshot('first');
    await repo.saveRecord('first', 'month', '2019-06', state.records[0]!.id);
    state = await repo.getSnapshot('first');
    expect(state.records[0]?.dateValue).toBe('2019-06');
    await repo.deleteRecord('first', state.records[0]!.id);
    expect((await repo.getSnapshot('first')).progress?.isHeard).toBe(true);
    await repo.saveRecord('first', 'unknown', null);
    const token = await repo.resetUnheard('first', { confirmClearHistory: true });
    expect((await repo.getSnapshot('first')).records).toEqual([]);
    expect((await repo.getSnapshot('first')).progress?.isHeard).toBe(false);
    await repo.undo(token);
    expect((await repo.getSnapshot('first')).records[0]?.datePrecision).toBe('unknown');
  });
  it('拒绝重复日期和跨作品编辑', async () => {
    const { repo } = await fixture();
    await repo.saveRecord('first', 'year', '2019');
    const record = (await repo.getSnapshot('first')).records[0]!;
    await expect(repo.saveRecord('first', 'year', '2019')).rejects.toThrow('已有');
    await expect(repo.saveRecord('second', 'year', '2018', record.id)).rejects.toThrow();
    expect((await repo.getSnapshot('second')).progress).toBeUndefined();
  });
  it('写入日期失败时进度一并回滚', async () => {
    const { database, repo } = await fixture();
    vi.spyOn(database.listening_records, 'add').mockRejectedValueOnce(new Error('模拟写入失败'));
    await expect(repo.setHeard(['first'], true)).rejects.toThrow('模拟写入失败');
    expect((await repo.getSnapshot('first')).progress).toBeUndefined();
    expect((await repo.getSnapshot('first')).records).toEqual([]);
  });
  it('批量失败整体回滚，撤销不会覆盖后续操作', async () => {
    const { repo } = await fixture();
    await expect(repo.setHeard(['first', 'missing'], true)).rejects.toThrow();
    expect((await repo.getSnapshot('first')).progress).toBeUndefined();
    const token = await repo.setHeard(['first', 'second'], false);
    await repo.saveRecord('first', 'year', '2019');
    await expect(repo.undo(token)).rejects.toThrow('已在其他操作');
    expect((await repo.getSnapshot('second')).progress?.isHeard).toBe(true);
  });
});
