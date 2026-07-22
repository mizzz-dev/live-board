import { expect, test } from '@playwright/test';

test('Browser PreviewではMain Process依存の保存操作を無効化する', async ({
  page,
}) => {
  await page.goto('/');

  const actions = page.getByLabel('ワークスペース保存操作');
  await expect(
    page.getByRole('heading', { name: '保存・復元' }),
  ).toBeVisible();
  await expect(page.getByText('保存: Browser Preview')).toBeVisible();
  await expect(actions.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await expect(
    actions.getByRole('button', { name: '名前を付けて保存' }),
  ).toBeDisabled();
  await expect(actions.getByRole('button', { name: '開く', exact: true })).toBeDisabled();
  await expect(actions.getByRole('button', { name: 'インポート' })).toBeDisabled();
  await expect(actions.getByRole('button', { name: '複製' })).toBeEnabled();
});

test('ワークスペース複製後もPage・Canvas操作を継続できる', async ({ page }) => {
  await page.goto('/');

  await page
    .getByLabel('ワークスペース保存操作')
    .getByRole('button', { name: '複製' })
    .click();
  await expect(page.getByText(/のコピー/).first()).toBeVisible();
  await expect(page.getByText('保存: 複製済み・未保存')).toBeVisible();
  await expect(page.getByTestId('canvas-surface')).toBeVisible();

  await page.getByRole('button', { name: 'ページを追加' }).click();
  await expect(page.getByRole('button', { name: /ページ 2/ })).toBeVisible();
  await expect(page.getByText('編集: ページ 2')).toBeVisible();
});
