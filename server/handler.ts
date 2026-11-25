import { Pool } from 'pg';
import { ZodError } from 'zod';
import { SyncService } from './service';
import { verifyUser } from './auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ssl:
    process.env.PG_SSL === 'disable'
      ? false
      : { rejectUnauthorized: true, ...(process.env.PG_CA ? { ca: process.env.PG_CA } : {}) },
});
const service = new SyncService(pool);
export type HttpEvent = {
  httpMethod?: string;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
};
export async function main(event: HttpEvent) {
  const headers = Object.fromEntries(
    Object.entries(event.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const origin = headers.origin;
  const allowed = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  const response = (statusCode: number, body: unknown) => ({
    statusCode,
    headers: responseHeaders,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  });
  if (origin && !allowed.includes(origin)) return response(403, { error: 'ORIGIN_NOT_ALLOWED' });
  if (origin) responseHeaders['Access-Control-Allow-Origin'] = origin;
  responseHeaders['Access-Control-Allow-Headers'] = 'Authorization,Content-Type';
  responseHeaders['Access-Control-Allow-Methods'] = 'POST,OPTIONS';
  if (event.httpMethod === 'OPTIONS') return response(204, null);
  if (event.httpMethod !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' });
  if (!process.env.DATABASE_URL || !process.env.CLOUDBASE_ENV_ID)
    return response(503, { error: 'SERVER_CONFIGURATION' });
  if (!headers['content-type']?.startsWith('application/json'))
    return response(415, { error: 'JSON_REQUIRED' });
  if ((event.body?.length ?? 0) > 1400000) return response(413, { error: 'REQUEST_TOO_LARGE' });
  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');
  if (Buffer.byteLength(body, 'utf8') > 1024 * 1024)
    return response(413, { error: 'REQUEST_TOO_LARGE' });
  try {
    const uid = await verifyUser(headers.authorization, process.env.CLOUDBASE_ENV_ID);
    return response(200, await service.execute(uid, JSON.parse(body)));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError)
      return response(400, { error: 'INVALID_REQUEST_OR_PROTOCOL' });
    const code = error instanceof Error ? error.message : '';
    if (code === 'UNAUTHORIZED') return response(401, { error: code });
    if (
      [
        'INVALID_REFERENCE',
        'OPERATION_ID_REUSED',
        'INVALID_BASE_REVISION',
        'BASE_REVISION_EXPIRED',
      ].includes(code)
    )
      return response(409, { error: code });
    // Never log connection strings, tokens, credentials or database exception details.
    return response(503, { error: 'SYNC_UNAVAILABLE' });
  }
}
