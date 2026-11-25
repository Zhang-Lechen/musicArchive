import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock('@cloudbase/js-sdk', () => ({ default: { init: () => ({ auth }) } }));
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_CLOUDBASE_ENV_ID', 'test-env');
  vi.stubEnv('VITE_SYNC_API_URL', 'https://test.example/sync');
  auth.getSession.mockResolvedValue({
    data: { session: { access_token: 'test-token' } },
    error: null,
  });
  auth.refreshSession.mockResolvedValue({
    data: { session: { access_token: 'refreshed-test-token' } },
    error: null,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it('另一标签切换账户后阻止上传，不能把 A 档案交给 B', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ sub: 'account-b', status: 'ACTIVE' })));
  vi.stubGlobal('fetch', request);
  const { cloudCall } = await import('./client');
  await expect(cloudCall({ protocolVersion: 1, action: 'status' }, 'account-a')).rejects.toThrow(
    '其他标签页切换',
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(String(request.mock.calls[0]?.[0])).toContain('/auth/v1/user/me');
});
it('401 后刷新并验证同一用户，再重试原始请求', async () => {
  const identity = () => new Response(JSON.stringify({ sub: 'account-a', status: 'ACTIVE' }));
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(identity())
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(identity())
    .mockResolvedValueOnce(new Response(JSON.stringify({ protocolVersion: 1, count: 0 })));
  vi.stubGlobal('fetch', request);
  const { cloudCall } = await import('./client');
  expect(await cloudCall({ protocolVersion: 1, action: 'status' }, 'account-a')).toEqual({
    protocolVersion: 1,
    count: 0,
  });
  expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[1]?.[1]?.body).toEqual(request.mock.calls[3]?.[1]?.body);
});
it('非 HTTPS 接口在获取 token 前拒绝', async () => {
  vi.stubEnv('VITE_SYNC_API_URL', 'http://test.example/sync');
  const { cloudCall } = await import('./client');
  await expect(cloudCall({ protocolVersion: 1, action: 'status' }, 'account-a')).rejects.toThrow(
    'HTTPS',
  );
  expect(auth.getSession).not.toHaveBeenCalled();
});
