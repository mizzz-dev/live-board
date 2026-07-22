import { expect, test } from '@playwright/test';

test('OBS OverlayのBrowser Previewを表示できる', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Live Board Overlay' })).toBeVisible();
  await expect(page.getByText('Browser Preview')).toBeVisible();
});
