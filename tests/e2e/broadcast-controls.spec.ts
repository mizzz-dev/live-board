import { expect, test } from '@playwright/test';

test('配信ショートカット・番号指定・固定を安全に操作できる', async ({ page }) => {
  await page.goto('/');
  const addPage = page.getByRole('button', { name: 'ページを追加' });
  await addPage.click();
  await addPage.click();

  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByText('配信: ページ 2')).toBeVisible();

  await page.keyboard.press('Alt+Digit3');
  await expect(page.getByText('配信: ページ 3')).toBeVisible();

  await page.keyboard.press('Alt+KeyL');
  await expect(page.getByText('固定中', { exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByText('配信: ページ 3')).toBeVisible();
  await expect(page.getByText(/配信ページは固定中/)).toBeVisible();

  await page.keyboard.press('Alt+KeyL');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByText('配信: ページ 1')).toBeVisible();
});

test('CSS入力中は配信ショートカットと競合せず危険CSSを拒否する', async ({ page }) => {
  await page.goto('/');
  const addPage = page.getByRole('button', { name: 'ページを追加' });
  await addPage.click();

  const cssEditor = page.getByRole('textbox', { name: 'Overlay専用カスタムCSS' });
  await cssEditor.fill('@import "https://example.com/theme.css";');
  await cssEditor.press('Alt+ArrowRight');
  await expect(page.getByText('配信: ページ 1')).toBeVisible();

  await page.getByLabel('カスタムCSSを有効化').check();
  await page.getByRole('button', { name: 'CSSを安全性検証して適用' }).click();
  await expect(page.getByText(/カスタムCSSを適用できません/)).toBeVisible();

  await cssEditor.fill('.broadcast-canvas { filter: contrast(1.05); }');
  await page.getByRole('button', { name: 'CSSを安全性検証して適用' }).click();
  await expect(page.getByText('安全性検証後のカスタムCSSを適用しました')).toBeVisible();
});

test('100ページ一覧を作成して画面外サムネイル生成を抑制する', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const addPage = page.getByRole('button', { name: 'ページを追加' });

  for (let index = 1; index < 100; index += 1) {
    await addPage.click();
  }

  const pageRows = page.locator('.page-row');
  await expect(pageRows).toHaveCount(100);
  await expect(page.getByText('編集: ページ 100')).toBeVisible();

  const thumbnails = page.locator('[data-thumbnail-state]');
  await expect(thumbnails).toHaveCount(100);
  const readyCount = await page.locator('[data-thumbnail-state="ready"]').count();
  expect(readyCount).toBeLessThan(100);

  await pageRows.first().scrollIntoViewIfNeeded();
  await expect(pageRows.first()).toBeVisible();
});
