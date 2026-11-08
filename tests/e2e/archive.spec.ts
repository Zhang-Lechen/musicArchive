import { test, expect, chromium, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function enterMozart(page: Page) {
  await page.goto('/');
  await page.getByRole('heading', { name: '莫扎特', level: 3 }).click();
  await expect(page.getByRole('heading', { name: '莫扎特', level: 1 })).toBeVisible();
}
async function jupiter(page: Page) {
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('K551');
  await expect(page.getByTestId('work-card')).toHaveCount(1);
}
async function openJupiter(page: Page) {
  await page.getByTestId('work-card').getByRole('button', { name: /^查看/ }).click();
  return page.getByRole('dialog');
}

test('听过按钮位于聆听左侧且同尺寸，窄屏无溢出，保存不详记录并持久化', async ({
  page,
}, testInfo) => {
  await enterMozart(page);
  await jupiter(page);
  const card = page.getByTestId('work-card');
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const heard = card.getByRole('button', { name: '听过', exact: true });
    const listen = card.getByRole('button', { name: '聆听', exact: true });
    const left = await heard.boundingBox();
    const right = await listen.boundingBox();
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left!.x + left!.width).toBeLessThan(right!.x);
    expect(left!.y).toBeCloseTo(right!.y, 0);
    expect(left!.width).toBeCloseTo(right!.width, 0);
    expect(left!.height).toBeCloseTo(right!.height, 0);
    await expect(heard).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const accent = await heard.evaluate((button) => getComputedStyle(button).color);
    await expect(heard).toHaveCSS('border-top-color', accent);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await card.screenshot({ path: testInfo.outputPath(`heard-button-${width}.png`) });
  }
  await card.getByRole('button', { name: '听过', exact: true }).click();
  await expect(card.getByText('最近聆听日期：日期不详')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(card.getByRole('button', { name: '听过', exact: true })).toBeVisible();
  await expect(card.getByText('○ 未听过', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: '听过', exact: true }).click();
  await expect(card.getByText('最近聆听日期：日期不详')).toBeVisible();
  await page.reload();
  await jupiter(page);
  const dialog = await openJupiter(page);
  await expect(dialog.getByRole('button', { name: '删除 日期不详', exact: true })).toHaveCount(1);
});
test('完整路径：聆听、历史年日、删除、刷新、导出并在新浏览器档案恢复', async ({
  page,
  browser,
}, testInfo) => {
  // Two full 25k-work archives are initialized and restored in this round trip.
  test.setTimeout(120000);
  await enterMozart(page);
  await jupiter(page);
  await page.getByRole('button', { name: '关注 莫扎特', exact: true }).click();
  await page.getByRole('button', { name: '喜欢作曲家 莫扎特', exact: true }).click();
  await page.getByRole('button', { name: /^喜欢作品 / }).click();
  await page.getByRole('button', { name: /^加入待听 / }).click();
  await page.getByRole('button', { name: '聆听', exact: true }).click();
  await expect(page.getByText('✓ 已听过', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '记录日期', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^编辑 / }).click();
  await dialog.getByLabel('聆听日期', { exact: true }).fill('2019-06-15');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog.getByText('2019年6月15日', { exact: true })).toBeVisible();
  await dialog.getByLabel('日期精度').selectOption('year');
  await dialog.getByLabel('聆听日期', { exact: true }).fill('2019');
  await dialog.getByRole('button', { name: '添加日期', exact: true }).click();
  await expect(dialog.getByText('2019年', { exact: true })).toBeVisible();
  page.once('dialog', (confirm) => confirm.accept());
  await dialog.getByRole('button', { name: '删除 2019年6月15日' }).click();
  await expect(dialog.getByText('2019年6月15日', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '记录日期', exact: true })).toBeFocused();
  await expect(page.getByTestId('work-card').locator('.latest-listening-date')).toHaveText(
    '最近聆听日期：2019年',
  );
  await page.reload();
  await jupiter(page);
  await expect(page.getByRole('button', { name: '记录日期', exact: true })).toBeVisible();
  await openJupiter(page);
  await expect(page.getByRole('dialog').getByText('2019年', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '数据与备份' }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON 备份' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(
    /^classical-listening-backup-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const file = await download.path();
  const json = await readFile(file!, 'utf8');
  const backup = JSON.parse(json) as {
    listeningRecords: { dateValue: string; datePrecision: string }[];
    composerPreferences: { isFollowing: boolean; isFavorite: boolean }[];
    workPreferences: { isFavorite: boolean; isInQueue: boolean }[];
  };
  expect(backup.listeningRecords).toHaveLength(1);
  expect(backup.listeningRecords[0]).toMatchObject({ datePrecision: 'year', dateValue: '2019' });
  expect(backup.composerPreferences).toEqual([
    expect.objectContaining({ isFollowing: true, isFavorite: true }),
  ]);
  expect(backup.workPreferences).toEqual([
    expect.objectContaining({ isFavorite: true, isInQueue: true }),
  ]);
  const fresh = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  try {
    const restored = await fresh.newPage();
    await restored.goto('http://127.0.0.1:4175/');
    await restored.getByRole('heading', { name: '莫扎特', level: 3 }).waitFor();
    await restored.getByRole('button', { name: '数据与备份' }).click();
    await restored.getByLabel('选择备份 JSON').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    await expect(restored.getByRole('heading', { name: '备份恢复预览' })).toBeVisible();
    await restored.getByRole('checkbox', { name: '我理解这将替换当前本地数据' }).check();
    await restored.getByRole('button', { name: '确认替换本地数据' }).click();
    await expect(restored.getByRole('dialog')).toHaveCount(0);
    await restored.getByRole('heading', { name: '莫扎特', level: 3 }).click();
    await jupiter(restored);
    await expect(
      restored.getByRole('button', { name: '取消关注 莫扎特', pressed: true }),
    ).toBeVisible();
    await expect(
      restored.getByRole('button', { name: '取消喜欢作曲家 莫扎特', pressed: true }),
    ).toBeVisible();
    await expect(
      restored.getByRole('button', { name: /^取消喜欢作品 /, pressed: true }),
    ).toBeVisible();
    await expect(restored.getByRole('button', { name: /^移出待听 /, pressed: true })).toBeVisible();
    await expect(restored.getByTestId('work-card').locator('.latest-listening-date')).toHaveText(
      '最近聆听日期：2019年',
    );
    await restored
      .getByTestId('work-card')
      .screenshot({ path: testInfo.outputPath('latest-listening-card.png') });
    await expect(restored.getByRole('progressbar', { name: '已收录作品中的进度' })).toHaveAttribute(
      'value',
      '1',
    );
    await openJupiter(restored);
    await expect(restored.getByRole('dialog').getByText('2019年', { exact: true })).toBeVisible();
    await restored.screenshot({ path: testInfo.outputPath('restored-year-record.png') });
  } finally {
    await fresh.close();
  }
});

test('删空日期保留听过状态，恢复未听过与撤销均可靠', async ({ page }) => {
  await enterMozart(page);
  await jupiter(page);
  await page.getByRole('button', { name: '聆听', exact: true }).click();
  await page.getByRole('button', { name: '记录日期', exact: true }).click();
  const dialog = page.getByRole('dialog');
  page.once('dialog', (confirm) => confirm.accept());
  await dialog.getByRole('button', { name: /^删除 / }).click();
  await expect(dialog.getByText('✓ 已听过', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('日期记录状态')).toHaveText('日期不详');
  page.once('dialog', (confirm) => confirm.accept());
  await dialog.getByRole('button', { name: '恢复未听过', exact: true }).click();
  await expect(dialog.getByText('○ 未听过', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(dialog.getByText('✓ 已听过', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('日期记录状态')).toHaveText('日期不详');
});

test('重复和未来日期被拒绝；未保存修改和键盘焦点受保护', async ({ page }) => {
  await enterMozart(page);
  await jupiter(page);
  const dialog = await openJupiter(page);
  await dialog.getByLabel('日期精度').selectOption('year');
  await dialog.getByLabel('聆听日期', { exact: true }).fill('2019');
  await dialog.getByRole('button', { name: '添加日期', exact: true }).click();
  await expect(dialog.getByText('2019年', { exact: true })).toBeVisible();
  await dialog.getByLabel('日期精度').selectOption('year');
  await dialog.getByLabel('聆听日期', { exact: true }).fill('2019');
  await dialog.getByRole('button', { name: '添加日期', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('已有记录');
  await dialog.getByLabel('聆听日期', { exact: true }).fill('9999');
  await dialog.getByRole('button', { name: '添加日期', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('不能晚于今天');
  await dialog.getByRole('button', { name: '关闭弹窗' }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);
  page.once('dialog', (confirm) => confirm.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  page.once('dialog', (confirm) => confirm.accept());
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('分页限制 DOM，跨页批量操作可撤销且状态筛选即时同步', async ({ page }) => {
  await enterMozart(page);
  await expect(page.getByTestId('work-card')).toHaveCount(36);
  await page
    .getByRole('navigation', { name: '作品分页' })
    .getByRole('button', { name: '下一页' })
    .click();
  await expect(page.getByTestId('work-card')).toHaveCount(36);
  await page.getByRole('checkbox', { name: '选择本页' }).check();
  await page.getByRole('button', { name: '批量标记日期不详' }).click();
  await expect(page.getByRole('progressbar', { name: '已收录作品中的进度' })).toHaveAttribute(
    'value',
    '36',
  );
  await page.getByLabel('听过状态').selectOption('heard');
  await expect(page.getByTestId('work-card')).toHaveCount(36);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('heading', { name: '没有匹配的作品' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: '已收录作品中的进度' })).toHaveAttribute(
    'value',
    '0',
  );
  await page.getByLabel('听过状态').selectOption('all');
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('朱庇特');
  await expect(page.getByTestId('work-card')).toHaveCount(1);
});

test('坏备份不能污染档案，恢复前必须明确确认', async ({ page }) => {
  await enterMozart(page);
  await jupiter(page);
  await page.getByRole('button', { name: '聆听', exact: true }).click();
  await page.getByRole('button', { name: '数据与备份' }).click();
  await page.getByLabel('选择备份 JSON').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"formatVersion":999}'),
  });
  await expect(page.getByRole('alert')).toContainText('未通过校验');
  await expect(page.getByRole('button', { name: '确认替换本地数据' })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(page.getByRole('button', { name: '记录日期', exact: true })).toBeVisible();
});

test('手动补录防止编号重复，子作品不自动计入进度', async ({ page }) => {
  await enterMozart(page);
  const maxBefore = Number(
    await page.getByRole('progressbar', { name: '已收录作品中的进度' }).getAttribute('max'),
  );
  await page.getByRole('button', { name: '＋ 补录作品' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('原文或可读作品名称').fill('Acceptance work');
  await dialog.getByLabel('主编号体系', { exact: true }).fill('TEST');
  await dialog.getByLabel('完整主编号（可选）').fill('TEST.1');
  await dialog.getByRole('button', { name: '保存作品' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: '已收录作品中的进度' })).toHaveAttribute(
    'max',
    String(maxBefore + 1),
  );
  await page.getByRole('button', { name: '＋ 补录作品' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('原文或可读作品名称').fill('Another title');
  await dialog.getByLabel('主编号体系', { exact: true }).fill('TEST');
  await dialog.getByLabel('完整主编号（可选）').fill('TEST.1');
  await dialog.getByRole('button', { name: '保存作品' }).click();
  await expect(dialog.getByRole('alert')).toContainText('编号已存在');
  page.once('dialog', (confirm) => confirm.accept());
  await dialog.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '＋ 补录作品' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('原文或可读作品名称').fill('Acceptance movement');
  await dialog.getByLabel('条目层级').selectOption('movement');
  await dialog
    .getByLabel('上级作品（可选，子作品不单独统计）')
    .selectOption({ label: 'Acceptance work' });
  await dialog.getByRole('button', { name: '保存作品' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('Acceptance movement');
  await expect(page.getByRole('heading', { name: '没有匹配的作品' })).toBeVisible();
  await page.getByRole('checkbox', { name: '显示子作品（不单独计进度）' }).check();
  await expect(page.getByTestId('work-card')).toHaveCount(1);
  await expect(
    page.getByTestId('work-card').getByRole('button', { name: '聆听', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: '已收录作品中的进度' })).toHaveAttribute(
    'max',
    String(maxBefore + 1),
  );
});

test('离线重载、查询和写入正常，运行时没有第三方请求', async ({ page, context }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4175'))
      external.push(request.url());
  });
  await enterMozart(page);
  await jupiter(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await jupiter(page);
  await page.getByRole('button', { name: /^喜欢作品 / }).click();
  await page.getByRole('button', { name: /^加入待听 / }).click();
  await page.getByRole('button', { name: '聆听', exact: true }).click();
  await expect(page.getByRole('button', { name: '记录日期', exact: true })).toBeVisible();
  await page.reload();
  await jupiter(page);
  await expect(page.getByRole('button', { name: '记录日期', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^取消喜欢作品 /, pressed: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^移出待听 /, pressed: true })).toBeVisible();
  await page.getByRole('link', { name: '我的收藏', exact: true }).click();
  await page.getByRole('link', { name: /^待听清单/ }).click();
  await expect(page.getByTestId('work-card')).toHaveCount(1);
  expect(external).toEqual([]);
});

test('桌面与 320px 窄屏可操作，无横向溢出', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('heading', { name: '莫扎特', level: 3 }).waitFor();
  await page.screenshot({ path: testInfo.outputPath('desktop-home.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole('heading', { name: '莫扎特', level: 3 }).click();
  await jupiter(page);
  await page.getByRole('button', { name: '聆听', exact: true }).click();
  await expect(page.getByTestId('work-card').locator('.latest-listening-date')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-composer.png') });
  await page
    .getByTestId('work-card')
    .screenshot({ path: testInfo.outputPath('latest-listening-mobile.png') });
  await openJupiter(page);
  expect(
    await page.getByRole('dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
  ).toBe(true);
});

test('关闭并重新启动浏览器后，个人档案仍保留', async ({ browserName }, testInfo) => {
  // Two browser lifecycles include a cold 25k-work archive import and profile shutdown.
  test.setTimeout(120000);
  expect(browserName).toBe('chromium');
  const profile = testInfo.outputPath('isolated-browser-profile');
  const options = {
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL === 'chromium' ? undefined : 'msedge',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    baseURL: 'http://127.0.0.1:4175',
  };
  let context = await chromium.launchPersistentContext(profile, options);
  try {
    let page = await context.newPage();
    await enterMozart(page);
    await jupiter(page);
    await page.getByRole('button', { name: '关注 莫扎特', exact: true }).click();
    await page.getByRole('button', { name: /^喜欢作品 / }).click();
    await page.getByRole('button', { name: /^加入待听 / }).click();
    await page.getByRole('button', { name: '聆听', exact: true }).click();
    await expect(page.getByRole('button', { name: '记录日期', exact: true })).toBeVisible();
    await context.close();
    context = await chromium.launchPersistentContext(profile, options);
    page = await context.newPage();
    await enterMozart(page);
    await jupiter(page);
    await expect(page.getByRole('button', { name: '记录日期', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '取消关注 莫扎特', pressed: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^取消喜欢作品 /, pressed: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^移出待听 /, pressed: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
