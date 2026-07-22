import { expect, test } from '@playwright/test';

const safeSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <rect width="640" height="360" rx="24" fill="#336699" />
</svg>`;

test('SVG画像をImage Layerとして追加し同一バイナリを重複保存しない', async ({
  page,
}) => {
  await page.goto('/');
  const fileInput = page.getByLabel('画像ファイルを選択');

  await fileInput.setInputFiles({
    name: 'cover.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(safeSvg),
  });
  await expect(page.getByText('Asset: 1件 /', { exact: false })).toBeVisible();
  await expect(page.locator('.asset-row')).toHaveCount(1);
  await expect(page.locator('.layer-list .layer-row')).toHaveCount(1);
  await expect(page.getByText('cover.svg', { exact: true }).first()).toBeVisible();

  await fileInput.setInputFiles({
    name: 'same-content.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(safeSvg),
  });
  await expect(page.locator('.asset-row')).toHaveCount(1);
  await expect(page.locator('.layer-list .layer-row')).toHaveCount(2);
  await expect(page.getByText('same-content.svg', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Asset: 1件 /', { exact: false })).toBeVisible();
});

test('XXEを含むSVGを拒否する', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('画像ファイルを選択').setInputFiles({
    name: 'unsafe.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 10 10"><text>&xxe;</text></svg>',
    ),
  });
  await expect(page.getByRole('alert')).toContainText(/DOCTYPE|ENTITY/);
  await expect(page.locator('.asset-row')).toHaveCount(0);
});

test('矩形選択を作成し選択Layerを移動・拡大・回転できる', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '図形', exact: true }).click();
  await page.getByRole('button', { name: 'Layerを選択' }).click();
  await expect(page.getByLabel('rectangle選択範囲')).toBeVisible();

  const x = page.getByLabel('X', { exact: true });
  const beforeX = Number(await x.inputValue());
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(x).toHaveValue(String(beforeX + 10));

  await page.getByRole('button', { name: '拡大', exact: true }).last().click();
  await expect(page.getByLabel('拡大X', { exact: true })).not.toHaveValue('1');

  await page.getByRole('button', { name: '右15°', exact: true }).click();
  await expect(page.getByLabel('回転', { exact: true })).toHaveValue('15');
});

test('矩形・楕円・投げ縄をPointer操作で作成できる', async ({ page }) => {
  await page.goto('/');
  const surface = page.getByTestId('canvas-surface');
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * 0.4;
  const startY = box!.y + box!.height * 0.4;
  const endX = box!.x + box!.width * 0.6;
  const endY = box!.y + box!.height * 0.6;

  for (const [button, label] of [
    ['矩形選択', 'rectangle選択範囲'],
    ['楕円選択', 'ellipse選択範囲'],
  ] as const) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByLabel(label)).toBeVisible();
  }

  await page.getByRole('button', { name: '投げ縄選択', exact: true }).click();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (const [xRatio, yRatio] of [
    [0.58, 0.4],
    [0.62, 0.55],
    [0.5, 0.65],
    [0.36, 0.55],
    [0.4, 0.4],
  ]) {
    await page.mouse.move(
      box!.x + box!.width * xRatio,
      box!.y + box!.height * yRatio,
      { steps: 3 },
    );
  }
  await page.mouse.up();
  await expect(page.getByLabel('lasso選択範囲')).toBeVisible();
});
