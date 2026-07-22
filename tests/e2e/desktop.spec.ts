import { expect, test } from '@playwright/test';

test('Editorの初期画面と安全なBrowser Preview状態を表示できる', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Live Board' })).toBeVisible();
  await expect(page.getByText(/キャンバス準備完了/)).toBeVisible();
  await expect(page.getByText('OBSブリッジ: Browser Preview')).toBeVisible();
  await expect(page.getByText('Browser Preview', { exact: true })).toBeVisible();
  await expect(page.getByText(/token/i)).toHaveCount(0);
});

test('ページ追加をUndo・Redoできる', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'ページを追加' }).click();
  await expect(page.getByRole('button', { name: /ページ 2/ })).toBeVisible();
  await expect(page.getByText('編集: ページ 2')).toBeVisible();
  await expect(page.getByText('配信: ページ 1')).toBeVisible();

  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(page.getByRole('button', { name: /ページ 2/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'やり直す' }).click();
  await expect(page.getByRole('button', { name: /ページ 2/ })).toBeVisible();
});

test('編集ページと配信ページを別々に切り替えられる', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'ページを追加' }).click();
  await expect(page.getByText('編集: ページ 2')).toBeVisible();
  await expect(page.getByText('配信: ページ 1')).toBeVisible();

  await page.getByRole('button', { name: '配信ページに設定' }).click();
  await expect(page.getByText('配信: ページ 2')).toBeVisible();
});
