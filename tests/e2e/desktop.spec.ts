import { expect, test } from '@playwright/test';

test('Editorの初期画面を表示できる', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Live Board' })).toBeVisible();
  await expect(page.getByText('キャンバス準備完了')).toBeVisible();
  await expect(page.getByText('OBS: 未接続')).toBeVisible();
});
