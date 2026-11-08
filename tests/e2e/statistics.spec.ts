import { expect, test } from '@playwright/test';

test('首页 Hero 紧凑，桌面首屏展示作曲家，移动端不溢出', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  // A fresh, isolated profile imports the full 25k-work catalog before rendering.
  await expect(page.locator('.composer-card').first()).toBeVisible({ timeout: 45000 });
  const layout = await page.evaluate(() => {
    const hero = document.querySelector('.hero')!.getBoundingClientRect();
    const title = document.querySelector('.hero h1')!;
    const card = document.querySelector('.composer-card')!.getBoundingClientRect();
    return {
      heroHeight: hero.height,
      fontSize: parseFloat(getComputedStyle(title).fontSize),
      titleHeight: title.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(title).lineHeight),
      cardBottom: card.bottom,
      scrollY,
    };
  });
  expect(layout.heroHeight).toBeGreaterThanOrEqual(180);
  expect(layout.heroHeight).toBeLessThanOrEqual(240);
  expect(layout.fontSize).toBeGreaterThanOrEqual(36);
  expect(layout.fontSize).toBeLessThanOrEqual(44);
  expect(layout.titleHeight).toBeLessThanOrEqual(layout.lineHeight + 1);
  expect(layout.cardBottom).toBeLessThan(1080);
  expect(layout.scrollY).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('home-desktop.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page
      .locator('.hero h1')
      .evaluate((title) => parseFloat(getComputedStyle(title).fontSize)),
  ).toBeLessThanOrEqual(32);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('home-mobile.png'), fullPage: true });
});

test('统计页使用真实录入数据，跨标签同步日期修改与删除，刷新和移动端正常', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90000);
  await page.goto('/statistics');
  await expect(page.getByRole('heading', { name: '聆听统计', level: 1 })).toBeVisible({
    timeout: 45000,
  });
  await expect(page.getByTestId('statistics-completed')).toHaveText('0 部');
  await expect(page.getByTestId('statistics-coverage')).toHaveText('0%');
  await expect(page.getByText(/NaN|Infinity/)).toHaveCount(0);
  await page.getByRole('link', { name: '浏览作曲家目录，开始记录' }).first().click();
  await expect(page).toHaveURL(/\/composers$/);
  await page.getByRole('heading', { name: '莫扎特', level: 3 }).click();
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('K551');
  await expect(page.getByTestId('work-card')).toHaveCount(1);
  await page.getByRole('button', { name: '听过', exact: true }).click();
  await page.getByRole('button', { name: '记录日期', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('日期精度').selectOption('year');
  await dialog.getByLabel('聆听日期', { exact: true }).fill('1998');
  await dialog.getByRole('button', { name: '添加日期', exact: true }).click();
  await expect(dialog.getByText('1998年', { exact: true })).toBeVisible();
  const stats = await context.newPage();
  await stats.goto('/statistics');
  await expect(stats.getByTestId('statistics-completed')).toHaveText('1 部');
  await expect(stats.getByTestId('statistics-composers')).toHaveText('1 位');
  await expect(stats.getByLabel('1998年：1部')).toBeVisible();
  await expect(stats.locator('.genre-legend')).toContainText('管弦乐');
  await expect(stats.locator('.genre-legend')).toContainText('100%');
  await stats.getByLabel('作曲家统计排序').selectOption('coverage');
  await expect(stats.locator('.composer-bars').getByRole('link', { name: '莫扎特' })).toBeVisible();
  await stats.screenshot({ path: testInfo.outputPath('statistics-desktop.png'), fullPage: true });
  await stats.setViewportSize({ width: 320, height: 740 });
  expect(await stats.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await stats.screenshot({ path: testInfo.outputPath('statistics-mobile.png'), fullPage: true });
  await stats.reload();
  await expect(stats.getByTestId('statistics-completed')).toHaveText('1 部');
  await expect(
    stats
      .getByRole('navigation', { name: '主导航', exact: true })
      .getByRole('link', { name: '聆听统计' }),
  ).toHaveAttribute('aria-current', 'page');
  await dialog.getByRole('button', { name: '编辑 1998年', exact: true }).click();
  await dialog.getByLabel('聆听日期', { exact: true }).fill('2002');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(stats.getByLabel('2002年：1部')).toBeVisible();
  await expect(stats.getByLabel('1998年：1部')).toHaveCount(0);
  page.once('dialog', (confirmation) => confirmation.accept());
  await dialog.getByRole('button', { name: '删除 2002年', exact: true }).click();
  await expect(stats.getByTestId('statistics-unknown')).toContainText('1 部');
  await expect(stats.getByTestId('statistics-completed')).toHaveText('1 部');
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('link', { name: '← 全部作曲家' }).click();
  const entry = page.getByRole('link', { name: '1 部作品已听过，查看聆听统计', exact: true });
  await expect(entry).toBeVisible();
  await entry.hover();
  await expect(entry.locator('.hero-stat-hint')).toHaveCSS('opacity', '1');
  await entry.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/statistics$/);
  await expect(page.getByTestId('statistics-completed')).toHaveText('1 部');
  await page.goBack();
  await expect(page.getByRole('heading', { name: '让每一次聆听，都有迹可循。' })).toBeVisible();
  await stats.locator('.composer-bars').getByRole('link', { name: '莫扎特' }).click();
  await expect(stats.getByRole('heading', { name: '莫扎特', level: 1 })).toBeVisible();
  await stats.goBack();
  await expect(stats).toHaveURL(/\/statistics$/);
  await stats
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: '我的收藏' })
    .click();
  await expect(stats).toHaveURL(/\/favorites$/);
  await stats.goBack();
  await expect(stats.getByTestId('statistics-completed')).toHaveText('1 部');
  await stats.close();
});
