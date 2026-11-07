import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect } from 'e2e';
import { test } from '@e2e-dev/web';
import { captureArtifactScreenshot } from '../lib/artifacts.ts';

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

const STATUS_FILE = path.join(process.cwd(), 'run-status.json');
const FIXTURE_WAV = '/home/ubuntu/repos/suara-lapangan-asr-samples/audio/2115804149220868510.wav';
const JACK_EMAIL = 'jackwefirst@gmail.com';

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

test('scenario e - full flow rekam -> susun -> edit -> approve -> pdf -> email', { timeout: 480_000 }, async ({ app, screen, browser }) => {
  const creds = resolveJackCredentials();
  const wavB64 = fs.readFileSync(FIXTURE_WAV).toString('base64');

  await app.open('/en/login');
  await expect(screen.getByTestId('input-email')).toBeVisible();
  await screen.getByTestId('input-email').fill(creds.email);
  await screen.getByTestId('input-password').fill(creds.password);
  await screen.getByTestId('btn-submit-login').click();
  await expect(browser).not.toHaveURL(/\/en\/login/, { timeout: 30_000 });
  await captureArtifactScreenshot(app, '11-scenario-e-logged-in.png');

  const cookies = await browser.cookies();
  expect(cookies.some((c) => c.name.startsWith('better-auth'))).toBe(true);

  // Inject a fake mic before opening /rekam. getUserMedia returns a live-ish
  // stream and MediaRecorder emits the real fixture WAV bytes exactly once on
  // stop, so the app's own decode, toWav16k, RecordQueue, and upload path stay
  // untouched and the request to /api/asr/transcribe is real.
  await browser.addInitScript(`
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
          // Real recorders emit chunks during recording; the app only reads
          // chunks at stop, so emit nothing here and exactly once at stop.
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

  await app.open('/en/rekam');
  await expect(screen.getByTestId('record-button')).toBeVisible();
  await captureArtifactScreenshot(app, '12-scenario-e-rekam-page.png');

  const transcribeP = browser.waitForResponse(/\/api\/asr\/transcribe/, { timeout: 180_000 });
  // Press-and-hold: pointerdown starts the 300 ms press timer, which toggles
  // recording on. longPress(600) leaves the timer enough time to fire.
  await screen.getByTestId('record-button').longPress({ duration: 600 });
  await expect(screen.getByTestId('record-duration')).toBeVisible({ timeout: 15_000 });
  await captureArtifactScreenshot(app, '13-scenario-e-recording.png');
  await new Promise((r) => setTimeout(r, 1000));
  // Hold again to stop; the app then decodes, converts to 16 kHz WAV and
  // uploads through its own queue.
  await screen.getByTestId('record-button').longPress({ duration: 600 });

  const transcribeRes = await transcribeP;
  if (transcribeRes.status !== 200) {
    const body = await transcribeRes.text();
    throw new Error(`STOP RULE: ASR upload failed with HTTP ${transcribeRes.status}: ${body.slice(0, 500)}`);
  }
  recordStatus({ scenarioE: { asr_upload: { status: transcribeRes.status } } });

  // Wait for the recorder to return to idle (processing finished, badge clear).
  await expect
    .poll(async () => {
      const pending = await browser.evaluate(() => {
        const badge = document.querySelector('[data-testid="pending-upload-badge"]');
        return badge ? (badge.textContent ?? '').trim() : null;
      });
      return pending;
    }, { timeout: 60_000 })
    .toBeNull();
  await captureArtifactScreenshot(app, '14-scenario-e-rekam-uploaded.png');

  await app.open('/en/susun');
  // App numbers turns from 1: first turn renders as data-testid="turn-card-1"
  await expect(screen.getByTestId('turn-card-1')).toBeVisible({ timeout: 60_000 });
  await captureArtifactScreenshot(app, '15-scenario-e-susun-turns.png');

  const sessionId = await browser.evaluate((): string | null => {
    return new Promise((resolve) => {
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
  recordStatus({ scenarioE: { session_id: sessionId } });

  await screen.getByTestId('btn-buat-dokumen').click();
  await expect(screen.getByTestId('document-status')).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByTestId('document-status')).toHaveText('draf');
  await captureArtifactScreenshot(app, '16-scenario-e-doc-created.png');

  const konfirmasiFields = await browser.evaluate((): string[] =>
    Array.from(document.querySelectorAll('[data-testid^="konfirmasi-"]'))
      .map((el) => el.getAttribute('data-testid') ?? '')
      .filter((t) => t && t !== 'konfirmasi-panel')
      .map((t) => t.replace(/^konfirmasi-/, ''))
  );
  if (konfirmasiFields.length === 0) {
    throw new Error('STOP RULE: expected at least one butuh_konfirmasi item (harga_satuan 0 from fixture 2)');
  }
  recordStatus({ scenarioE: { konfirmasi_fields: konfirmasiFields } });

  // Resolve every pending confirmation through the card's own manual input.
  for (let round = 0; round < 5; round++) {
    const fields = await browser.evaluate((): string[] =>
      Array.from(document.querySelectorAll('[data-testid^="konfirmasi-"]'))
        .map((el) => el.getAttribute('data-testid') ?? '')
        .filter((t) => t && t !== 'konfirmasi-panel')
        .map((t) => t.replace(/^konfirmasi-/, ''))
    );
    if (fields.length === 0) break;
    const field = fields[0];
    const card = screen.getByTestId(`konfirmasi-${field}`);
    await expect(card).toBeVisible();
    const value = field.includes('harga_satuan') ? '150000' : field.includes('volume') ? '7' : '1';
    await card.getByLabel(/Manual correction|Koreksi manual/).fill(value);
    await card.getByRole('button', { name: /Save|Simpan/ }).click();
    await expect(screen.getByTestId(`konfirmasi-${field}`)).toBeHidden({ timeout: 20_000 });
  }
  await captureArtifactScreenshot(app, '17-scenario-e-konfirmasi-resolved.png');

  const docId = await browser.evaluate((): string | null => {
    const link = document.querySelector('[data-testid="link-lihat-dokumen"]');
    const href = link?.getAttribute('href');
    if (!href) return null;
    return new URL(href, window.location.origin).searchParams.get('doc');
  });
  if (!docId) throw new Error('STOP RULE: could not read docId from link-lihat-dokumen');
  recordStatus({ scenarioE: { doc_id: docId } });

  const patchRes = await browser.evaluate(async (id: string) => {
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
  await captureArtifactScreenshot(app, '18-scenario-e-edit-patched.png');

  const setujui = screen.getByTestId('btn-setujui');
  await expect(setujui).toBeEnabled({ timeout: 20_000 });
  await setujui.click();
  await expect(screen.getByTestId('document-status')).toHaveText('disetujui', { timeout: 60_000 });
  const nomor = (await screen.getByTestId('document-nomor').textContent())?.trim() ?? '';
  if (!nomor) throw new Error('STOP RULE: approved but document number is empty');
  await captureArtifactScreenshot(app, '19-scenario-e-approved.png');

  const download = await browser.waitForDownload(async () => {
    await screen.getByTestId('btn-unduh').click();
  }, { timeout: 90_000 });
  const pdfBytes = fs.readFileSync(download.absolutePath);
  if (pdfBytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error(`Downloaded file is not a PDF (starts with ${pdfBytes.subarray(0, 10).toString('hex')})`);
  }
  recordStatus({ scenarioE: { document_number: nomor, pdf_file: download.suggestedFilename, pdf_bytes: pdfBytes.length } });
  await captureArtifactScreenshot(app, '20-scenario-e-pdf-downloaded.png');

  await app.open(`/en/dokumen?doc=${encodeURIComponent(docId)}`);
  await expect(screen.getByTestId('document-nomor')).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByTestId('pdf-frame')).toBeVisible({ timeout: 90_000 });
  await captureArtifactScreenshot(app, '21-scenario-e-dokumen-view-pdf.png');

  const emailP = browser.waitForResponse(/\/api\/documents\/[0-9a-f-]+\/email/, { timeout: 120_000 });
  await screen.getByTestId('input-recipient').fill(JACK_EMAIL);
  await screen.getByTestId('btn-kirim').click();
  const emailRes = await emailP;
  if (emailRes.status !== 200) {
    const body = await emailRes.text();
    throw new Error(`STOP RULE: email send failed HTTP ${emailRes.status}: ${body.slice(0, 500)}`);
  }
  await expect(screen.getByTestId('send-success-message')).toBeVisible({ timeout: 30_000 });
  await captureArtifactScreenshot(app, '22-scenario-e-email-sent.png');

  recordStatus({
    scenarioE: {
      finished_at: new Date().toISOString(),
      status: 'PASS',
      document_id: docId,
      document_number: nomor,
      session_id: sessionId,
    },
  });
});
