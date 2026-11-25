import { test, expect } from '@playwright/test';

test('云同步未配置时保持明确状态，并保留窄屏备份入口', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await page.getByRole('button', { name: '数据与备份' }).click();
  const panel = page.getByRole('region', { name: '云同步' });
  await expect(panel).toContainText('未配置');
  await expect(panel).not.toContainText('同步成功');
  await expect(page.getByRole('button', { name: '导出 JSON 备份' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: 'test-results/cloud-sync-unconfigured-mobile.png',
    fullPage: true,
  });
});
