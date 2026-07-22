import { expect, test } from '@playwright/test';

test('EditorのCanvasと安全なBrowser Preview状態を表示できる', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Live Board' })).toBeVisible();
  await expect(page.getByTestId('canvas-surface')).toBeVisible();
  await expect(page.getByLabel('ページ 1の描画キャンバス')).toBeVisible();
  await expect(page.getByText('OBSブリッジ: Browser Preview')).toBeVisible();
  await expect(page.getByText('Browser Preview', { exact: true })).toBeVisible();
  await expect(page.getByText(/token/i)).toHaveCount(0);
});

test('ページ追加をPage履歴でUndo・Redoできる', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'ページを追加' }).click();
  await expect(page.getByRole('button', { name: /ページ 2/ })).toBeVisible();
  await expect(page.getByText('編集: ページ 2')).toBeVisible();
  await expect(page.getByText('配信: ページ 1')).toBeVisible();

  await page.getByRole('button', { name: 'Pageを元に戻す' }).click();
  await expect(page.getByRole('button', { name: /ページ 2/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Pageをやり直す' }).click();
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

test('Layer追加・表示切り替え・Undo・RedoをPage内で実行できる', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'ラスター', exact: true }).click();
  await expect(page.getByText('ラスター 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Layer履歴 1 / Redo 0')).toBeVisible();

  await page
    .getByRole('button', { name: 'ラスター 1の表示を切り替え' })
    .click();
  await expect(page.getByText('Layer履歴 2 / Redo 0')).toBeVisible();

  await page.getByRole('button', { name: 'Layerを元に戻す' }).click();
  await expect(page.getByText('Layer履歴 1 / Redo 1')).toBeVisible();

  await page.getByRole('button', { name: 'Layerをやり直す' }).click();
  await expect(page.getByText('Layer履歴 2 / Redo 0')).toBeVisible();

  await page.getByLabel('合成モード').selectOption('multiply');
  await expect(page.getByLabel('合成モード')).toHaveValue('multiply');
  await expect(page.getByText('Layer履歴 3 / Redo 0')).toBeVisible();
});

test('Pointer描画をCanvas履歴でUndo・Redoできる', async ({ page }) => {
  await page.goto('/');

  const surface = page.getByTestId('canvas-surface');
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * 0.45;
  const startY = box!.y + box!.height * 0.45;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY + 40, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByText('描画 1', { exact: true })).toBeVisible();
  await expect(page.getByText('描画履歴: 1 / Redo 0')).toBeVisible();

  await page.getByRole('button', { name: '描画を元に戻す' }).click();
  await expect(page.getByText('描画履歴: 0 / Redo 1')).toBeVisible();

  await page.getByRole('button', { name: '描画をやり直す' }).click();
  await expect(page.getByText('描画履歴: 1 / Redo 0')).toBeVisible();
});

test('ズーム・回転・左右反転を操作できる', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: '拡大' }).click();
  await expect(page.getByText('ズーム 125%')).toBeVisible();
  await page.getByRole('button', { name: '右回転' }).click();
  await page.getByRole('button', { name: '左右反転' }).click();
  await expect(page.getByRole('button', { name: '左右反転' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: '表示リセット' }).click();
  await expect(page.getByText('ズーム 100%')).toBeVisible();
});
