import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchiveDB } from './database';
import { ArchiveRepository } from './repository';
import { makeIdentifier } from '../domain/catalog';
import { testDatabase } from '../test/database';
import type { DateInput, Work } from '../domain/types';

const databases: ArchiveDB[] = [];
const now = '2026-01-01T12:00:00.000Z';
async function fixture() {
  const database = await testDatabase();
  databases.push(database);
  return { database, repo: new ArchiveRepository(database, () => new Date(2026, 0, 1, 0, 1)) };
}
const year: DateInput = { datePrecision: 'year', dateValue: '2019' };
const unknown: DateInput = { datePrecision: 'unknown', dateValue: null };
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('A1 领域仓储契约', () => {
  it('创建/重开持久化；同名不同 ID，多编号修改不改变个人历史', async () => {
    const { database, repo } = await fixture();
    await repo.putComposer({
      id: 'other',
      nameOriginal: 'Other',
      aliases: [],
      coverageStatus: 'partial',
    });
    const first = (await repo.getWork('first'))!;
    await repo.putWork({ ...first, id: 'same-name' });
    const primary = makeIdentifier('first', 'K', 'K. 551');
    const alternate = makeIdentifier('first', 'KV', 'KV 551', false);
    await repo.putIdentifier(primary);
    await repo.putIdentifier(alternate);
    await repo.putAlias({ id: 'alias', workId: 'first', text: '测试别名', locale: 'zh' });
    await repo.setStatus('first', 'completed', { completedDate: year });
    const original = await repo.getRecords('first');
    await repo.putIdentifier({ ...makeIdentifier('first', 'K', 'K.9'), id: primary.id });
    database.close();
    await database.open();
    expect((await repo.getComposer('other'))?.coverageStatus).toBe('partial');
    expect(await repo.listWorksByComposer('composer')).toHaveLength(3);
    expect((await repo.getWork('same-name'))?.titleOriginal).toBe(first.titleOriginal);
    expect(await repo.getRecords('first')).toEqual(original);
    expect(await database.work_identifiers.where('workId').equals('first').count()).toBe(2);
    expect(await database.work_aliases.get('alias')).toMatchObject({ text: '测试别名' });
  });

  it('无记录默认 unheard；partial 独立于偏好；completed 可以零日期', async () => {
    const { database, repo } = await fixture();
    expect(await repo.getStatus('first')).toBe('unheard');
    const composerPreference = {
      composerId: 'composer',
      isFollowing: true,
      isFavorite: false,
      updatedAt: now,
    };
    const workPreference = { workId: 'first', isFavorite: true, isInQueue: true, updatedAt: now };
    await repo.putComposerPreference(composerPreference);
    await repo.putWorkPreference(workPreference);
    await repo.setStatus('first', 'partial');
    expect(await repo.getStatus('first')).toBe('partial');
    expect((await database.work_progress.get('first'))?.isHeard).toBe(false);
    expect((await repo.composerSummaries())[0]?.heard).toBe(0);
    await repo.setStatus('first', 'completed');
    expect(await repo.getRecords('first')).toEqual([]);
    await expect(repo.setStatus('first', 'unheard')).rejects.toThrow('确认');
    await repo.setStatus('first', 'unheard', { confirmClearHistory: true });
    expect(await database.composer_preferences.get('composer')).toEqual(composerPreference);
    expect(await database.work_preferences.get('first')).toEqual(workPreference);
  });

  it('completeWithDate 并发幂等，独立 addRecord 要求 completed；编辑保留 ID 和创建时间', async () => {
    const { database, repo } = await fixture();
    await expect(repo.addRecord('first', year)).rejects.toThrow('完整听过');
    await repo.setStatus('first', 'partial');
    await expect(repo.addRecord('first', unknown)).rejects.toThrow('完整听过');
    await expect(repo.setStatus('first', 'partial', { completedDate: year })).rejects.toThrow();
    await Promise.all(
      [1, 2].map(() => repo.setStatus('first', 'completed', { completedDate: year })),
    );
    expect(await repo.getRecords('first')).toHaveLength(1);
    const added = await repo.addRecord('first', unknown);
    await expect(repo.addRecord('first', unknown)).rejects.toThrow('已有');
    await expect(repo.updateRecord(added.id, year)).rejects.toThrow();
    expect(await database.listening_records.get(added.id)).toEqual(added);
    await repo.updateRecord(added.id, { datePrecision: 'day', dateValue: '2020-02-29' });
    expect(await database.listening_records.get(added.id)).toEqual({
      ...added,
      datePrecision: 'day',
      dateValue: '2020-02-29',
      dateKey: 'day:2020-02-29',
    });
    for (const record of await repo.getRecords('first')) await repo.deleteRecord(record.id);
    expect(await repo.getRecords('first')).toEqual([]);
    expect(await repo.getStatus('first')).toBe('completed');
  });

  it('降级必须确认，删除后更新失败回滚，确认后原子清空全部日期', async () => {
    const { database, repo } = await fixture();
    await repo.setStatus('first', 'completed', { completedDate: year });
    await repo.addRecord('first', unknown);
    const before = await repo.getSnapshot('first');
    for (const status of ['partial', 'unheard'] as const) {
      await expect(repo.setStatus('first', status)).rejects.toThrow('确认');
      expect(await repo.getSnapshot('first')).toEqual(before);
    }
    vi.spyOn(database.work_progress, 'put').mockRejectedValueOnce(new Error('状态写入失败'));
    await expect(repo.setStatus('first', 'partial', { confirmClearHistory: true })).rejects.toThrow(
      '状态写入失败',
    );
    expect(await repo.getSnapshot('first')).toEqual(before);
    await repo.setStatus('first', 'partial', { confirmClearHistory: true });
    expect(await repo.getStatus('first')).toBe('partial');
    expect(await repo.getRecords('first')).toEqual([]);
  });

  it('核心 API 不暗选今天，并使用注入的本地时钟拒绝未来日期', async () => {
    const { repo } = await fixture();
    await expect(
      repo.setStatus('first', 'completed', {
        completedDate: { datePrecision: 'day', dateValue: '2026-01-02' },
      }),
    ).rejects.toThrow('晚于今天');
    expect(await repo.getStatus('first')).toBe('unheard');
    await repo.setStatus('first', 'completed', {
      completedDate: { datePrecision: 'day', dateValue: '2026-01-01' },
    });
    expect((await repo.getRecords('first'))[0]?.dateValue).toBe('2026-01-01');
  });

  it('所有关联写入拒绝悬空 ID，拒绝自指、循环、跨作曲家父节点', async () => {
    const { database, repo } = await fixture();
    const first = (await repo.getWork('first'))!;
    for (const operation of [
      () => repo.setStatus('missing', 'partial'),
      () => repo.setStatus('missing', 'completed', { completedDate: year }),
      () => repo.addRecord('missing', year),
      () =>
        repo.putWorkPreference({
          workId: 'missing',
          isFavorite: true,
          isInQueue: false,
          updatedAt: now,
        }),
      () =>
        repo.putComposerPreference({
          composerId: 'missing',
          isFavorite: true,
          isFollowing: false,
          updatedAt: now,
        }),
      () =>
        repo.putPublicLabel({
          id: 'dangling',
          workId: 'missing',
          labelType: 'popular',
          sourceName: 'test',
          reviewStatus: 'pending',
        }),
      () => repo.putIdentifier(makeIdentifier('missing', 'K', 'K.9')),
      () => repo.putAlias({ id: 'dangling', workId: 'missing', text: 'alias' }),
      () => repo.putWork({ ...first, composerId: 'missing' }),
      () => repo.putWork({ ...first, parentWorkId: first.id }),
      () => repo.putWork({ ...first, parentWorkId: 'missing' }),
    ])
      await expect(operation()).rejects.toThrow();
    await repo.putWork({
      ...first,
      id: 'child',
      parentWorkId: 'first',
      countPolicy: 'noncountable',
    });
    await expect(repo.putWork({ ...first, parentWorkId: 'child' })).rejects.toThrow('循环');
    await repo.putComposer({
      id: 'other',
      nameOriginal: 'Other',
      aliases: [],
      coverageStatus: 'sample',
    });
    await expect(
      repo.putWork({ ...first, composerId: 'other', parentWorkId: 'second' }),
    ).rejects.toThrow('层级');
    expect(await database.work_progress.count()).toBe(0);
    expect(await database.work_preferences.count()).toBe(0);
    expect(await database.work_public_labels.count()).toBe(0);
  });

  it('多个来源可证明同一标签；未知日期唯一索引和实体命名空间有效', async () => {
    const { database, repo } = await fixture();
    for (const id of ['evidence-1', 'evidence-2'])
      await repo.putPublicLabel({
        id,
        workId: 'first',
        labelType: 'popular',
        sourceName: id,
        reviewStatus: 'source_provided',
      });
    expect(
      await database.work_public_labels
        .where('[workId+labelType]')
        .equals(['first', 'popular'])
        .count(),
    ).toBe(2);
    await repo.setStatus('first', 'completed');
    const record = await repo.addRecord('first', unknown);
    await expect(database.listening_records.add({ ...record, id: 'duplicate' })).rejects.toThrow();
    await database.source_mappings.bulkAdd(
      ['composer', 'work'].map((entityType) => ({
        id: entityType,
        entityType: entityType as 'composer' | 'work',
        internalId: entityType === 'work' ? 'first' : 'composer',
        sourceName: 'test',
        sourceId: '1',
        lastSeenAt: now,
      })),
    );
    await expect(
      database.source_mappings.add({
        id: 'collision',
        entityType: 'work',
        internalId: 'second',
        sourceName: 'test',
        sourceId: '1',
        lastSeenAt: now,
      }),
    ).rejects.toThrow();
    expect(await database.source_mappings.count()).toBe(2);
  });

  it('显式 countable 子作品可写进度，容器和乐章不会被自动计入', async () => {
    const { repo } = await fixture();
    const first = (await repo.getWork('first')) as Work;
    await repo.putWork({
      ...first,
      id: 'container',
      kind: 'collection',
      nodeType: 'collection',
      countPolicy: 'container',
    });
    await repo.putWork({
      ...first,
      id: 'prelude',
      parentWorkId: 'container',
      countPolicy: 'countable',
      isPerformable: true,
    });
    await repo.setStatus('container', 'completed');
    await repo.setStatus('prelude', 'completed');
    expect((await repo.composerSummaries())[0]?.heard).toBe(1);
  });
});
