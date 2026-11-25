import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { SyncService } from '../service';
import { verifyUser } from '../auth';
import { resultSchema, type Payload } from '../../src/sync/protocol';
import { testDatabase } from '../../src/test/database';
import { ArchiveRepository } from '../../src/db/repository';
import { bindAccount, synchronize, resolveConflict } from '../../src/sync/engine';
import type { ArchiveDB } from '../../src/db/database';

let postgres: EmbeddedPostgres, admin: Pool, runtime: Pool, service: SyncService, directory: string;
const databases: ArchiveDB[] = [];
const base: Payload = {
  kind: 'work',
  title: 'first',
  status: 'completed',
  favorite: false,
  following: false,
  queued: false,
  records: {},
};
const key = JSON.stringify(['work', 'archive-local', 'first']);
const operation = (payload: Payload | null, revision = '0') => ({
  protocolVersion: 1 as const,
  action: 'push' as const,
  operation: {
    operationId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    key,
    baseRevision: revision,
    payload,
  },
});
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'music-sync-pg-'));
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  postgres = new EmbeddedPostgres({
    databaseDir: join(directory, 'data'),
    port,
    user: 'postgres',
    password: 'isolated-admin-test-only',
    persistent: false,
    autoRehydrateSymlinks: true,
    onLog: () => {},
    onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  const client = postgres.getPgClient();
  await client.connect();
  await client.query(
    await readFile(new URL('../migrations/001_sync.sql', import.meta.url), 'utf8'),
  );
  await client.query(
    "CREATE ROLE music_sync_runtime LOGIN PASSWORD 'isolated-test-only' NOSUPERUSER NOBYPASSRLS",
  );
  await client.query('GRANT USAGE ON SCHEMA archive_sync TO music_sync_runtime');
  await client.query(
    'GRANT SELECT,INSERT,UPDATE ON archive_sync.counters,archive_sync.entities TO music_sync_runtime',
  );
  await client.query(
    'GRANT SELECT,INSERT ON archive_sync.changes,archive_sync.operations TO music_sync_runtime',
  );
  // This temporary local cluster is never a CloudBase or production database.
  admin = new Pool({
    user: 'postgres',
    password: 'isolated-admin-test-only',
    database: 'postgres',
    host: '127.0.0.1',
    port,
  });
  runtime = new Pool({
    host: '127.0.0.1',
    port,
    user: 'music_sync_runtime',
    password: 'isolated-test-only',
    database: 'postgres',
  });
  await client.end();
  service = new SyncService(runtime);
  vi.stubGlobal('navigator', {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object) => Promise<unknown>,
      ) => callback({}),
    },
  });
}, 30000);
afterAll(async () => {
  for (const db of databases) await db.delete();
  await runtime?.end();
  await admin?.end();
  await postgres?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
async function device(uid: string) {
  const db = await testDatabase();
  databases.push(db);
  await bindAccount(db, uid);
  return {
    db,
    repo: new ArchiveRepository(db),
    sync: () => synchronize(db, uid, (request) => service.execute(uid, request)),
  };
}
describe('真实 PostgreSQL 与两个独立 IndexedDB 客户端', () => {
  it('首次上传、新设备恢复、双向偏好、独立日期、删除传播和统计一致', async () => {
    const uid = crypto.randomUUID(),
      a = await device(uid),
      b = await device(uid);
    await a.repo.saveRecord('first', 'year', '2019');
    await a.sync();
    await b.sync();
    expect((await b.repo.getRecords('first'))[0]?.dateValue).toBe('2019');
    await a.repo.addRecord('first', { datePrecision: 'year', dateValue: '2020' });
    await b.repo.addRecord('first', { datePrecision: 'year', dateValue: '2021' });
    await b.repo.setWorkPreference('second', 'isFavorite', true);
    await a.sync();
    await b.sync();
    await a.sync();
    expect((await a.repo.getRecords('first')).map((r) => r.dateValue).sort()).toEqual([
      '2019',
      '2020',
      '2021',
    ]);
    expect(await a.repo.getRecords('first')).toHaveLength(3);
    expect((await a.repo.getWorkPreference('second'))?.isFavorite).toBe(true);
    const remove = (await a.repo.getRecords('first')).find((r) => r.dateValue === '2019')!;
    await a.repo.deleteRecord(remove.id);
    await a.sync();
    await b.sync();
    expect(await b.repo.getRecords('first')).toHaveLength(2);
    expect(await a.repo.getStatus('first')).toBe('completed');
    expect(await b.repo.listeningStatistics()).toEqual(await a.repo.listeningStatistics());
  });
  it('重复三次只提交一次，同操作 ID 异内容拒绝', async () => {
    const uid = crypto.randomUUID(),
      request = operation(base);
    const results = await Promise.all([
      service.execute(uid, request),
      service.execute(uid, request),
      service.execute(uid, request),
    ]);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(resultSchema.parse(results[0]).remote.revision).toBe('1');
    await expect(
      service.execute(uid, {
        ...request,
        operation: { ...request.operation, payload: { ...base, favorite: true } },
      }),
    ).rejects.toThrow('OPERATION_ID_REUSED');
  });
  it('上传成功但响应丢失，重试不重复日期，保留随后本地编辑', async () => {
    const uid = crypto.randomUUID(),
      a = await device(uid);
    await a.repo.saveRecord('first', 'year', '2019');
    let lost = false;
    await expect(
      synchronize(a.db, uid, async (request) => {
        const result = await service.execute(uid, request);
        if (request.action === 'push' && !lost) {
          lost = true;
          throw new Error('connection lost');
        }
        return result;
      }),
    ).rejects.toThrow('connection lost');
    expect(await a.db.sync_operations.count()).toBe(1);
    await a.repo.setWorkPreference('first', 'isFavorite', true);
    await a.sync();
    await a.sync();
    expect(await a.db.sync_operations.count()).toBe(0);
    const b = await device(uid);
    await b.sync();
    expect(await b.repo.getRecords('first')).toHaveLength(1);
    expect((await b.repo.getWorkPreference('first'))?.isFavorite).toBe(true);
  });
  it('删除与修改冲突保留两端，解决后正式提交', async () => {
    const uid = crypto.randomUUID(),
      a = await device(uid),
      b = await device(uid);
    await a.repo.saveRecord('first', 'year', '2019');
    await a.sync();
    await b.sync();
    const record = (await a.repo.getRecords('first'))[0]!;
    await a.repo.deleteRecord(record.id);
    await b.repo.updateRecord(record.id, { datePrecision: 'year', dateValue: '2020' });
    await a.sync();
    const result = await b.sync();
    expect(result?.conflicts).toBe(1);
    expect((await b.repo.getRecords('first'))[0]?.dateValue).toBe('2020');
    const row = (await b.db.sync_entities.toArray()).find((r) => r.conflict)!;
    await resolveConflict(b.db, row.key, 'local');
    await b.sync();
    await a.sync();
    expect((await a.repo.getRecords('first'))[0]?.dateValue).toBe('2020');
  });
  it('权限隔离、协议拒绝、分页和未知目录保留', async () => {
    const uid = crypto.randomUUID();
    await service.execute(uid, operation(base));
    expect(
      await service.execute('other-user', {
        protocolVersion: 1,
        action: 'pull',
        cursor: '0',
        limit: 200,
      }),
    ).toMatchObject({ changes: [] });
    const connection = await runtime.connect();
    await connection.query('BEGIN');
    await connection.query("SELECT set_config('archive_sync.uid','other-user',true)");
    expect(
      (await connection.query('SELECT * FROM archive_sync.entities WHERE owner_uid=$1', [uid]))
        .rowCount,
    ).toBe(0);
    await expect(
      connection.query('INSERT INTO archive_sync.counters(owner_uid) VALUES($1)', [
        uid + '-forged',
      ]),
    ).rejects.toThrow();
    await connection.query('ROLLBACK');
    connection.release();
    await expect(service.execute(uid, { protocolVersion: 2, action: 'status' })).rejects.toThrow();
    await service.execute(uid, operation({ ...base, favorite: true }, '1'));
    const page = await service.execute(uid, {
      protocolVersion: 1,
      action: 'pull',
      cursor: '0',
      limit: 1,
    });
    expect(page).toMatchObject({ cursor: '1', hasMore: true });
    const unknown = operation(base);
    unknown.operation.key = JSON.stringify(['work', 'missing-source', 'unknown']);
    await service.execute(uid, unknown);
    const a = await device(uid);
    expect((await a.sync())?.unresolved).toBe(1);
    expect((await a.db.sync_entities.toArray()).find((r) => r.unresolved)?.desired).toEqual(base);
  });
  it('服务端业务及日志提交失败时全部回滚', async () => {
    const uid = crypto.randomUUID();
    await admin.query(
      "CREATE FUNCTION archive_sync.fail_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$",
    );
    await admin.query(
      'CREATE TRIGGER fail_change BEFORE INSERT ON archive_sync.changes FOR EACH ROW EXECUTE FUNCTION archive_sync.fail_change()',
    );
    try {
      await expect(service.execute(uid, operation(base))).rejects.toThrow('test failure');
    } finally {
      await admin.query('DROP TRIGGER fail_change ON archive_sync.changes');
    }
    expect(await service.execute(uid, { protocolVersion: 1, action: 'status' })).toMatchObject({
      count: 0,
    });
    expect(resultSchema.parse(await service.execute(uid, operation(base))).remote.seq).toBe('1');
  });
  it('旧设备不能复活已删除实体，用户确认当前版本后才可重建', async () => {
    const uid = crypto.randomUUID();
    await service.execute(uid, operation(base));
    await service.execute(uid, operation(null, '1'));
    const stale = resultSchema.parse(
      await service.execute(uid, operation({ ...base, favorite: true })),
    );
    expect(stale.conflict).toBe(true);
    expect(stale.remote.payload).toBeNull();
    const resolved = resultSchema.parse(await service.execute(uid, operation(base, '2')));
    expect(resolved.conflict).toBe(false);
  });
  it('新设备恢复旧备份不能复活已删除日期', async () => {
    const uid = crypto.randomUUID();
    const old = {
      ...base,
      records: { oldEvent: { datePrecision: 'year' as const, dateValue: '2019' } },
    };
    await service.execute(uid, operation(old));
    await service.execute(uid, operation(base, '1'));
    const response = resultSchema.parse(await service.execute(uid, operation(old)));
    expect(response.conflict).toBe(true);
    expect(response.remote.payload?.records).toEqual({});
  });
  it('拉取本地写入失败不会推进游标，恢复后可继续', async () => {
    const uid = crypto.randomUUID(),
      a = await device(uid),
      b = await device(uid);
    await a.repo.setStatus('first', 'completed');
    await a.sync();
    const original = b.db.work_progress.put.bind(b.db.work_progress);
    const failure = vi
      .spyOn(b.db.work_progress, 'put')
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(b.sync()).rejects.toThrow('disk full');
    expect(await b.db.sync_meta.get('cursor')).toBeUndefined();
    expect(await b.db.work_progress.count()).toBe(0);
    failure.mockImplementation(original);
    await b.sync();
    failure.mockRestore();
    expect(await b.repo.getStatus('first')).toBe('completed');
  });
  it('来源 ID 相同而本地主键不同，仍恢复到已有作品', async () => {
    const uid = crypto.randomUUID(),
      a = await device(uid),
      b = await device(uid);
    await a.db.source_mappings.add({
      id: 'map-a',
      entityType: 'work',
      internalId: 'first',
      sourceName: 'Open Opus',
      sourceId: '488',
      lastSeenAt: new Date().toISOString(),
    });
    await b.db.source_mappings.add({
      id: 'map-b',
      entityType: 'work',
      internalId: 'second',
      sourceName: 'Open Opus',
      sourceId: '488',
      lastSeenAt: new Date().toISOString(),
    });
    await a.repo.saveRecord('first', 'unknown', null);
    await a.sync();
    await b.sync();
    expect(await b.repo.getStatus('second')).toBe('completed');
    expect((await b.repo.getRecords('second'))[0]?.dateValue).toBeNull();
    expect(await b.repo.getStatus('first')).toBe('unheard');
  });
  it('已打开的另一同步流程阻止并发，首次空云不推送删除', async () => {
    const uid = crypto.randomUUID(),
      a = await device(uid);
    expect((await a.sync())?.uploaded).toBe(0);
    const locks = navigator.locks;
    const blocked = vi
      .spyOn(locks, 'request')
      .mockImplementation(async (_name, _options, callback) => callback!(null));
    await expect(a.sync()).rejects.toThrow('另一个标签页');
    blocked.mockRestore();
  });
  it('身份只取认证服务的结果，拒绝缺失及无效凭证', async () => {
    await expect(verifyUser(undefined, 'test-env')).rejects.toThrow('UNAUTHORIZED');
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(verifyUser('Bearer token', 'test-env', invalid)).rejects.toThrow('UNAUTHORIZED');
    const valid = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ sub: 'trusted-uid', status: 'ACTIVE' })));
    expect(await verifyUser('Bearer token', 'test-env', valid)).toBe('trusted-uid');
  });
});
