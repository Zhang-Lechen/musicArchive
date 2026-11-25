import { z } from 'zod';
import type cloudbase from '@cloudbase/js-sdk';
import type { SyncRequest } from './protocol';

export const syncConfigured = Boolean(
  import.meta.env.VITE_CLOUDBASE_ENV_ID && import.meta.env.VITE_SYNC_API_URL,
);
let sdkPromise: Promise<ReturnType<typeof cloudbase.init>> | undefined;
async function sdk() {
  if (!syncConfigured) throw new Error('尚未配置云同步，请按部署说明配置 CloudBase。');
  sdkPromise ??= import('@cloudbase/js-sdk').then(({ default: cloudbase }) =>
    cloudbase.init({
      env: import.meta.env.VITE_CLOUDBASE_ENV_ID,
      region: 'ap-shanghai',
      accessKey: import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY || undefined,
      persistence: 'local',
    }),
  );
  return sdkPromise;
}
export async function signIn(email: string, password: string) {
  const { error } = await (await sdk()).auth.signInWithPassword({ email, password });
  if (error) throw new Error('登录失败，请检查邮箱、密码和控制台认证配置。');
  return account();
}
export async function signOut() {
  const result = await (await sdk()).auth.signOut();
  if (result && 'error' in result && result.error) throw new Error('退出登录失败，请重试。');
}
async function token(force = false) {
  const auth = (await sdk()).auth;
  const { data, error } = force ? await auth.refreshSession() : await auth.getSession();
  if (error || !data.session?.access_token)
    throw new Error('登录已过期，请重新登录。本地数据仍保留。');
  return data.session.access_token;
}
export async function account(): Promise<{ uid: string; email: string } | null> {
  const { data, error } = await (await sdk()).auth.getSession();
  if (error || !data.session) return null;
  const response = await fetch(
    `https://${import.meta.env.VITE_CLOUDBASE_ENV_ID}.api.tcloudbasegateway.com/auth/v1/user/me`,
    {
      headers: { Authorization: `Bearer ${await token()}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error('无法验证账户，请检查网络或重新登录。');
  const user = z
    .object({ sub: z.string().min(1), email: z.string().optional(), status: z.literal('ACTIVE') })
    .parse(await response.json());
  return { uid: user.sub, email: user.email ?? user.sub };
}
export async function cloudCall(request: SyncRequest, expectedUid: string): Promise<unknown> {
  if (!navigator.onLine) throw new Error('当前离线，本地修改已保存，联网后可重试。');
  const url = new URL(import.meta.env.VITE_SYNC_API_URL);
  if (url.protocol !== 'https:') throw new Error('同步接口必须使用 HTTPS。');
  const body = JSON.stringify(request);
  if (new TextEncoder().encode(body).length > 1024 * 1024)
    throw new Error('单个作品的同步数据超过 1 MiB，请联系维护者。');
  for (let attempt = 0; attempt < 2; attempt++) {
    const accessToken = await token(attempt > 0);
    const identity = await fetch(
      `https://${import.meta.env.VITE_CLOUDBASE_ENV_ID}.api.tcloudbasegateway.com/auth/v1/user/me`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      },
    );
    if (!identity.ok) {
      if (attempt === 0) continue;
      throw new Error('登录已失效，请重新登录。');
    }
    const verified = z
      .object({ sub: z.string(), status: z.literal('ACTIVE') })
      .parse(await identity.json());
    if (verified.sub !== expectedUid)
      throw new Error('账户已在其他标签页切换，已停止同步以保护档案。');
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (response.status === 401 && attempt === 0) continue;
    if (!response.ok) {
      if (response.status === 401) throw new Error('登录已失效，请重新登录。本地数据仍保留。');
      throw new Error(`云端同步失败（HTTP ${response.status}）。本地修改仍保留，可重试。`);
    }
    return response.json();
  }
  throw new Error('登录已失效，请重新登录。');
}
