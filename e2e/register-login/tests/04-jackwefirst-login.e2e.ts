import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect } from 'e2e';
import { test } from '@e2e-dev/web';
import { captureArtifactScreenshot } from '../lib/artifacts.ts';

/**
 * Continuation E2E: login tests for jackwefirst@gmail.com (owner-registered,
 * owner-verified via real Gmail inbox on 2026-11-07).
 *
 * Owner contract applied:
 * - Password never appears in source/logs; fetched from Akeyless at runtime.
 * - No fallback: if login with valid credentials fails, the test fails hard.
 */

const JACK_EMAIL = 'jackwefirst@gmail.com';

const STATUS_FILE = path.join(process.cwd(), 'run-status.json');

function recordStatus(payload: Record<string, unknown>) {
  try {
    let existing = {};
    if (fs.existsSync(STATUS_FILE)) {
      existing = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
    }
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...existing, ...payload }, null, 2));
  } catch (err) {
    console.error('Failed to write status file:', err);
  }
}

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

test('scenario d - jackwefirst login (negative then positive)', async ({ app, screen, browser }) => {
  const creds = resolveJackCredentials();

  await app.open('/en/login');
  await expect(screen.getByTestId('input-email')).toBeVisible();
  await expect(screen.getByTestId('input-password')).toBeVisible();
  await captureArtifactScreenshot(app, '08-scenario-d-login-page.png');

  // Wrong password must be rejected before the positive case runs.
  await screen.getByTestId('input-email').fill(creds.email);
  await screen.getByTestId('input-password').fill('WrongPassword-for-negative-test-000!');
  await screen.getByTestId('btn-submit-login').click();

  await expect(screen.getByTestId('login-error')).toBeVisible();
  await captureArtifactScreenshot(app, '09-scenario-d-login-negative-rejected.png');

  await screen.getByTestId('input-email').fill(creds.email);
  await screen.getByTestId('input-password').fill(creds.password);
  await screen.getByTestId('btn-submit-login').click();

  // Authenticated: redirected away from /login into the app (e.g. /en, /en/rekam, /en/dokumen)
  await expect(browser).not.toHaveURL(/\/en\/login/);
  await captureArtifactScreenshot(app, '10-scenario-d-login-positive-authenticated.png');

  recordStatus({
    scenarioD: {
      status: 'PASS',
      account: creds.email,
      observed: 'Wrong-password login rejected with login-error; valid login authenticated and redirected into app.',
      timestamp: new Date().toISOString(),
    },
  });
});
