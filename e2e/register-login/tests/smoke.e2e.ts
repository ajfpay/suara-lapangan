import { test, expect } from '@playwright/test';

test('smoke - register screen mounts successfully', async ({ page }) => {
  await page.goto('/en/register');
  await expect(page.getByTestId('input-name')).toBeVisible();
  await expect(page.getByTestId('input-email')).toBeVisible();
  await expect(page.getByTestId('input-password')).toBeVisible();
  await expect(page.getByTestId('btn-submit-register')).toBeVisible();
});
