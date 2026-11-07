import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'e2e';
import { test } from '@e2e-dev/web';
import { NEW_ACCOUNT, INBOX_URL, INVALID_TEST_PASSWORD } from '../lib/accounts.ts';
import { resolveDeterministicPassword } from '../lib/credentials.ts';
import { ARTIFACTS_DIR, captureArtifactScreenshot } from '../lib/artifacts.ts';

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

test('scenario c - public inbox verification and session authentication', async ({ app, screen, browser }) => {
  const passwordHandle = resolveDeterministicPassword();

  console.log(`[scenario c] Navigating to inbox: ${INBOX_URL}`);
  await app.open(INBOX_URL);

  const currentTitle = await browser.title();
  const currentUrl = await browser.url();
  console.log(`[scenario c] Inbox page title: "${currentTitle}", URL: ${currentUrl}`);

  const isAntibot =
    /Access temporarily limited|Cloudflare|Just a moment|Attention Required|Security Check|Bot Detection/i.test(currentTitle) ||
    (await browser.evaluate(() => {
      const text = document.body?.innerText || '';
      return (
        text.includes('Access temporarily limited') ||
        text.includes('Too many automated requests') ||
        text.includes('Remove the limit') ||
        Boolean(document.querySelector('link[href*="__ab_"]')) ||
        Boolean(document.querySelector('script[src*="__ab_"]')) ||
        Boolean(document.querySelector('#challenge-stage, .cf-turnstile, #cf-wrapper'))
      );
    }));

  if (isAntibot) {
    console.warn(`[scenario c] Anti-bot challenge detected at ${INBOX_URL}! Title: "${currentTitle}"`);
    const shotPath = await captureArtifactScreenshot(app, 'antibot-challenge.png');
    recordStatus({
      scenarioC: {
        status: 'BLOCKED',
        reason: 'Anti-bot detected',
        url: currentUrl,
        title: currentTitle,
        screenshot: shotPath,
        timestamp: new Date().toISOString(),
      },
      stopRuleFired: 'anti-bot',
    });

    throw new Error(`BLOCKED (Anti-bot detected): generator.email challenge page presented ("${currentTitle}")`);
  }

  // Poll up to 300 s; one reload at 150 s because the generator.email UI caches.
  console.log('[scenario c] Polling inbox for verification email...');
  const pollStart = Date.now();
  let emailFound = false;
  let reloadedAt150 = false;
  let verificationUrl: string | null = null;

  while (Date.now() - pollStart < 300_000) {
    const elapsed = (Date.now() - pollStart) / 1000;

    const emailInfo = await browser.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.mess_list a, #email_list a, a[href*="inbox"]'));
      for (const row of rows) {
        if (/Suara Lapangan|Verifikasi Email/i.test(row.textContent || '')) {
          return { found: true, href: (row as HTMLAnchorElement).href };
        }
      }
      const bodyText = document.body?.innerText || '';
      if (/Verifikasi Email|Silakan klik tautan berikut/i.test(bodyText)) {
        const link = document.querySelector('a[href*="/api/auth/verify-email"], a[href*="/verify-email"]');
        return { found: true, href: (link as HTMLAnchorElement)?.href || null };
      }
      return { found: false, href: null };
    });

    if (emailInfo.found) {
      emailFound = true;
      console.log(`[scenario c] Verification email located after ${elapsed.toFixed(1)}s`);
      if (emailInfo.href && !emailInfo.href.includes('generator.email')) {
        verificationUrl = emailInfo.href;
      }
      break;
    }

    if (elapsed >= 150 && !reloadedAt150) {
      console.log('[scenario c] 150s elapsed: performing scheduled page reload...');
      await browser.reload();
      reloadedAt150 = true;
    }

    await new Promise((r) => setTimeout(r, 5000));
  }

  if (!emailFound) {
    console.error('[scenario c] Email delivery timed out after 300 seconds');
    recordStatus({
      scenarioC: {
        status: 'BLOCKED',
        reason: 'Email delivery timeout',
        timestamp: new Date().toISOString(),
      },
      stopRuleFired: 'email-delivery-timeout',
    });
    throw new Error('BLOCKED (Email delivery timeout): verification email not received within 300s');
  }

  await captureArtifactScreenshot(app, '04-scenario-c-inbox-email-received.png');

  if (!verificationUrl) {
    verificationUrl = await browser.evaluate(() => {
      const link = document.querySelector('a[href*="verify-email"]') as HTMLAnchorElement | null;
      return link ? link.href : null;
    });
  }

  if (!verificationUrl) {
    throw new Error('Verification link could not be parsed from email content');
  }

  console.log(`[scenario c] Navigating to verification link: ${verificationUrl}`);
  await app.open(verificationUrl);
  await expect(screen.getByText(/Email Verified|Verifikasi Berhasil|Sign in|Masuk/i)).toBeVisible();

  await captureArtifactScreenshot(app, '05-scenario-c-verification-confirmed.png');

  console.log('[scenario c] Executing negative login test with wrong password...');
  await app.open('/en/login');
  await expect(screen.getByTestId('input-email')).toBeVisible();

  await screen.getByTestId('input-email').fill(NEW_ACCOUNT.email);
  await screen.getByTestId('input-password').fill(INVALID_TEST_PASSWORD);
  await screen.getByTestId('btn-submit-login').click();

  await expect(screen.getByTestId('login-error')).toBeVisible();
  await captureArtifactScreenshot(app, '06-login-negative-rejected.png');

  console.log('[scenario c] Executing positive login test with valid credentials...');
  await screen.getByTestId('input-password').fill(passwordHandle.getRawPassword());
  await screen.getByTestId('btn-submit-login').click();

  await expect(browser).toHaveURL(/\/en(\/rekam|\/dokumen|\/?$)/);
  await captureArtifactScreenshot(app, '07-login-positive-authenticated.png');

  recordStatus({
    scenarioC: {
      status: 'PASS',
      timestamp: new Date().toISOString(),
    },
  });
});
