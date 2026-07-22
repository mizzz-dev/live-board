import { expect, test } from '@playwright/test';

test('Editorの初期画面と安全なBrowser Preview状態を表示できる', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Live Board' })).toBeVisible();
  await expect(page.getByText('キャンバス準備完了')).toBeVisible();
  await expect(page.getByText('OBSブリッジ: Browser Preview')).toBeVisible();
  await expect(page.getByText('Browser Preview', { exact: true })).toBeVisible();
  await expect(page.getByText(/token/i)).toHaveCount(0);
});
