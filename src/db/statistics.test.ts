import { expect, it } from 'vitest';
import { testDatabase } from '../test/database';
import { ArchiveRepository } from './repository';

it('只读统计不修改数据库，完成/部分状态、历史日期增删改与撤销即时反映', async () => {
  const database = await testDatabase();
  const repo = new ArchiveRepository(database);
  try {
    await repo.setWorkPreference('first', 'isFavorite', true);
    await repo.setComposerPreference('composer', 'isFollowing', true);
    await repo.setStatus('first', 'partial');
    expect(await repo.listeningStatistics()).toMatchObject({
      completed: 0,
      partial: 1,
      coverage: 0,
    });
    await repo.setStatus('first', 'completed');
    expect(await repo.listeningStatistics()).toMatchObject({
      completed: 1,
      partial: 0,
      unknownDateCount: 1,
      coverage: 0.5,
    });
    const later = await repo.addRecord('first', { datePrecision: 'year', dateValue: '2003' });
    const earlier = await repo.addRecord('first', { datePrecision: 'month', dateValue: '1982-11' });
    expect((await repo.listeningStatistics()).years).toEqual([{ year: 1982, count: 1 }]);
    await repo.updateRecord(earlier.id, { datePrecision: 'day', dateValue: '2010-02-01' });
    expect((await repo.listeningStatistics()).years).toEqual([{ year: 2003, count: 1 }]);
    await repo.deleteRecord(later.id);
    expect((await repo.listeningStatistics()).years).toEqual([{ year: 2010, count: 1 }]);
    await repo.deleteRecord(earlier.id);
    expect(await repo.listeningStatistics()).toMatchObject({
      completed: 1,
      years: [],
      unknownDateCount: 1,
    });
    const token = await repo.setStatus('first', 'partial', { confirmClearHistory: true });
    expect(await repo.listeningStatistics()).toMatchObject({ completed: 0, partial: 1 });
    await repo.undo(token);
    expect(await repo.listeningStatistics()).toMatchObject({ completed: 1, partial: 0 });
    const snapshot = () => Promise.all(database.tables.map((table) => table.toArray()));
    const before = await snapshot();
    await repo.listeningStatistics();
    expect(await snapshot()).toEqual(before);
  } finally {
    await database.delete();
  }
});
