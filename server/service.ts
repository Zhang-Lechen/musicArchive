import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  canonical,
  merge,
  requestSchema,
  type Remote,
  type PushResult,
} from '../src/sync/protocol';

type Row = {
  entity_key: string;
  revision: string;
  seq: string;
  payload: Remote['payload'];
  device_id: string;
  updated_at: Date;
};
function remote(row: Row): Remote {
  return {
    key: row.entity_key,
    revision: row.revision,
    seq: row.seq,
    payload: row.payload,
    deviceId: row.device_id,
    updatedAt: row.updated_at.toISOString(),
  };
}
async function entity(client: PoolClient, uid: string, key: string): Promise<Remote> {
  const result = await client.query<Row>(
    'SELECT * FROM archive_sync.entities WHERE owner_uid=$1 AND entity_key=$2',
    [uid, key],
  );
  return result.rows[0]
    ? remote(result.rows[0])
    : {
        key,
        revision: '0',
        seq: '0',
        payload: null,
        deviceId: '',
        updatedAt: new Date(0).toISOString(),
      };
}
export class SyncService {
  constructor(private pool: Pool) {}
  async execute(uid: string, input: unknown): Promise<unknown> {
    if (!uid || uid.length > 200) throw new Error('UNAUTHORIZED');
    const request = requestSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('archive_sync.uid',$1,true)", [uid]);
      let result: unknown;
      if (request.action === 'status') {
        const rows = await client.query(
          'SELECT count(*)::int AS count FROM archive_sync.entities WHERE owner_uid=$1 AND payload IS NOT NULL',
          [uid],
        );
        result = { protocolVersion: 1, count: rows.rows[0].count };
      } else if (request.action === 'pull') {
        const rows = await client.query<Row>(
          'SELECT * FROM archive_sync.changes WHERE owner_uid=$1 AND seq>$2 ORDER BY seq LIMIT $3',
          [uid, request.cursor, request.limit + 1],
        );
        const changes = rows.rows.slice(0, request.limit).map(remote);
        result = {
          changes,
          cursor: changes.at(-1)?.seq ?? request.cursor,
          hasMore: rows.rows.length > request.limit,
        };
      } else {
        const op = request.operation;
        const parts: unknown = JSON.parse(op.key);
        if (
          !Array.isArray(parts) ||
          parts.length !== 3 ||
          !['work', 'composer'].includes(parts[0]) ||
          parts.some((p) => typeof p !== 'string' || !p) ||
          (op.payload && parts[0] !== op.payload.kind)
        )
          throw new Error('INVALID_REFERENCE');
        // Same-user commits serialize before allocating sequence numbers.
        await client.query(
          'INSERT INTO archive_sync.counters(owner_uid) VALUES($1) ON CONFLICT DO NOTHING',
          [uid],
        );
        await client.query('SELECT seq FROM archive_sync.counters WHERE owner_uid=$1 FOR UPDATE', [
          uid,
        ]);
        const hash = createHash('sha256').update(canonical(op)).digest('hex');
        const duplicate = await client.query(
          'SELECT request_hash,result FROM archive_sync.operations WHERE owner_uid=$1 AND operation_id=$2',
          [uid, op.operationId],
        );
        if (duplicate.rows[0]) {
          if (duplicate.rows[0].request_hash !== hash) throw new Error('OPERATION_ID_REUSED');
          result = duplicate.rows[0].result;
        } else {
          const current = await entity(client, uid, op.key);
          let payload = op.payload,
            conflict = false;
          if (op.baseRevision !== current.revision) {
            if (BigInt(op.baseRevision) > BigInt(current.revision))
              throw new Error('INVALID_BASE_REVISION');
            const history =
              op.baseRevision === '0'
                ? null
                : await client.query<Row>(
                    'SELECT * FROM archive_sync.changes WHERE owner_uid=$1 AND entity_key=$2 AND revision=$3',
                    [uid, op.key, op.baseRevision],
                  );
            if (history && !history.rows[0]) throw new Error('BASE_REVISION_EXPIRED');
            const merged = merge(history?.rows[0]?.payload ?? null, op.payload, current.payload);
            payload = merged.payload;
            conflict =
              merged.conflict ||
              (current.payload === null && current.revision !== '0' && op.payload !== null);
            if (op.baseRevision === '0' && op.payload) {
              // Restoring an old backup on a new device must not resurrect removed event IDs.
              const unseenIds = Object.keys(op.payload.records).filter(
                (id) => !current.payload?.records[id],
              );
              if (unseenIds.length) {
                const removed = await client.query(
                  `SELECT 1 FROM archive_sync.changes
                   WHERE owner_uid=$1 AND entity_key=$2 AND (payload->'records') ?| $3::text[] LIMIT 1`,
                  [uid, op.key, unseenIds],
                );
                if (removed.rowCount) conflict = true;
              }
            }
          }
          let next = current;
          if (!conflict) {
            const counter = await client.query(
              'UPDATE archive_sync.counters SET seq=seq+1 WHERE owner_uid=$1 RETURNING seq::text',
              [uid],
            );
            const seq = counter.rows[0].seq as string;
            const revision = (BigInt(current.revision) + 1n).toString();
            const args = [
              uid,
              op.key,
              revision,
              seq,
              payload === null ? null : JSON.stringify(payload),
              op.deviceId,
            ];
            const row = await client.query<Row>(
              `INSERT INTO archive_sync.entities(owner_uid,entity_key,revision,seq,payload,device_id)
              VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_uid,entity_key) DO UPDATE
              SET revision=$3,seq=$4,payload=$5,device_id=$6,updated_at=now() RETURNING *`,
              args,
            );
            next = remote(row.rows[0]!);
            await client.query(
              'INSERT INTO archive_sync.changes(owner_uid,entity_key,revision,seq,payload,device_id) VALUES($1,$2,$3,$4,$5,$6)',
              args,
            );
          }
          result = { operationId: op.operationId, conflict, remote: next } satisfies PushResult;
          await client.query(
            'INSERT INTO archive_sync.operations(owner_uid,operation_id,request_hash,result) VALUES($1,$2,$3,$4)',
            [uid, op.operationId, hash, JSON.stringify(result)],
          );
        }
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
