import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * Continuation E2E: login tests for jackwefirst@gmail.com (owner-registered,
 * owner-verified via real Gmail inbox on 2026-11-07).
 *
 * Owner contract applied:
 * - Password never appears in source/logs; fetched from Akeyless at runtime.
 * - No fallback: if login with valid credentials fails, the test fails hard.
 */

const JACK_EMAIL = 'jackwefirst@gmail.com';

interface JackSecret {
  email: string;
  password: string;
}

function resolveJackCredentials(): JackSecret {
  const secretName = '/suara-lapangan/credentials/jackwefirst-e2e';
  const stdout = execFileSync('akeyless', ['get-secret-value', '-n', secretName, '--json'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(stdout);
  const inner = parsed[secretName] ?? parsed;
  const data = typeof inner === 'string' ? JSON.parse(inner) : inner;
  if (typeof data?.password !== 'string' || data.password.length === 0) {
    throw new Error(`Akeyless secret ${secretName} missing password`);
  }
  return { email: data.email ?? JACK_EMAIL, password: data.password };
}

test('scenario d - jackwefirst login (negative then positive)', async ({ page }) => {
  const creds = resolveJackCredentials();

  await page.goto('/en/login');
  await expect(page.getByTestId('input-email')).toBeVisible();
  await expect(page.getByTestId('input-password')).toBeVisible();

  // Wrong password must be rejected before the positive case runs.
  await page.getByTestId('input-email').fill(creds.email);
  await page.getByTestId('input-password').fill('WrongPassword-for-negative-test-000!');
  await page.getByTestId('btn-submit-login').click();

  await expect(page.getByTestId('login-error')).toBeVisible();

  await page.getByTestId('input-email').fill(creds.email);
  await page.getByTestId('input-password').fill(creds.password);
  await page.getByTestId('btn-submit-login').click();

  // Authenticated: redirected away from /login into the app (e.g. /en, /en/rekam, /en/dokumen)
  await expect(page).not.toHaveURL(/\/en\/login/);
});
