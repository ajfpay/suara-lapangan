import { expect } from 'e2e';
import { test } from '@e2e-dev/web';
import { OLD_ACCOUNT } from '../lib/accounts.ts';
import { resolveDeterministicPassword } from '../lib/credentials.ts';
import { captureArtifactScreenshot } from '../lib/artifacts.ts';

test('scenario b - duplicate registration rejected', async ({ app, screen }) => {
  const passwordHandle = resolveDeterministicPassword();

  await app.open('/en/register');
  await expect(screen.getByTestId('input-email')).toBeVisible();

  await screen.getByTestId('input-name').fill(OLD_ACCOUNT.name);
  await screen.getByTestId('input-email').fill(OLD_ACCOUNT.email);
  await screen.getByTestId('input-password').fill(passwordHandle.getRawPassword());

  await screen.getByTestId('btn-submit-register').click();

  const errorElement = screen.getByTestId('register-error');
  await expect(errorElement).toBeVisible();

  await captureArtifactScreenshot(app, '03-scenario-b-duplicate-rejected.png');
});
