import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL must be set in the migration process environment.');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PG_SSL === 'disable'
      ? false
      : { rejectUnauthorized: true, ...(process.env.PG_CA ? { ca: process.env.PG_CA } : {}) },
});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('music-archive-sync-migrations'))");
  const existing = await client.query("SELECT to_regclass('archive_sync.migrations') AS name");
  if (existing.rows[0].name) {
    const versions = await client.query(
      'SELECT version FROM archive_sync.migrations ORDER BY version',
    );
    if (versions.rows.length !== 1 || versions.rows[0].version !== 1)
      throw new Error('Unknown migration version; manual review required.');
    console.log('Sync schema version 1 already installed; no changes.');
  } else {
    await client.query(
      await readFile(new URL('../server/migrations/001_sync.sql', import.meta.url), 'utf8'),
    );
    console.log('Sync schema version 1 installed.');
  }
  await client.query('COMMIT');
} catch {
  await client.query('ROLLBACK');
  throw new Error(
    'Migration failed and rolled back. Check database role, TLS and schema configuration.',
  );
} finally {
  client.release();
  await pool.end();
}
