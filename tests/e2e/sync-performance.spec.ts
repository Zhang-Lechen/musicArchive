import { test, expect } from '@playwright/test';

test('中文输入法组字不跳转，确认候选后正常搜索且 Enter 不重复提交', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('heading', { name: '莫扎特', level: 3 }).click();
  const detailUrl = page.url();
  const search = page.getByRole('searchbox', { name: '搜索作曲家' });
  await search.focus();
  await search.dispatchEvent('compositionstart', { data: '' });
  await search.fill('mozate');
  await expect(search).toHaveValue('mozate');
  expect(page.url()).toBe(detailUrl);
  await search.press('Enter');
  expect(page.url()).toBe(detailUrl);
  await expect(page.getByRole('heading', { name: '莫扎特', level: 1 })).toBeVisible();
  await search.fill('莫扎特');
  expect(page.url()).toBe(detailUrl);
  await search.dispatchEvent('compositionend', { data: '莫扎特' });
  await search.dispatchEvent('input', {
    inputType: 'insertText',
    data: '莫扎特',
    isComposing: false,
  });
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('莫扎特');
  await expect(search).toHaveValue('莫扎特');
  await expect(search).toBeFocused();
  await expect(page.getByRole('heading', { name: '贝多芬', level: 3 })).toHaveCount(0);
  await page.getByRole('search').screenshot({ path: testInfo.outputPath('chinese-search.png') });
  await page.goBack();
  await expect(page).toHaveURL(detailUrl);
  await expect(search).toHaveValue('');
});

test('全局搜索停顿后焦点保留，跨标签页聆听状态实时同步', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('heading', { name: '莫扎特', level: 3 }).waitFor();
  const search = page.getByRole('searchbox', { name: '搜索作曲家' });
  await search.fill('莫');
  await expect(page.getByRole('heading', { name: '贝多芬', level: 3 })).toHaveCount(0);
  await expect(search).toBeFocused();
  await search.pressSequentially('扎特', { delay: 300 });
  await expect(search).toHaveValue('莫扎特');
  await expect(search).toBeFocused();
  await page.getByRole('heading', { name: '莫扎特', level: 3 }).click();
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('K551');
  await expect(page.getByTestId('work-card')).toHaveCount(1);
  const second = await context.newPage();
  await second.goto(page.url());
  await second.getByRole('searchbox', { name: '搜索作品' }).fill('K551');
  await expect(second.getByTestId('work-card')).toHaveCount(1);
  await page.getByRole('button', { name: '聆听', exact: true }).click();
  await expect(second.getByRole('button', { name: '记录日期', exact: true })).toBeVisible();
  await expect(second.getByRole('progressbar', { name: '已收录作品中的进度' })).toHaveAttribute(
    'value',
    '1',
  );
});

test('3000 条隔离测试目录只渲染 36 张卡片，末条检索可用', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('heading', { name: '莫扎特', level: 3 }).waitFor();
  const fixture = {
    composers: [
      {
        id: 'perf-only',
        nameOriginal: 'Performance fixture — test only',
        nameZh: '性能测试（仅自动化测试数据）',
        aliases: [],
        coverageStatus: 'sample',
      },
    ],
    works: Array.from({ length: 3000 }, (_, i) => ({
      id: `perf-work-${String(i).padStart(4, '0')}`,
      composerId: 'perf-only',
      titleOriginal: `性能测试作品 ${i}`,
      kind: 'work',
      catalogStatus: 'confirmed',
    })),
    workIdentifiers: [],
    workAliases: [],
    sourceMappings: [],
  };
  await page.getByRole('button', { name: '数据与备份' }).click();
  await page.getByLabel('选择目录 JSON').setInputFiles({
    name: 'test-only-catalog.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.getByRole('checkbox', { name: '确认更新目录元数据' }).check();
  await page.getByRole('button', { name: '确认更新目录', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/composers/perf-only');
  await expect(page.getByTestId('work-card')).toHaveCount(36);
  await expect(page.getByRole('progressbar', { name: '已收录作品中的进度' })).toHaveAttribute(
    'max',
    '3000',
  );
  const start = Date.now();
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('性能测试作品 2999');
  await expect(page.getByTestId('work-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '性能测试作品 2999', exact: true })).toBeVisible();
  await testInfo.attach('search-timing.json', {
    body: JSON.stringify({
      works: 3000,
      maxCards: 36,
      searchMillisecondsIncludingDebounce: Date.now() - start,
    }),
    contentType: 'application/json',
  });
});
