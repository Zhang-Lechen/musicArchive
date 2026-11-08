import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './routes';
import { db } from '../db/database';
import { initializeSeed } from '../services/catalog';
import { validateCatalog } from '../services/validation';
import seedJson from '../data/seed.json';
import { repository } from '../db/repository';
import { makeIdentifier } from '../domain/catalog';

const seed = validateCatalog(seedJson);
const mozart = seed.composers.find((c) => c.aliases.includes('Mozart'))!;
beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await initializeSeed(db, seed);
});
afterAll(async () => {
  await db.delete();
});
function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}
describe('真实本地数据的页面与导航', () => {
  it('一级导航平级，旧收藏链接兼容，前进后退保留路由与个人标记', async () => {
    const user = userEvent.setup();
    await repository.setComposerPreference(mozart.id, 'isFavorite', true);
    const router = renderRoute('/composers');
    const nav = within(screen.getByRole('navigation', { name: '主导航' }));
    expect(nav.getAllByRole('link')).toHaveLength(3);
    expect(nav.getByRole('link', { name: '作曲家' })).toHaveAttribute('aria-current', 'page');
    await user.click(nav.getByRole('link', { name: '我的收藏' }));
    await user.click(await screen.findByRole('link', { name: /^喜欢的作曲家/ }));
    expect(await screen.findByRole('heading', { name: '莫扎特', level: 3 })).toBeVisible();
    const favoritesPath = router.state.location.pathname + router.state.location.search;
    await user.click(nav.getByRole('link', { name: '聆听统计' }));
    expect(await screen.findByRole('heading', { name: '聆听统计', level: 1 })).toBeVisible();
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname + router.state.location.search).toBe(favoritesPath);
    await act(() => router.navigate(1));
    expect(router.state.location.pathname).toBe('/statistics');
    await act(() => router.navigate('/collection?section=composers'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/favorites'));
    expect(router.state.location.search).toBe('?section=composers');
    expect(await repository.getComposerPreference(mozart.id)).toMatchObject({ isFavorite: true });
  });
  it('统计从真实数据库实时更新，日期修改、删除与完整状态独立', async () => {
    const workId = seed.workIdentifiers.find((row) => row.normalizedValue === 'k551')!.workId;
    renderRoute('/statistics');
    await screen.findByRole('heading', { name: '聆听统计', level: 1 });
    expect(screen.getByTestId('statistics-completed')).toHaveTextContent('0 部');
    expect(screen.getByTestId('statistics-coverage')).toHaveTextContent('0%');
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
    await repository.setStatus(workId, 'partial');
    await waitFor(() => expect(screen.getByTestId('statistics-partial')).toHaveTextContent('1 部'));
    expect(screen.getByTestId('statistics-completed')).toHaveTextContent('0 部');
    await repository.setStatus(workId, 'completed', {
      completedDate: { datePrecision: 'year', dateValue: '1998' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('statistics-completed')).toHaveTextContent('1 部'),
    );
    expect(await screen.findByLabelText('1998年：1部')).toBeVisible();
    expect(screen.getByTestId('statistics-partial')).toHaveTextContent('0 部');
    const [record] = await repository.getRecords(workId);
    await repository.updateRecord(record!.id, { datePrecision: 'month', dateValue: '2001-03' });
    expect(await screen.findByLabelText('2001年：1部')).toBeVisible();
    expect(screen.queryByLabelText('1998年：1部')).not.toBeInTheDocument();
    await repository.deleteRecord(record!.id);
    await waitFor(() => expect(screen.getByTestId('statistics-unknown')).toHaveTextContent('1 部'));
    expect(screen.getByTestId('statistics-completed')).toHaveTextContent('1 部');
    await repository.setStatus(workId, 'unheard', { confirmClearHistory: true });
    await waitFor(() =>
      expect(screen.getByTestId('statistics-completed')).toHaveTextContent('0 部'),
    );
  });
  it.each(['composer', 'queue'] as const)(
    '%s 页的“听过”创建不详记录，弹窗重复标记不重复写入',
    async (surface) => {
      const user = userEvent.setup();
      const workId = seed.workIdentifiers.find(
        (identifier) => identifier.normalizedValue === 'k551',
      )!.workId;
      await repository.setWorkPreference(workId, 'isInQueue', true);
      renderRoute(surface === 'composer' ? `/composers/${mozart.id}` : '/collection?section=queue');
      if (surface === 'composer') {
        await screen.findByRole('heading', { name: '莫扎特', level: 1 });
        await user.type(screen.getByRole('searchbox', { name: '搜索作品' }), 'K551');
      }
      await waitFor(() => expect(screen.getAllByTestId('work-card')).toHaveLength(1));
      const card = within(screen.getByTestId('work-card'));
      expect(card.getByRole('button', { name: '聆听' })).toBeVisible();
      await user.click(card.getByRole('button', { name: '听过' }));
      expect(await card.findByText('最近聆听日期：日期不详')).toBeVisible();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await repository.getStatus(workId)).toBe('completed');
      expect(await repository.getRecords(workId)).toEqual([
        expect.objectContaining({
          workId,
          datePrecision: 'unknown',
          dateValue: null,
          dateKey: 'unknown',
        }),
      ]);
      expect(await repository.getWorkPreference(workId)).toMatchObject({ isInQueue: true });
      await user.click(await card.findByRole('button', { name: '记录日期' }));
      const dialog = within(screen.getByRole('dialog'));
      await user.click(dialog.getByRole('button', { name: '标记已听过（日期不详）' }));
      await waitFor(async () => expect(await repository.getRecords(workId)).toHaveLength(1));
      expect(dialog.getByRole('button', { name: '删除 日期不详' })).toBeVisible();
    },
  );
  it('收藏按既有编号升序排列，分页限制 36 条，搜索后返回第一页', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 40 }, (_, index) => ({
      id: `paged-${40 - index}`,
      composerId: mozart.id,
      titleOriginal: `Pagination work ${40 - index}`,
      kind: 'work' as const,
      catalogStatus: 'confirmed' as const,
    }));
    await db.works.bulkAdd(rows);
    await db.work_identifiers.bulkAdd(
      rows.map((row, index) => makeIdentifier(row.id, 'K', `K.${40 - index}`)),
    );
    await db.work_preferences.bulkAdd(
      rows.map((row) => ({
        workId: row.id,
        isFavorite: true,
        isInQueue: false,
        updatedAt: new Date().toISOString(),
      })),
    );
    renderRoute('/collection?section=works');
    await waitFor(() => expect(screen.getAllByTestId('work-card')).toHaveLength(36));
    expect(within(screen.getAllByTestId('work-card')[0]!).getByText('K.1')).toBeVisible();
    expect(within(screen.getAllByTestId('work-card')[35]!).getByText('K.36')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getAllByTestId('work-card')).toHaveLength(4);
    expect(within(screen.getAllByTestId('work-card')[0]!).getByText('K.37')).toBeVisible();
    await user.type(screen.getByRole('searchbox', { name: '搜索收藏与待听' }), 'K40');
    await waitFor(() => expect(screen.getAllByTestId('work-card')).toHaveLength(1));
    expect(within(screen.getByTestId('work-card')).getByText('K.40')).toBeVisible();
  });
  it('首页关注/喜欢独立，键盘可操作，筛选与详情/收藏导航同步', async () => {
    const user = userEvent.setup();
    renderRoute('/');
    const follow = await screen.findByRole('button', { name: '关注 莫扎特' });
    await waitFor(() => expect(follow).toBeEnabled());
    follow.focus();
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('button', { name: '取消关注 莫扎特', pressed: true }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: '喜欢作曲家 莫扎特' }));
    await user.selectOptions(screen.getByLabelText('个人标记'), 'following');
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
    await user.click(screen.getByRole('heading', { name: '莫扎特', level: 3 }));
    expect(
      await screen.findByRole('button', { name: '取消喜欢作曲家 莫扎特', pressed: true }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: '取消关注 莫扎特' }));
    await user.click(screen.getByRole('link', { name: '我的收藏' }));
    expect(await screen.findByRole('heading', { name: '这份清单还没有内容' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: /^喜欢的作曲家/ }));
    expect(await screen.findByRole('heading', { name: '莫扎特', level: 3 })).toBeVisible();
    expect(await repository.getComposerPreference(mozart.id)).toMatchObject({
      isFavorite: true,
      isFollowing: false,
    });
  });

  it('未听作品可喜欢并待听，清单支持名称与编号搜索，移出不改变喜欢与历史', async () => {
    const user = userEvent.setup();
    const identifier = seed.workIdentifiers.find((i) => i.normalizedValue === 'k551')!;
    renderRoute(`/composers/${mozart.id}`);
    await screen.findByRole('heading', { name: '莫扎特', level: 1 });
    await user.type(screen.getByRole('searchbox', { name: '搜索作品' }), 'K551');
    await waitFor(() => expect(screen.getAllByTestId('work-card')).toHaveLength(1));
    const card = within(screen.getByTestId('work-card'));
    await user.click(card.getByRole('button', { name: /^喜欢作品 / }));
    await user.click(card.getByRole('button', { name: /^加入待听 / }));
    expect(await repository.getStatus(identifier.workId)).toBe('unheard');
    expect(await repository.getRecords(identifier.workId)).toEqual([]);
    await user.click(screen.getByRole('link', { name: '我的收藏' }));
    await user.click(screen.getByRole('link', { name: /^待听清单/ }));
    const search = screen.getByRole('searchbox', { name: '搜索收藏与待听' });
    for (const term of ['莫扎特', 'KV 551', '朱庇特']) {
      await user.clear(search);
      await user.type(search, term);
      await waitFor(() => expect(screen.getAllByTestId('work-card')).toHaveLength(1));
    }
    await user.type(search, '不存在');
    expect(await screen.findByRole('heading', { name: '没有匹配的收藏或待听项' })).toBeVisible();
    await user.clear(search);
    await user.click(await screen.findByRole('button', { name: '聆听' }));
    expect(await screen.findByRole('button', { name: '记录日期' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^查看/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(await dialog.findByRole('button', { name: /^移出待听 /, pressed: true })).toBeVisible();
    await user.click(dialog.getByRole('button', { name: /^移出待听 / }));
    expect(await dialog.findByRole('button', { name: /^加入待听 /, pressed: false })).toBeVisible();
    await user.click(dialog.getByRole('button', { name: '关闭弹窗' }));
    await waitFor(() => expect(screen.queryByTestId('work-card')).not.toBeInTheDocument());
    await user.click(screen.getByRole('link', { name: /^喜欢的作品/ }));
    expect(await screen.findByTestId('work-card')).toBeVisible();
    expect(await repository.getStatus(identifier.workId)).toBe('completed');
    expect(await repository.getRecords(identifier.workId)).toHaveLength(1);
  });

  it('偏好写入失败保留界面原状态并支持重试，不触发导航', async () => {
    const user = userEvent.setup();
    const router = renderRoute('/');
    const button = await screen.findByRole('button', { name: '关注 莫扎特' });
    await waitFor(() => expect(button).toBeEnabled());
    const spy = vi
      .spyOn(repository, 'setComposerPreference')
      .mockRejectedValueOnce(new Error('磁盘写入失败'));
    try {
      await user.click(button);
      expect(await screen.findByRole('alert')).toHaveTextContent('磁盘写入失败');
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(router.state.location.pathname).toBe('/');
      await user.click(button);
      expect(
        await screen.findByRole('button', { name: '取消关注 莫扎特', pressed: true }),
      ).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
  it('中文组字期间保留原页面与草稿，候选确认后才提交，并支持返回同步', async () => {
    const path = `/composers/${mozart.id}`;
    const router = renderRoute(path);
    await screen.findByRole('heading', { name: '莫扎特', level: 1 });
    const input = screen.getByRole('searchbox', { name: '搜索作曲家' });
    input.focus();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'mozate' } });
    expect(input).toHaveValue('mozate');
    expect(router.state.location.pathname).toBe(path);
    expect(router.state.location.search).toBe('');
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 229,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(input, enter);
    expect(enter.defaultPrevented).toBe(true);
    fireEvent.submit(input.closest('form')!);
    expect(router.state.location.pathname).toBe(path);
    fireEvent.change(input, { target: { value: '莫扎特' } });
    fireEvent.compositionEnd(input, { data: '莫扎特' });
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('q')).toBe('莫扎特'),
    );
    expect(input).toHaveValue('莫扎特');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '莫扎特' } });
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.pathname).toBe(path);
    await waitFor(() => expect(input).toHaveValue(''));
  });
  it('搜索草稿随地址栏导航和清除搜索同步，不显示 URL 转义字符', async () => {
    const user = userEvent.setup();
    const router = renderRoute('/?q=%E8%8E%AB%E6%89%8E%E7%89%B9');
    const input = screen.getByRole('searchbox', { name: '搜索作曲家' });
    expect(input).toHaveValue('莫扎特');
    await act(async () => {
      await router.navigate('/?q=%E8%B4%9D%E5%A4%9A%E8%8A%AC');
    });
    await waitFor(() => expect(input).toHaveValue('贝多芬'));
    await user.clear(input);
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(input).toHaveValue('');
  });
  it('已听过卡片实时显示最近日期，编辑、删除后回退到剩余日期并保留精度', async () => {
    const user = userEvent.setup();
    const identifier = seed.workIdentifiers.find((i) => i.normalizedValue === 'k551')!;
    const workId = identifier.workId;
    renderRoute(`/composers/${mozart.id}`);
    await screen.findByRole('heading', { name: '莫扎特', level: 1 });
    await user.type(screen.getByRole('searchbox', { name: '搜索作品' }), 'K551');
    await waitFor(() => expect(screen.getAllByTestId('work-card')).toHaveLength(1));
    const card = within(screen.getByTestId('work-card'));
    expect(card.queryByText(/最近聆听日期/)).not.toBeInTheDocument();
    await repository.setHeard([workId], false);
    expect(await card.findByText('最近聆听日期：日期不详')).toBeVisible();
    await repository.saveRecord(workId, 'day', '2020-06-15');
    await repository.saveRecord(workId, 'month', '2020-06');
    await repository.saveRecord(workId, 'year', '2019');
    await repository.saveRecord(workId, 'unknown', null);
    expect(await card.findByText('2020年6月15日')).toBeVisible();
    const record = (await repository.getSnapshot(workId)).records.find(
      (r) => r.datePrecision === 'day',
    )!;
    await repository.saveRecord(workId, 'day', '2017-01-01', record.id);
    expect(await card.findByText('2020年6月')).toBeVisible();
    const month = (await repository.getSnapshot(workId)).records.find(
      (r) => r.datePrecision === 'month',
    )!;
    await repository.deleteRecord(workId, month.id);
    expect(await card.findByText('2019年')).toBeVisible();
    for (const item of (await repository.getSnapshot(workId)).records)
      await repository.deleteRecord(workId, item.id);
    expect(await card.findByText('最近聆听日期：日期不详')).toBeVisible();
    const token = await repository.resetUnheard(workId, { confirmClearHistory: true });
    await waitFor(() => expect(card.queryByText(/最近聆听日期/)).not.toBeInTheDocument());
    await repository.undo(token);
    expect(await card.findByText('最近聆听日期：日期不详')).toBeVisible();
  });
  it('首页显示真实作曲家与样本覆盖，搜索中文名可导航', async () => {
    const user = userEvent.setup();
    renderRoute('/');
    await screen.findByRole('heading', { name: '莫扎特', level: 3 });
    expect(screen.getAllByText('示例目录 · 完整性未验证')).toHaveLength(7);
    await user.type(screen.getByRole('searchbox', { name: '搜索作曲家' }), '莫扎特');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '贝多芬', level: 3 })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('heading', { name: '莫扎特', level: 3 }));
    expect(await screen.findByRole('heading', { name: '莫扎特', level: 1 })).toBeVisible();
  });
  it('编号变体与别名搜索、状态筛选组合正确，按钮不会打开弹窗', async () => {
    const user = userEvent.setup();
    renderRoute(`/composers/${mozart.id}`);
    await screen.findByRole('heading', { name: '莫扎特', level: 1 });
    const search = screen.getByRole('searchbox', { name: '搜索作品' });
    await user.type(search, 'K. 551');
    await waitFor(() => expect(screen.getAllByTestId('work-card')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /^聆听$/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '记录日期' })).toBeVisible());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('听过状态'), 'unheard');
    expect(await screen.findByRole('heading', { name: '没有匹配的作品' })).toBeVisible();
    await user.selectOptions(screen.getByLabelText('听过状态'), 'heard');
    await user.clear(search);
    await user.type(search, '朱庇特');
    await waitFor(() => expect(screen.getAllByTestId('work-card')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: '记录日期' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '聆听历史' })).toBeVisible();
  });
  it('个人进度改变后，首页统计自动更新', async () => {
    const user = userEvent.setup();
    const router = renderRoute('/');
    await screen.findByRole('heading', { name: '莫扎特', level: 3 });
    const progress = screen.getByRole('progressbar', { name: '莫扎特 已收录作品中的进度' });
    expect(progress).toHaveAttribute('value', '0');
    await repository.setHeard([seed.works.find((w) => w.composerId === mozart.id)!.id], false);
    await waitFor(() => expect(progress).toHaveAttribute('value', '1'));
    await user.click(await screen.findByRole('link', { name: '1 部作品已听过，查看聆听统计' }));
    expect(router.state.location.pathname).toBe('/statistics');
    expect(await screen.findByTestId('statistics-completed')).toHaveTextContent('1 部');
  });
  it('未知作曲家与未知路由提供明确返回入口', async () => {
    const router = renderRoute('/composers/missing');
    expect(await screen.findByRole('heading', { name: '未找到作曲家' })).toBeVisible();
    await router.navigate('/unknown-route');
    expect(await screen.findByRole('heading', { name: '页面不存在' })).toBeVisible();
  });
});
