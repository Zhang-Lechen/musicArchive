import { afterEach, describe, expect, it } from 'vitest';
import { ArchiveDB } from '../db/database';
import { ArchiveRepository } from '../db/repository';
import seedJson from '../data/seed.json';
import { initializeSeed, importCatalog, readCatalog } from './catalog';
import { validateCatalog } from './validation';
import { testDatabase } from '../test/database';
import { makeIdentifier } from '../domain/catalog';
import { restoreBackup } from './backup';

const databases: ArchiveDB[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});
const seed = validateCatalog(seedJson);
describe('种子版本和目录更新安全', () => {
  it('同名冲突仍按作曲家和规范化标题检查，不合并不同内部 ID', async () => {
    const database = await testDatabase();
    databases.push(database);
    const original = await readCatalog(database);
    const first = original.works[0]!;
    const candidate = {
      ...original,
      works: [{ ...first, id: 'new-id', titleOriginal: ` ${first.titleOriginal.toUpperCase()} ` }],
    };
    await expect(importCatalog(candidate, database)).rejects.toThrow('同名作品');
    expect(await database.works.count()).toBe(2);
    const otherComposer = { ...original.composers[0]!, id: 'other' };
    await importCatalog(
      {
        ...candidate,
        composers: [otherComposer],
        works: [{ ...candidate.works[0], composerId: 'other' }],
      },
      database,
    );
    expect(await database.works.count()).toBe(3);
  });
  it('同一来源不同实体共用编号时不静默合并，多个目录版次完整保留', async () => {
    const database = await testDatabase();
    databases.push(database);
    const composers = (await readCatalog(database)).composers;
    const first = {
      composers,
      works: [
        {
          id: 'number-a',
          composerId: 'composer',
          titleOriginal: 'First attribution',
          kind: 'work',
          catalogStatus: 'confirmed',
        },
      ],
      workIdentifiers: [
        makeIdentifier('number-a', 'K', 'K.9', true, '1862'),
        makeIdentifier('number-a', 'KV', 'KV 9', false, '2024'),
      ],
      workAliases: [],
      sourceMappings: [
        {
          id: 'source-a',
          entityType: 'work',
          internalId: 'number-a',
          sourceName: 'Open Opus',
          sourceId: '1',
          lastSeenAt: new Date().toISOString(),
        },
      ],
    };
    await importCatalog(first, database);
    await importCatalog(first, database);
    expect(await database.work_identifiers.where('workId').equals('number-a').count()).toBe(2);
    const second = {
      composers,
      works: [
        {
          id: 'number-b',
          composerId: 'composer',
          titleOriginal: 'Other attribution',
          kind: 'work',
          catalogStatus: 'doubtful',
        },
      ],
      workIdentifiers: [makeIdentifier('number-b', 'K', 'K.9', true, '1862')],
      workAliases: [],
      sourceMappings: [
        {
          id: 'source-b',
          entityType: 'work',
          internalId: 'number-b',
          sourceName: 'Open Opus',
          sourceId: '2',
          lastSeenAt: new Date().toISOString(),
        },
      ],
    };
    await importCatalog(second, database);
    expect(await database.works.count()).toBe(4);
    expect((await database.source_mappings.get('source-b'))?.internalId).toBe('number-b');
  });
  it('种子幂等初始化、升级只修正目录且保留个人档案', async () => {
    const database = new ArchiveDB(`seed-${crypto.randomUUID()}`);
    databases.push(database);
    await initializeSeed(database, seed);
    await initializeSeed(database, seed);
    expect(await database.works.count()).toBe(18);
    const work = seed.works[0]!;
    await new ArchiveRepository(database).saveRecord(work.id, 'year', '2019');
    const updated = structuredClone(seed);
    updated.works[0]!.titleZh = '核对后的名称';
    await initializeSeed(database, updated, '2');
    expect((await database.works.get(work.id))?.titleZh).toBe('核对后的名称');
    expect(await database.works.count()).toBe(18);
    expect((await database.listening_records.toArray())[0]?.dateValue).toBe('2019');
    expect((await database.work_progress.get(work.id))?.isHeard).toBe(true);
  });
  it('显式恢复空备份后不重新灌入种子', async () => {
    const database = new ArchiveDB(`empty-${crypto.randomUUID()}`);
    databases.push(database);
    await initializeSeed(database, seed);
    await restoreBackup(
      {
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        composers: [],
        works: [],
        workIdentifiers: [],
        workAliases: [],
        sourceMappings: [],
        workProgress: [],
        listeningRecords: [],
        appMetadata: [],
      },
      database,
    );
    await initializeSeed(database, seed, '2');
    expect(await database.works.count()).toBe(0);
  });
  it('手动补录与外部来源按唯一编号关联，反复导入及外部 ID 变化不丢档案', async () => {
    const database = await testDatabase();
    databases.push(database);
    const repo = new ArchiveRepository(database);
    const id = await repo.addManualWork(
      {
        composerId: 'composer',
        titleOriginal: 'My readable title',
        kind: 'work',
        catalogStatus: 'confirmed',
      },
      [{ system: 'K', value: 'K. 9' }],
      ['个人别名'],
    );
    await repo.saveRecord(id, 'year', '2019');
    const incoming = {
      composers: (await readCatalog(database)).composers,
      works: [
        {
          id: 'source-id',
          composerId: 'composer',
          titleOriginal: 'Official readable title',
          kind: 'work',
          catalogStatus: 'confirmed',
        },
      ],
      workIdentifiers: [makeIdentifier('source-id', 'K', 'K.9')],
      workAliases: [],
      sourceMappings: [
        {
          id: 'mapping',
          entityType: 'work',
          internalId: 'source-id',
          sourceName: 'Open Opus',
          sourceId: '1234',
          lastSeenAt: new Date().toISOString(),
        },
      ],
    };
    await importCatalog(incoming, database);
    await importCatalog(incoming, database);
    expect(await database.works.count()).toBe(3);
    expect((await database.works.get(id))?.titleOriginal).toBe('My readable title');
    expect((await database.source_mappings.get('mapping'))?.internalId).toBe(id);
    expect((await repo.getSnapshot(id)).records[0]?.dateValue).toBe('2019');
    await expect(
      repo.addManualWork(
        {
          composerId: 'composer',
          titleOriginal: 'Duplicate',
          kind: 'work',
          catalogStatus: 'confirmed',
        },
        [{ system: 'KV', value: 'KV 9' }],
        [],
      ),
    ).rejects.toThrow('编号已存在');
  });
  it('冲突来源引用拒绝写入，目录更新不改变聆听表', async () => {
    const database = new ArchiveDB(`catalog-${crypto.randomUUID()}`);
    databases.push(database);
    await initializeSeed(database, seed);
    await new ArchiveRepository(database).setHeard([seed.works[0]!.id], true);
    const before = await database.listening_records.toArray();
    await importCatalog(seed, database);
    await importCatalog(seed, database);
    expect(await database.works.count()).toBe(18);
    expect(await database.listening_records.toArray()).toEqual(before);
    const corrupt = structuredClone(seed);
    corrupt.sourceMappings[0]!.internalId = 'missing';
    await expect(importCatalog(corrupt, database)).rejects.toThrow();
    expect(await database.listening_records.toArray()).toEqual(before);
  });
});
