import { expect, test } from '@playwright/test';

test('OBS Overlayの接続待機画面を表示できる', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Live Board Overlay' })).toBeVisible();
  await expect(page.getByText('ローカル接続を待機しています')).toBeVisible();
});
