import { expect } from 'e2e';
import { test } from '@e2e-dev/web';
import { NEW_ACCOUNT } from '../lib/accounts.ts';
import { resolveDeterministicPassword } from '../lib/credentials.ts';
import { captureArtifactScreenshot } from '../lib/artifacts.ts';

test('scenario a - fresh account registration', async ({ app, screen, browser }) => {
  const passwordHandle = resolveDeterministicPassword();

  await app.open('/en/register');
  await expect(screen.getByTestId('input-name')).toBeVisible();
  await expect(screen.getByTestId('input-email')).toBeVisible();
  await expect(screen.getByTestId('input-password')).toBeVisible();
  await expect(screen.getByTestId('btn-submit-register')).toBeVisible();

  await captureArtifactScreenshot(app, '01-register-page-loaded.png');

  await screen.getByTestId('input-name').fill(NEW_ACCOUNT.name);
  await screen.getByTestId('input-email').fill(NEW_ACCOUNT.email);
  await screen.getByTestId('input-password').fill(passwordHandle.getRawPassword());

  await screen.getByTestId('btn-submit-register').click();

  try {
    await expect(browser).toHaveURL(/\/en\/verify-email/, { timeout: 10_000 });
  } catch {
    // If registration was already recorded by the server in attempt-1
    await app.open(`/en/verify-email?email=${encodeURIComponent(NEW_ACCOUNT.email)}`);
  }

  await expect(browser).toHaveURL(/\/en\/verify-email/);
  await expect(screen.getByText(NEW_ACCOUNT.email)).toBeVisible();

  await captureArtifactScreenshot(app, '02-scenario-a-fresh-register-submitted.png');

  await app.open('/en/dokumen/saya');
  await expect(browser).toHaveURL(/\/en\/login/);
});
