import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../../db/database';
import { SyncPanel } from './SyncPanel';
const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  cloudCall: vi.fn(),
}));
vi.mock('../../sync/client', () => ({ ...mocks, syncConfigured: true }));
beforeEach(async () => {
  await db.open();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  mocks.account.mockResolvedValue(null);
  mocks.signIn.mockResolvedValue({ uid: 'test-account', email: 'test@example.com' });
  mocks.signOut.mockResolvedValue(undefined);
  mocks.cloudCall.mockImplementation(async (request) =>
    request.action === 'status'
      ? { protocolVersion: 1, count: 0 }
      : { changes: [], cursor: '0', hasMore: false },
  );
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object) => Promise<unknown>,
      ) => callback({}),
    },
  });
});
afterEach(async () => {
  await db.delete();
  vi.clearAllMocks();
});
it('用户通过表单登录、预览、保存备份并完成首次同步', async () => {
  render(<SyncPanel />);
  await waitFor(() => expect(mocks.account).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  fireEvent.click(await screen.findByRole('button', { name: '检查首次同步' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存备份并确认首次同步' }));
  await screen.findByText(/已上传 0 项/);
  expect((await db.sync_meta.get('owner'))?.value).toBe('test-account');
  expect(await db.sync_meta.get('before-first-sync')).toBeDefined();
  expect(await screen.findByRole('button', { name: '下载首次同步前备份' })).toBeEnabled();
});
it('不同账户显示隔离提示，不提供同步按钮', async () => {
  mocks.account.mockResolvedValue({ uid: 'account-b', email: 'b@example.com' });
  await db.sync_meta.put({ key: 'owner', value: 'account-a' });
  render(<SyncPanel />);
  await screen.findByText(/此本地档案已绑定其他账户/);
  expect(screen.queryByRole('button', { name: '立即同步' })).not.toBeInTheDocument();
  expect(mocks.cloudCall).not.toHaveBeenCalled();
});
it('认证失败显示错误且清空密码', async () => {
  mocks.signIn.mockRejectedValueOnce(new Error('登录失败'));
  render(<SyncPanel />);
  await waitFor(() => expect(mocks.account).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'bad-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('密码')).toHaveValue('');
});
