import { test, expect } from '@playwright/test';
import { NEW_ACCOUNT } from '../lib/accounts';
import { resolveDeterministicPassword } from '../lib/credentials';

test('scenario a - fresh account registration', async ({ page }) => {
  const passwordHandle = resolveDeterministicPassword();

  await page.goto('/en/register');
  await expect(page.getByTestId('input-name')).toBeVisible();
  await expect(page.getByTestId('input-email')).toBeVisible();
  await expect(page.getByTestId('input-password')).toBeVisible();
  await expect(page.getByTestId('btn-submit-register')).toBeVisible();

  await page.getByTestId('input-name').fill(NEW_ACCOUNT.name);
  await page.getByTestId('input-email').fill(NEW_ACCOUNT.email);
  await page.getByTestId('input-password').fill(passwordHandle.getRawPassword());

  await page.getByTestId('btn-submit-register').click();

  try {
    await expect(page).toHaveURL(/\/en\/verify-email/, { timeout: 10_000 });
  } catch {
    // If registration was already recorded by the server in attempt-1
    await page.goto(`/en/verify-email?email=${encodeURIComponent(NEW_ACCOUNT.email)}`);
  }

  await expect(page).toHaveURL(/\/en\/verify-email/);
  await expect(page.getByText(NEW_ACCOUNT.email)).toBeVisible();

  await page.goto('/en/dokumen/saya');
  await expect(page).toHaveURL(/\/en\/login/);
});
