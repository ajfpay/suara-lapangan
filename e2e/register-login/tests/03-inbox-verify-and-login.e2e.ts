import { test, expect } from '@playwright/test';
import { NEW_ACCOUNT, INBOX_URL, INVALID_TEST_PASSWORD } from '../lib/accounts';
import { resolveDeterministicPassword } from '../lib/credentials';

test('scenario c - public inbox verification and session authentication', async ({ page }) => {
  const passwordHandle = resolveDeterministicPassword();

  console.log(`[scenario c] Navigating to inbox: ${INBOX_URL}`);
  await page.goto(INBOX_URL);

  const currentTitle = await page.title();
  const currentUrl = page.url();
  console.log(`[scenario c] Inbox page title: "${currentTitle}", URL: ${currentUrl}`);

  const isAntibot =
    /Access temporarily limited|Cloudflare|Just a moment|Attention Required|Security Check|Bot Detection/i.test(currentTitle) ||
    (await page.evaluate(() => {
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

    const emailInfo = await page.evaluate(() => {
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
      await page.reload();
      reloadedAt150 = true;
    }

    await new Promise((r) => setTimeout(r, 5000));
  }

  if (!emailFound) {
    console.error('[scenario c] Email delivery timed out after 300 seconds');
    throw new Error('BLOCKED (Email delivery timeout): verification email not received within 300s');
  }

  if (!verificationUrl) {
    verificationUrl = await page.evaluate(() => {
      const link = document.querySelector('a[href*="verify-email"]') as HTMLAnchorElement | null;
      return link ? link.href : null;
    });
  }

  if (!verificationUrl) {
    throw new Error('Verification link could not be parsed from email content');
  }

  console.log(`[scenario c] Navigating to verification link: ${verificationUrl}`);
  await page.goto(verificationUrl);
  await expect(page.getByText(/Email Verified|Verifikasi Berhasil|Sign in|Masuk/i)).toBeVisible();

  console.log('[scenario c] Executing negative login test with wrong password...');
  await page.goto('/en/login');
  await expect(page.getByTestId('input-email')).toBeVisible();

  await page.getByTestId('input-email').fill(NEW_ACCOUNT.email);
  await page.getByTestId('input-password').fill(INVALID_TEST_PASSWORD);
  await page.getByTestId('btn-submit-login').click();

  await expect(page.getByTestId('login-error')).toBeVisible();

  console.log('[scenario c] Executing positive login test with valid credentials...');
  await page.getByTestId('input-password').fill(passwordHandle.getRawPassword());
  await page.getByTestId('btn-submit-login').click();

  await expect(page).toHaveURL(/\/en(\/rekam|\/dokumen|\/?$)/);
});
