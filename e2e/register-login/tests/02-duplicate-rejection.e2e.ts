import { test, expect } from '@playwright/test';
import { OLD_ACCOUNT } from '../lib/accounts';
import { resolveDeterministicPassword } from '../lib/credentials';

test('scenario b - duplicate registration rejected', async ({ page }) => {
  const passwordHandle = resolveDeterministicPassword();

  await page.goto('/en/register');
  await expect(page.getByTestId('input-email')).toBeVisible();

  await page.getByTestId('input-name').fill(OLD_ACCOUNT.name);
  await page.getByTestId('input-email').fill(OLD_ACCOUNT.email);
  await page.getByTestId('input-password').fill(passwordHandle.getRawPassword());

  await page.getByTestId('btn-submit-register').click();

  const errorElement = page.getByTestId('register-error');
  await expect(errorElement).toBeVisible();
});
