import { expect, test } from '@playwright/test';

test('1920x1080・10 Raster Layerの描画時間を計測できる', async ({
  page,
}) => {
  await page.goto('/');

  const addRaster = page.getByRole('button', {
    name: 'ラスター',
    exact: true,
  });
  for (let index = 0; index < 10; index += 1) {
    await addRaster.click();
  }

  await expect(page.getByText('10件', { exact: true })).toBeVisible();
  const metric = page.locator('.statusbar').getByText(/描画: [0-9.]+ms/);
  await expect(metric).toBeVisible();
  const text = await metric.textContent();
  const match = /描画: ([0-9.]+)ms/.exec(text ?? '');
  expect(match).not.toBeNull();
  const durationMs = Number(match![1]);
  expect(Number.isFinite(durationMs)).toBe(true);
  expect(durationMs).toBeLessThan(250);
});
