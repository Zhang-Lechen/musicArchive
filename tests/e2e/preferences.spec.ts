import { expect, test } from '@playwright/test';

test('收藏清单与目录跨标签同步，筛选搜索及窄屏键盘操作可用', async ({
  page,
  context,
}, testInfo) => {
  await page.goto('/');
  const follow = page.getByRole('button', { name: '关注 莫扎特', exact: true });
  await follow.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '取消关注 莫扎特', pressed: true })).toBeVisible();
  await page.getByRole('button', { name: '喜欢作曲家 莫扎特', exact: true }).click();
  await page.getByLabel('个人标记').selectOption('following');
  await expect(page.locator('.composer-card')).toHaveCount(1);
  await page.getByRole('heading', { name: '莫扎特', level: 3 }).click();
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('K551');
  await expect(page.getByTestId('work-card')).toHaveCount(1);
  await page.getByRole('button', { name: /^喜欢作品 / }).click();
  await page.getByRole('button', { name: /^加入待听 / }).click();
  await expect(page.getByTestId('work-card').getByText('○ 未听过')).toBeVisible();

  const collection = await context.newPage();
  await collection.goto('/collection?section=queue');
  await expect(collection.getByTestId('work-card')).toHaveCount(1);
  await page.getByRole('button', { name: '聆听', exact: true }).click();
  await expect(collection.getByRole('button', { name: '记录日期', exact: true })).toBeVisible();
  await expect(collection.getByRole('button', { name: /^移出待听 /, pressed: true })).toBeVisible();
  for (const term of ['莫扎特', 'KV 551', '朱庇特']) {
    await collection.getByRole('searchbox', { name: '搜索收藏与待听' }).fill(term);
    await expect(collection.getByTestId('work-card')).toHaveCount(1);
  }
  await collection.getByRole('searchbox', { name: '搜索收藏与待听' }).fill('不存在的收藏');
  await expect(collection.getByRole('heading', { name: '没有匹配的收藏或待听项' })).toBeVisible();
  await collection.getByRole('button', { name: '清除清单搜索' }).click();
  await collection.setViewportSize({ width: 320, height: 740 });
  await expect(collection.getByTestId('work-card')).toHaveCount(1);
  expect(
    await collection.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await collection.screenshot({
    path: testInfo.outputPath('mobile-listen-later.png'),
    fullPage: true,
  });
  await collection.getByRole('button', { name: /^移出待听 / }).focus();
  await collection.keyboard.press('Enter');
  await expect(collection.getByRole('heading', { name: '这份清单还没有内容' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^加入待听 /, pressed: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /^取消喜欢作品 /, pressed: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '记录日期', exact: true })).toBeVisible();
  await collection.getByRole('link', { name: /^喜欢的作品/ }).click();
  await expect(collection.getByTestId('work-card')).toHaveCount(1);
  await collection.getByRole('link', { name: /^关注的作曲家/ }).click();
  await collection.getByRole('button', { name: '取消关注 莫扎特', exact: true }).click();
  await expect(page.getByRole('button', { name: '关注 莫扎特', pressed: false })).toBeVisible();
  await collection.getByRole('link', { name: /^喜欢的作曲家/ }).click();
  await expect(collection.getByRole('heading', { name: '莫扎特', level: 3 })).toBeVisible();
  await collection.close();
});
