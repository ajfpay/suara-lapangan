import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

test('smoke - register screen mounts successfully', async ({ app, screen }) => {
  await app.open('/en/register');
  await expect(screen.getByTestId('input-name')).toBeVisible();
  await expect(screen.getByTestId('input-email')).toBeVisible();
  await expect(screen.getByTestId('input-password')).toBeVisible();
  await expect(screen.getByTestId('btn-submit-register')).toBeVisible();
});
