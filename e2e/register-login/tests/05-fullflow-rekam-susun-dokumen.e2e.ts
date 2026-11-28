import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { test, expect, Page } from '@playwright/test';

/**
 * Full-flow E2E: rekam (fake mic carrying a real 16 kHz WAV fixture through
 * the app's own record -> decode -> toWav16k -> RecordQueue -> /api/asr/transcribe
 * path) -> susun (turn review + create document) -> resolve butuh_konfirmasi
 * via the UI PATCH -> edit a draft field -> approve -> download PDF -> send
 * via email.
 *
 * Owner decisions (2026-11-07):
 * - Fixture #2 (2115804149220868510.wav, harga-pasar topic) drives the flow:
 *   its real transcript yields a real item (uraian "daerah kurang tujuh
 *   meter", volume 7, harga_satuan 0 flagged by the guard) - no placeholders.
 * - Stop rules: ASR failure or any step failure stops the test (no fallback).
 * - No commit/push; evidence report only.
 */

const FIXTURE_WAV = '/home/ubuntu/repos/suara-lapangan-asr-samples/audio/2115804149220868510.wav';
const JACK_EMAIL = 'jackwefirst@gmail.com';

function resolveJackCredentials(): { email: string; password: string } {
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

// Press-and-hold helper matching the app's 300 ms min-press timer: hold the
// record button for at least 600 ms so the timer fires, then release.
async function longPress(page: Page, buttonLocator: Parameters<Page['getByTestId']>[0], durationMs = 600) {
  const el = page.getByTestId(buttonLocator);
  const box = await el.boundingBox();
  if (!box) throw new Error(`record button ${buttonLocator} has no bounding box`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(durationMs);
  await page.mouse.up();
}

test('scenario e - full flow rekam -> susun -> edit -> approve -> pdf -> email', async ({ page, context }) => {
  test.setTimeout(480_000);
  const creds = resolveJackCredentials();
  const wavB64 = fs.readFileSync(FIXTURE_WAV).toString('base64');

  await page.goto('/en/login');
  await expect(page.getByTestId('input-email')).toBeVisible();
  await page.getByTestId('input-email').fill(creds.email);
  await page.getByTestId('input-password').fill(creds.password);
  await page.getByTestId('btn-submit-login').click();
  await expect(page).not.toHaveURL(/\/en\/login/, { timeout: 30_000 });

  const cookies = await context.cookies();
  expect(cookies.some((c) => c.name.startsWith('better-auth'))).toBe(true);

  // Inject a fake mic before opening /rekam. getUserMedia returns a live-ish
  // stream and MediaRecorder emits the real fixture WAV bytes exactly once on
  // stop, so the app's own decode, toWav16k, RecordQueue, and upload path stay
  // untouched and the request to /api/asr/transcribe is real.
  await page.addInitScript(`
    (function () {
      if (window.__fakeMicInstalled) return;
      window.__fakeMicInstalled = true;
      const wavBytes = Uint8Array.from(atob(${JSON.stringify(wavB64)}), (c) => c.charCodeAt(0));
      window.__fixtureWavBytes = wavBytes;

      class FakeMediaRecorder {
        constructor() {
          this.chunks = [];
          this.state = 'inactive';
          this.mimeType = 'audio/wav';
          this.ondataavailable = null;
          this.onstop = null;
          this.onerror = null;
          this.__emitted = false;
        }
        start() {
          this.state = 'recording';
        }
        stop() {
          if (this.state === 'inactive') return;
          this.state = 'inactive';
          if (!this.__emitted && this.ondataavailable) {
            this.__emitted = true;
            this.ondataavailable({ data: new Blob([wavBytes], { type: 'audio/wav' }) });
          }
          setTimeout(() => this.onstop && this.onstop(), 50);
        }
      }
      window.MediaRecorder = FakeMediaRecorder;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();
      const osc = audioCtx.createOscillator();
      osc.frequency.value = 220;
      const gain = audioCtx.createGain();
      gain.gain.value = 0.05;
      osc.connect(gain).connect(dest);
      osc.start();
      window.__fakeStream = dest.stream;

      navigator.mediaDevices.getUserMedia = async () => window.__fakeStream;
    })();
  `);

  await page.goto('/en/rekam');
  await expect(page.getByTestId('record-button')).toBeVisible();

  const transcribeP = page.waitForResponse(/\/api\/asr\/transcribe/, { timeout: 180_000 });
  // Press-and-hold: pointerdown starts the 300 ms press timer, which toggles
  // recording on. 600 ms leaves the timer enough time to fire.
  await longPress(page, 'record-button', 600);
  await expect(page.getByTestId('record-duration')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1000);
  // Hold again to stop; the app then decodes, converts to 16 kHz WAV and
  // uploads through its own queue.
  await longPress(page, 'record-button', 600);

  const transcribeRes = await transcribeP;
  if (transcribeRes.status() !== 200) {
    const body = await transcribeRes.text();
    throw new Error(`STOP RULE: ASR upload failed with HTTP ${transcribeRes.status()}: ${body.slice(0, 500)}`);
  }

  // Wait for the recorder to return to idle (processing finished, badge clear).
  await expect
    .poll(async () => {
      const pending = await page.evaluate(() => {
        const badge = document.querySelector('[data-testid="pending-upload-badge"]');
        return badge ? (badge.textContent ?? '').trim() : null;
      });
      return pending;
    }, { timeout: 60_000 })
    .toBeNull();

  await page.goto('/en/susun');
  // App numbers turns from 1: first turn renders as data-testid="turn-card-1"
  await expect(page.getByTestId('turn-card-1')).toBeVisible({ timeout: 60_000 });

  const sessionId = await page.evaluate((): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      const req = indexedDB.open('suara-lapangan');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('recordings')) { db.close(); return resolve(null); }
        const tx = db.transaction('recordings', 'readonly');
        const getAll = tx.objectStore('recordings').getAll();
        getAll.onsuccess = () => {
          const rows = (getAll.result || []) as { sessionId: string; createdAt: number }[];
          db.close();
          if (rows.length === 0) return resolve(null);
          rows.sort((a, b) => b.createdAt - a.createdAt);
          resolve(rows[0].sessionId);
        };
        getAll.onerror = () => { db.close(); resolve(null); };
      };
      req.onerror = () => resolve(null);
    });
  });
  if (!sessionId) throw new Error('STOP RULE: no local recording session found after rekam');

  await page.getByTestId('btn-buat-dokumen').click();
  await expect(page.getByTestId('document-status')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('document-status')).toHaveText('draf');

  const konfirmasiFields = await page.evaluate((): string[] =>
    Array.from(document.querySelectorAll('[data-testid^="konfirmasi-"]'))
      .map((el) => el.getAttribute('data-testid') ?? '')
      .filter((t) => t && t !== 'konfirmasi-panel')
      .map((t) => t.replace(/^konfirmasi-/, ''))
  );
  if (konfirmasiFields.length === 0) {
    throw new Error('STOP RULE: expected at least one butuh_konfirmasi item (harga_satuan 0 from fixture 2)');
  }

  // Resolve every pending confirmation through the card's own manual input.
  for (let round = 0; round < 5; round++) {
    const fields = await page.evaluate((): string[] =>
      Array.from(document.querySelectorAll('[data-testid^="konfirmasi-"]'))
        .map((el) => el.getAttribute('data-testid') ?? '')
        .filter((t) => t && t !== 'konfirmasi-panel')
        .map((t) => t.replace(/^konfirmasi-/, ''))
    );
    if (fields.length === 0) break;
    const field = fields[0];
    const card = page.getByTestId(`konfirmasi-${field}`);
    await expect(card).toBeVisible();
    const value = field.includes('harga_satuan') ? '150000' : field.includes('volume') ? '7' : '1';
    await card.getByLabel(/Manual correction|Koreksi manual/).fill(value);
    await card.getByRole('button', { name: /Save|Simpan/ }).click();
    await expect(page.getByTestId(`konfirmasi-${field}`)).toBeHidden({ timeout: 20_000 });
  }

  const docId = await page.evaluate((): string | null => {
    const link = document.querySelector('[data-testid="link-lihat-dokumen"]');
    const href = link?.getAttribute('href');
    if (!href) return null;
    return new URL(href, window.location.origin).searchParams.get('doc');
  });
  if (!docId) throw new Error('STOP RULE: could not read docId from link-lihat-dokumen');

  const patchRes = await page.evaluate(async (id: string) => {
    const res = await fetch(`/api/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        field: 'pekerjaan[0].uraian',
        nilai: 'Pekerjaan pasang pipa daerah kurang tujuh meter',
      }),
    });
    return { status: res.status, body: await res.text() };
  }, docId);
  if (patchRes.status !== 200) {
    throw new Error(`STOP RULE: draft edit PATCH failed HTTP ${patchRes.status}: ${patchRes.body.slice(0, 300)}`);
  }

  const setujui = page.getByTestId('btn-setujui');
  await expect(setujui).toBeEnabled({ timeout: 20_000 });
  await setujui.click();
  await expect(page.getByTestId('document-status')).toHaveText('disetujui', { timeout: 60_000 });
  const nomor = (await page.getByTestId('document-nomor').textContent())?.trim() ?? '';
  if (!nomor) throw new Error('STOP RULE: approved but document number is empty');

  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByTestId('btn-unduh').click();
  const download = await downloadPromise;
  const pdfPath = await download.path();
  if (!pdfPath) throw new Error('STOP RULE: download produced no local file');
  const pdfBytes = fs.readFileSync(pdfPath);
  if (pdfBytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error(`Downloaded file is not a PDF (starts with ${pdfBytes.subarray(0, 10).toString('hex')})`);
  }

  await page.goto(`/en/dokumen?doc=${encodeURIComponent(docId)}`);
  await expect(page.getByTestId('document-nomor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pdf-frame')).toBeVisible({ timeout: 90_000 });

  const emailP = page.waitForResponse(/\/api\/documents\/[0-9a-f-]+\/email/, { timeout: 120_000 });
  await page.getByTestId('input-recipient').fill(JACK_EMAIL);
  await page.getByTestId('btn-kirim').click();
  const emailRes = await emailP;
  if (emailRes.status() !== 200) {
    const body = await emailRes.text();
    throw new Error(`STOP RULE: email send failed HTTP ${emailRes.status()}: ${body.slice(0, 500)}`);
  }
  await expect(page.getByTestId('send-success-message')).toBeVisible({ timeout: 30_000 });
});
