/* ============================================================
   Suara Lapangan — prototipe
   Semua data lokal. Tidak ada jaringan, tidak ada model.
   ============================================================ */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const BASE_PRICE = 2400000;
const DOC_NUMBER = '014/SP/CV-SJ/X/2026';
const DOC_DATE = '28 Oktober 2026';

const TURNS = [
  {
    id: 1,
    label: 'Giliran 1',
    tokens: [
      'Assalamualaikum', 'Bu', 'Retno', 'Wulandari.',
      { t: 'Niki', flag: 'jv' }, 'eh,', 'saya', 'Slamet,',
      'yang', 'renovasi', 'rumah', 'Jalan', 'Kaliurang', 'KM', 'enam,',
      'nomor', 'tujuh', 'belas,', 'Sleman.',
      'Ruang', 'tamunya', 'saya', 'plester', 'dulu', 'ya,',
      'dinding', 'ruang', 'tamu.', 'Dua', 'puluh', 'empat', 'meter', 'persegi.'
    ]
  },
  {
    id: 2,
    label: 'Giliran 2',
    tokens: [
      'Bahannya,', 'e...', 'semen', 'dua', 'belas', 'sak,', 'terus',
      'besi', 'sepuluh', 'mili', 'seratus', 'batang.',
      'Ongkosnya', 'borongan,', 'plester', 'sama', 'bahan,',
      'dua', 'juta', 'empat', 'ratus', 'ribu.'
    ]
  },
  {
    id: 3,
    label: 'Giliran 3',
    tokens: [
      'Terus', 'Bu', 'Retno', 'minta', 'tambah', 'titik', 'lampu,',
      'lima', 'titik.', 'Tadi', 'sudah', 'setuju,', 'harganya',
      'delapan', { t: 'ratus', flag: 'num' }, 'ribu.',
      'Tukangnya', 'empat', 'orang,', 'sekitar—', 'tiga', 'hari', 'lah.'
    ]
  },
  {
    id: 4,
    label: 'Giliran 4',
    tokens: [
      'Catnya', 'belum', 'masuk', 'penawaran,', 'nanti', 'saya', 'kabari.',
      'DP-nya', 'lima', 'puluh', 'persen', 'ya,', 'sisanya', 'setelah', 'selesai.',
      'Ya', 'sudah,', 'segitu', 'dulu.'
    ]
  }
];

const SOURCE_USES = {
  1: ['Nama & alamat', 'Uraian pekerjaan', 'Volume 24 m²'],
  2: ['Harga plester', 'Bahan'],
  3: ['Titik lampu', 'Harga titik lampu', 'Waktu pelaksanaan'],
  4: ['Pembayaran', 'Catatan pengecatan']
};

const state = {
  step: 1,
  phase: 'idle',          // idle | recording | review
  priceChoice: null,      // null | 'ratus' | 'puluh'
  sent: false,
  seconds: 0
};

let streamRun = 0;
let timerId = 0;
let buildTimers = [];
let waveRAF = 0;
let waveBars = [];
let sheetOpen = false;
let lastFocus = null;
let sheetSeq = 0;
let confirmFromCompose = false;

const screen = document.getElementById('screen');
const overlay = document.getElementById('overlay');

/* ============================================================
   Ikon
   ============================================================ */

const ICONS = {
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="M8.5 21h7"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.2" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13"/><path d="M13 6l6 6-6 6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4 18-7z"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.5h8l4 4V21H6z"/><path d="M14 2.5V7h4"/><path d="M9 12h6M9 15h6M9 18h3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
};

const SIG_SVG = `
<svg class="sig-svg" viewBox="0 0 120 50" fill="none" aria-hidden="true">
  <path d="M6 38c10-24 17-30 21-18 3 9-6 20-8 12-2-7 12-17 22-8 8 7-2 17 2 8 4-9 15-15 24-7 6 6 1 13 6 8 5-5 14-10 22-6 6 3 8 8 15 6"
    stroke="#20293F" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M30 44c18-4 38-4 58-1" stroke="#20293F" stroke-width="1" stroke-linecap="round" opacity=".65"/>
</svg>`;

const STAMP_SVG = `
<svg class="stamp" viewBox="0 0 100 100" aria-hidden="true">
  <defs><path id="stampArc" d="M 17 52 A 33 33 0 0 1 83 52"/></defs>
  <circle cx="50" cy="50" r="45" fill="none" stroke="#A83A2C" stroke-width="2.2"/>
  <circle cx="50" cy="50" r="37" fill="none" stroke="#A83A2C" stroke-width=".7"/>
  <text fill="#A83A2C" font-family="Arial, sans-serif" font-size="7" font-weight="700" letter-spacing="0.9">
    <textPath href="#stampArc" startOffset="50%" text-anchor="middle">CV SLAMET JAYA</textPath>
  </text>
  <text x="50" y="53" text-anchor="middle" fill="#A83A2C" font-family="Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="1">SJ</text>
  <text x="50" y="64" text-anchor="middle" fill="#A83A2C" font-family="Arial, sans-serif" font-size="5.1" letter-spacing=".5">RENOVASI BANGUN RUMAH</text>
  <text x="50" y="71.5" text-anchor="middle" fill="#A83A2C" font-family="Arial, sans-serif" font-size="5.1" letter-spacing=".9">SLEMAN</text>
</svg>`;

/* ============================================================
   Bantuan
   ============================================================ */

function escapeHTML(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function rupiah(n) {
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(n);
}

const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

function terbilang(n) {
  if (n < 12) return SATUAN[n];
  if (n < 20) return terbilang(n - 10) + ' belas';
  if (n < 100) {
    const rest = n % 10;
    return terbilang(Math.floor(n / 10)) + ' puluh' + (rest ? ' ' + terbilang(rest) : '');
  }
  if (n < 200) return 'seratus' + (n % 100 ? ' ' + terbilang(n % 100) : '');
  if (n < 1000) {
    const rest = n % 100;
    return terbilang(Math.floor(n / 100)) + ' ratus' + (rest ? ' ' + terbilang(rest) : '');
  }
  if (n < 2000) return 'seribu' + (n % 1000 ? ' ' + terbilang(n % 1000) : '');
  if (n < 1000000) {
    const rest = n % 1000;
    return terbilang(Math.floor(n / 1000)) + ' ribu' + (rest ? ' ' + terbilang(rest) : '');
  }
  if (n < 1000000000) {
    const rest = n % 1000000;
    return terbilang(Math.floor(n / 1000000)) + ' juta' + (rest ? ' ' + terbilang(rest) : '');
  }
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtTime(total) {
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function lampPrice() {
  return state.priceChoice === 'puluh' ? 80000 : 800000;
}

function totalPrice() {
  return BASE_PRICE + lampPrice();
}

/* ============================================================
   Kerangka layar
   ============================================================ */

function wordmarkHTML() {
  return '<div class="wordmark"><span class="mark" aria-hidden="true"><i></i><i></i><i></i></span>Suara Lapangan</div>';
}

function chipHTML(text, ok = false) {
  return `<span class="chip${ok ? ' ok' : ''}"><span class="dot"></span>${escapeHTML(text)}</span>`;
}

function appbar({ back = false, title = '', right = '' } = {}) {
  return `
    <header class="appbar">
      <div class="appbar-left">
        ${back ? `<button class="icon-btn" type="button" data-action="back" aria-label="Kembali">${ICONS.chevron}</button>` : ''}
        ${title ? `<div class="appbar-title">${escapeHTML(title)}</div>` : wordmarkHTML()}
      </div>
      ${right}
    </header>`;
}

function stepper(active) {
  const labels = ['Bicara', 'Susun', 'Dokumen'];
  const items = labels.map((label, index) => {
    const n = index + 1;
    const classes = ['step'];
    if (n < active) classes.push('is-done');
    if (n === active) classes.push('is-done', 'is-active');
    return `<div class="${classes.join(' ')}" role="listitem"${n === active ? ' aria-current="step"' : ''}>
      <span class="step-bar"></span>
      <span class="step-label">${label}</span>
    </div>`;
  }).join('');
  return `<div class="stepper" role="list" aria-label="Langkah ${active} dari 3">${items}</div>`;
}

function animateScreen() {
  screen.classList.remove('screen-in');
  void screen.offsetWidth;
  screen.classList.add('screen-in');
}

/* ============================================================
   Langkah 1 — Bicara
   ============================================================ */

function tokenHTML(tok) {
  if (typeof tok === 'string') return escapeHTML(tok);

  if (tok.flag === 'num') {
    const confirmed = state.priceChoice !== null;
    const word = state.priceChoice === 'puluh' ? 'puluh' : tok.t;
    const label = confirmed
      ? `Harga titik lampu ${state.priceChoice === 'puluh' ? 'delapan puluh ribu' : 'delapan ratus ribu'}. Ketuk untuk mengubah.`
      : 'ratus, mungkin salah dengar. Ketuk untuk memastikan.';
    return `<button type="button" class="word-flag${confirmed ? ' is-ok' : ''}" data-action="flag" data-flag="num" aria-label="${label}">${escapeHTML(word)}</button>`;
  }

  return `<button type="button" class="word-flag is-jv" data-action="flag" data-flag="jv" aria-label="Niki, kata Jawa. Ketuk untuk penjelasan.">${escapeHTML(tok.t)}</button>`;
}

function makeTokenNode(tok) {
  if (typeof tok === 'string') return document.createTextNode(tok);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'word-flag' + (tok.flag === 'jv' ? ' is-jv' : '');
  button.dataset.action = 'flag';
  button.dataset.flag = tok.flag;
  button.textContent = tok.t;
  button.setAttribute(
    'aria-label',
    tok.flag === 'num'
      ? 'ratus, mungkin salah dengar. Ketuk untuk memastikan.'
      : 'Niki, kata Jawa. Ketuk untuk penjelasan.'
  );
  return button;
}

function turnQuoteHTML(turn) {
  return turn.tokens.map((tok) => {
    if (typeof tok === 'string') return escapeHTML(tok);
    if (tok.flag === 'num') {
      const word = state.priceChoice === 'puluh' ? 'puluh' : tok.t;
      return `<span class="mark-amber">${escapeHTML(word)}</span>`;
    }
    return `<span class="mark-jv">${escapeHTML(tok.t)}</span>`;
  }).join(' ');
}

function transcriptContent() {
  if (state.phase !== 'review') {
    if (state.phase === 'recording') return '';
    return `
      <div class="empty">
        <p class="empty-kicker">Belum ada ucapan</p>
        <p class="empty-title">Tekan tombol, lalu bicara.</p>
        <p class="empty-body">Contoh: “plester ruang tamu dua puluh empat meter, dua juta empat ratus, bahannya semen sama besi.”</p>
      </div>`;
  }

  const legend = `
    <div class="transcript-legend" id="transcriptLegend">
      <div class="legend-row">
        <span class="swatch${state.priceChoice !== null ? ' is-ok' : ''}"></span>
        <span>${state.priceChoice !== null
          ? 'Angka sudah dipastikan — ketuk untuk mengubah.'
          : 'Mungkin salah dengar — ketuk untuk mengoreksi.'}</span>
      </div>
      <div class="legend-row">
        <span class="swatch is-jv"></span>
        <span>Kata Jawa, di luar cakupan — ketuk untuk penjelasan.</span>
      </div>
    </div>`;

  const turns = TURNS.map((turn) => `
    <article class="turn" data-turn="${turn.id}">
      <div class="turn-head"><span class="turn-badge">${turn.label}</span></div>
      <p class="turn-text">${turn.tokens.map(tokenHTML).join(' ')}</p>
    </article>`).join('');

  return legend + turns;
}

function dockHTML() {
  if (state.phase === 'review') {
    const confirmed = state.priceChoice !== null;
    return `
      <div class="dock dock-review">
        <div class="review-line${confirmed ? ' is-ok' : ''}" id="reviewLine">
          <span class="dot"></span>
          <span>4 giliran</span>
          <span>·</span>
          <span id="reviewMeta">${confirmed ? 'semua angka dipastikan' : '1 kata perlu dipastikan'}</span>
        </div>
        <button class="primary" type="button" data-action="to-compose">Susun dokumen ${ICONS.arrow}</button>
        <button class="text-btn" type="button" data-action="redo">Rekam ulang</button>
      </div>`;
  }

  const recording = state.phase === 'recording';
  return `
    <div class="dock">
      <div class="wave${recording ? ' is-live' : ''}" id="wave" aria-hidden="true"></div>
      <button class="record-btn${recording ? ' is-recording' : ''}" type="button" data-action="record" aria-label="${recording ? 'Selesai merekam' : 'Mulai merekam'}">
        ${recording ? ICONS.stop : ICONS.mic}
      </button>
      <div class="dock-status" id="dockStatus">
        ${recording ? `<span class="rec-dot"></span>Merekam <span class="mono" id="recTime">${fmtTime(state.seconds)}</span>` : 'Mulai rekam'}
      </div>
      <p class="dock-note">${recording ? 'Ketuk untuk selesai' : 'Indonesia beraksen daerah · kata Jawa ditandai'}</p>
    </div>`;
}

function recordScreen() {
  const recording = state.phase === 'recording';
  const review = state.phase === 'review';
  return `
    ${appbar({ right: chipHTML('Rumah Bu Retno') })}
    ${stepper(1)}
    <div class="record${recording ? ' is-recording' : ''}${review ? ' is-review' : ''}">
      <div class="intro-wrap">
        <div class="intro">
          <div class="intro-inner">
            <p class="eyebrow">Surat penawaran · Rumah Bu Retno</p>
            <h1>Bicara sambil bekerja.</h1>
            <p class="intro-lede">Sebutkan pekerjaan, volume, bahan, dan harga. <strong>Tidak perlu rapi.</strong></p>
          </div>
        </div>
      </div>
      <div class="transcript" id="transcript" aria-live="off">${transcriptContent()}</div>
      ${dockHTML()}
      <p class="sr-only" id="liveStatus" aria-live="polite"></p>
    </div>`;
}

/* ---------- perekaman ---------- */

function bindWave() {
  const wave = document.getElementById('wave');
  if (!wave) return;
  wave.innerHTML = '';
  waveBars = [];
  for (let i = 0; i < 34; i++) {
    const bar = document.createElement('span');
    const idle = 0.06 + 0.11 * Math.abs(Math.sin(i * 0.9));
    bar.style.transform = `scaleY(${idle.toFixed(3)})`;
    wave.appendChild(bar);
    waveBars.push(bar);
  }
}

function startWave() {
  stopWave();
  if (!waveBars.length) return;
  if (REDUCED) {
    waveBars.forEach((bar, i) => {
      bar.style.transform = `scaleY(${(0.22 + 0.52 * Math.abs(Math.sin(i * 0.7))).toFixed(3)})`;
    });
    return;
  }
  const t0 = performance.now();
  const tick = (now) => {
    const t = (now - t0) / 1000;
    waveBars.forEach((bar, i) => {
      const a = Math.sin(t * 4.1 + i * 0.52);
      const b = Math.sin(t * 1.7 + i * 0.19 + 1.3);
      const jitter = Math.sin(t * 9.3 + i * 1.7) * 0.07;
      const value = 0.17 + 0.83 * Math.abs(a * b) + jitter;
      bar.style.transform = `scaleY(${Math.max(0.08, value).toFixed(3)})`;
    });
    waveRAF = requestAnimationFrame(tick);
  };
  waveRAF = requestAnimationFrame(tick);
}

function stopWave() {
  if (waveRAF) cancelAnimationFrame(waveRAF);
  waveRAF = 0;
}

function startTimer() {
  stopTimer();
  state.seconds = 0;
  updateTimer();
  timerId = window.setInterval(() => {
    state.seconds += 1;
    updateTimer();
  }, 1000);
}

function stopTimer() {
  if (timerId) window.clearInterval(timerId);
  timerId = 0;
}

function updateTimer() {
  const el = document.getElementById('recTime');
  if (el) el.textContent = fmtTime(state.seconds);
}

function delayFor(tok) {
  if (REDUCED) return 0;
  const text = typeof tok === 'string' ? tok : tok.t;
  if (/[.!?]$/.test(text)) return 170;
  if (/[,;:]$/.test(text)) return 95;
  return 48;
}

async function streamTranscript() {
  const run = ++streamRun;
  const transcript = document.getElementById('transcript');
  if (!transcript) return;
  transcript.innerHTML = '';

  for (const turn of TURNS) {
    if (run !== streamRun) return;

    const el = document.createElement('article');
    el.className = 'turn is-live';
    el.dataset.turn = turn.id;
    el.innerHTML = `<div class="turn-head"><span class="turn-badge">${turn.label}</span></div><p class="turn-text"></p>`;
    transcript.appendChild(el);
    const paragraph = el.querySelector('.turn-text');

    for (let i = 0; i < turn.tokens.length; i++) {
      if (run !== streamRun) return;
      const tok = turn.tokens[i];
      if (i > 0) paragraph.appendChild(document.createTextNode(' '));
      paragraph.appendChild(makeTokenNode(tok));

      const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 120;
      if (nearBottom) transcript.scrollTop = transcript.scrollHeight;

      await sleep(delayFor(tok));
    }

    el.classList.remove('is-live');
    await sleep(REDUCED ? 120 : 430);
  }

  if (run === streamRun) stopRecording();
}

function startRecording() {
  state.phase = 'recording';
  state.priceChoice = null;
  state.sent = false;
  state.seconds = 0;
  enterStep(1);
  startTimer();
  streamTranscript();
}

function stopRecording() {
  if (state.phase !== 'recording') return;
  streamRun += 1;
  stopTimer();
  stopWave();
  state.phase = 'review';
  enterStep(1);
  const live = document.getElementById('liveStatus');
  if (live) {
    live.textContent = state.priceChoice === null
      ? 'Transkrip selesai. Empat giliran. Satu kata perlu dipastikan.'
      : 'Transkrip selesai. Empat giliran.';
  }
}

function resetSession() {
  streamRun += 1;
  stopTimer();
  stopWave();
  clearBuildTimers();
  state.phase = 'idle';
  state.priceChoice = null;
  state.sent = false;
  state.seconds = 0;
  enterStep(1);
}

function syncReviewState() {
  if (state.step !== 1) return;

  const num = document.querySelector('.word-flag[data-flag="num"]');
  if (num) {
    const isPuluh = state.priceChoice === 'puluh';
    num.classList.add('is-ok');
    num.textContent = isPuluh ? 'puluh' : 'ratus';
    num.setAttribute(
      'aria-label',
      `Harga titik lampu ${isPuluh ? 'delapan puluh ribu' : 'delapan ratus ribu'}. Ketuk untuk mengubah.`
    );
  }

  const line = document.getElementById('reviewLine');
  if (line) line.classList.add('is-ok');

  const meta = document.getElementById('reviewMeta');
  if (meta) meta.textContent = 'semua angka dipastikan';

  const legend = document.getElementById('transcriptLegend');
  if (legend) {
    const swatch = legend.querySelector('.swatch');
    if (swatch) swatch.classList.add('is-ok');
    const text = legend.querySelector('.legend-row span:last-child');
    if (text) text.textContent = 'Angka sudah dipastikan — ketuk untuk mengubah.';
  }
}

/* ============================================================
   Surat
   ============================================================ */

function letterHTML({ draft = false } = {}) {
  const price = lampPrice();
  const total = totalPrice();
  const build = (index, html) => draft ? `<div class="build" style="--i:${index}">${html}</div>` : html;

  const src = (n, inner, label) => draft
    ? `<button type="button" class="src" data-action="src" data-src="${n}" aria-label="${escapeHTML(label)}">${inner}<sup>${n}</sup></button>`
    : inner;

  const ref = (n, label) => draft
    ? `<button type="button" class="src src-ref" data-action="src" data-src="${n}" aria-label="${escapeHTML(label)}"><sup>${n}</sup></button>`
    : '';

  const recipient = draft
    ? `<button type="button" class="src" data-action="src" data-src="1" aria-label="Lihat ucapan sumber nama dan alamat">
        <span class="src-line">Yth. Ibu Retno Wulandari<sup>1</sup></span>
        <span class="src-line">Jl. Kaliurang KM 6 No. 17</span>
        <span class="src-line">Sleman, D.I. Yogyakarta</span>
      </button>`
    : `Yth. Ibu Retno Wulandari<br>Jl. Kaliurang KM 6 No. 17<br>Sleman, D.I. Yogyakarta`;

  const kop = `
    <header class="kop">
      <div class="kop-name">CV SLAMET JAYA</div>
      <div class="kop-sub">Jasa Renovasi dan Bangun Rumah</div>
      <div class="kop-line">Jl. Magelang KM 4 No. 8, Sleman, D.I. Yogyakarta 55284</div>
      <div class="kop-line">0812-2744-8890 · slametjaya.karya@gmail.com</div>
      <div class="kop-rule"></div>
    </header>`;

  const title = `
    <h2 class="doc-title">SURAT PENAWARAN</h2>
    <div class="doc-num">Nomor: ${DOC_NUMBER}${draft ? '<span class="tag-sys">sistem</span>' : ''}</div>`;

  const table = `
    <table class="doc-table">
      <colgroup><col style="width:20px"><col><col style="width:44px"><col style="width:74px"></colgroup>
      <thead>
        <tr><th>No</th><th>Uraian Pekerjaan</th><th>Volume</th><th class="num">Jumlah</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>${src(1, 'Plester dinding ruang tamu, termasuk bahan', 'Lihat sumber uraian pekerjaan')}</td>
          <td class="num">${src(1, '24 m²', 'Lihat sumber volume')}</td>
          <td class="num">${src(2, rupiah(BASE_PRICE), 'Lihat sumber harga plester')}</td>
        </tr>
        <tr>
          <td>2</td>
          <td>${src(3, 'Penambahan titik lampu', 'Lihat sumber titik lampu')}</td>
          <td class="num">${src(3, '5 titik', 'Lihat sumber jumlah titik')}</td>
          <td class="num">${src(3, rupiah(price), 'Lihat sumber harga titik lampu')}</td>
        </tr>
        <tr class="total-row">
          <td colspan="3">Jumlah Penawaran${draft ? '<span class="tag-sys">dihitung</span>' : ''}</td>
          <td class="num">${rupiah(total)}</td>
        </tr>
      </tbody>
    </table>`;

  const terms = `
    <div class="terms">
      <p class="terms-title">Ruang lingkup dan ketentuan:</p>
      <ol>
        <li>Bahan yang disediakan: semen 12 sak dan besi beton 10 mm sebanyak 100 batang.${ref(2, 'Lihat sumber bahan')}</li>
        <li>Waktu pelaksanaan: 3 hari kerja dengan 4 orang tukang.${ref(3, 'Lihat sumber waktu pelaksanaan')}</li>
        <li>Pembayaran: uang muka 50% saat pekerjaan dimulai, pelunasan setelah pekerjaan selesai.${ref(4, 'Lihat sumber pembayaran')}</li>
        <li>Pengecatan dinding belum termasuk dalam penawaran ini.${ref(4, 'Lihat sumber catatan pengecatan')}</li>
      </ol>
    </div>`;

  const signature = `
    <div class="sign">
      <div>Hormat kami,</div>
      <div>CV Slamet Jaya</div>
      ${draft
        ? '<div class="sign-placeholder">tanda tangan &amp; cap</div>'
        : `<div class="sign-space">${SIG_SVG}${STAMP_SVG}</div>`}
      <div class="sign-name">Slamet Widodo</div>
      <div class="sign-role">Direktur</div>
    </div>`;

  return `
    <div class="letter">
      ${build(0, kop)}
      ${build(1, title)}
      ${build(2, `<div class="doc-date">Sleman, ${DOC_DATE}</div>`)}
      ${build(3, `<div class="doc-to"><div>Kepada:</div>${recipient}</div>`)}
      ${build(4, '<div class="doc-subject">Hal: <strong>Penawaran Pekerjaan Plester dan Penambahan Titik Lampu</strong></div>')}
      ${build(5, `
        <div class="doc-body">
          <p>Dengan hormat,</p>
          <p>Sehubungan dengan rencana renovasi ruang tamu di alamat tersebut, kami mengajukan penawaran harga borongan sebagai berikut:</p>
        </div>`)}
      ${build(6, table)}
      ${build(7, `<p class="terbilang">Terbilang: <em>${terbilang(total)} rupiah</em>.</p>`)}
      ${build(8, terms)}
      ${build(9, '<p>Demikian penawaran ini kami sampaikan. Kami berharap dapat mengerjakan pekerjaan tersebut dengan sebaik-baiknya.</p>')}
      ${build(10, signature)}
      <div class="doc-foot"><span>CV Slamet Jaya</span><span>${DOC_NUMBER} · 1/1</span></div>
    </div>`;
}

/* ============================================================
   Langkah 2 — Susun
   ============================================================ */

function composeScreen() {
  return `
    ${appbar({ back: true, title: 'Menyusun', right: chipHTML('Surat penawaran') })}
    ${stepper(2)}
    <div class="compose">
      <div class="compose-status">
        <span id="composeStatus">Membaca 4 giliran…</span>
        <span class="count" id="composeCount">4 giliran</span>
      </div>
      <p class="compose-hint">Ketuk angka kecil <span class="ref-demo">1</span> untuk melihat ucapan asalnya.</p>
      <div class="paper-scroll" id="paperScroll">
        <div class="draft-label"><span class="dot"></span>Draf · belum dikirim</div>
        <article class="paper draft" id="draft">${letterHTML({ draft: true })}</article>
      </div>
      <div class="compose-foot">
        <button class="primary" type="button" data-action="to-doc">Lihat dokumen ${ICONS.arrow}</button>
      </div>
    </div>`;
}

function setComposeStatus(left, right) {
  const l = document.getElementById('composeStatus');
  const r = document.getElementById('composeCount');
  if (l) l.textContent = left;
  if (r) r.textContent = right;
}

function clearBuildTimers() {
  buildTimers.forEach((id) => window.clearTimeout(id));
  buildTimers = [];
}

function startComposeBuild() {
  clearBuildTimers();
  const draft = document.getElementById('draft');
  const scroll = document.getElementById('paperScroll');
  if (scroll) scroll.scrollTop = 0;

  buildTimers.push(window.setTimeout(() => {
    if (draft) draft.classList.add('is-built');
    setComposeStatus('Menyusun surat…', '4 giliran');
  }, 420));

  buildTimers.push(window.setTimeout(() => {
    setComposeStatus('Siap diperiksa', '4 giliran');
  }, REDUCED ? 760 : 1180));
}

/* ============================================================
   Langkah 3 — Dokumen
   ============================================================ */

function sendBarHTML() {
  return `
    <span class="pdf-chip">${ICONS.pdf} PDF · 1 hlm</span>
    <button class="primary" type="button" data-action="send">Kirim ke klien ${ICONS.send}</button>`;
}

function sentBarHTML() {
  return `
    <div class="sent-bar">
      <span class="ok-badge">${ICONS.check}</span>
      <div>
        <div class="sent-main">Terkirim ke Bu Retno</div>
        <div class="sent-sub">WhatsApp · baru saja</div>
      </div>
    </div>`;
}

function docScreen() {
  return `
    ${appbar({
      back: true,
      title: 'Surat penawaran',
      right: chipHTML(state.sent ? 'Terkirim' : 'Siap dikirim', true)
    })}
    ${stepper(3)}
    <div class="doc-screen">
      <div class="doc-scroll" id="docScroll">
        <article class="paper final">${letterHTML({ draft: false })}</article>
      </div>
      <div class="send-bar" id="sendBar">${state.sent ? sentBarHTML() : sendBarHTML()}</div>
    </div>`;
}

function markSent() {
  state.sent = true;
  const bar = document.getElementById('sendBar');
  if (bar) bar.innerHTML = sentBarHTML();
  const chip = document.querySelector('.appbar .chip');
  if (chip) {
    chip.classList.add('ok');
    chip.innerHTML = '<span class="dot"></span>Terkirim';
  }
}

/* ============================================================
   Navigasi
   ============================================================ */

function enterStep(step) {
  state.step = step;
  closeSheet(true);
  clearBuildTimers();
  stopWave();

  if (step === 1) {
    screen.innerHTML = recordScreen();
    bindWave();
    if (state.phase === 'recording') startWave();
    if (state.phase === 'review') {
      const transcript = document.getElementById('transcript');
      if (transcript) transcript.scrollTop = 0;
    }
  } else if (step === 2) {
    screen.innerHTML = composeScreen();
    startComposeBuild();
  } else {
    screen.innerHTML = docScreen();
    const scroll = document.getElementById('docScroll');
    if (scroll) scroll.scrollTop = 0;
  }

  animateScreen();
}

/* ============================================================
   Sheet
   ============================================================ */

function openSheet(innerHTML) {
  const seq = ++sheetSeq;
  lastFocus = document.activeElement;

  overlay.classList.remove('is-open');
  overlay.innerHTML = `
    <div class="scrim" data-sheet-close></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
      <div class="sheet-grab" data-sheet-grab aria-hidden="true"></div>
      ${innerHTML}
    </section>`;
  overlay.setAttribute('aria-hidden', 'false');
  void overlay.offsetWidth;

  requestAnimationFrame(() => {
    if (seq !== sheetSeq) return;
    overlay.classList.add('is-open');
    const sheet = overlay.querySelector('.sheet');
    const first = sheet?.querySelector('button, [href], input, select, textarea');
    if (first) first.focus({ preventScroll: true });
  });

  sheetOpen = true;
  const sheet = overlay.querySelector('.sheet');
  if (sheet) initSheetDrag(sheet);
}

function closeSheet(immediate = false) {
  const seq = ++sheetSeq;
  sheetOpen = false;
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');

  if (lastFocus && document.contains(lastFocus) && typeof lastFocus.focus === 'function') {
    lastFocus.focus({ preventScroll: true });
  }

  if (immediate) {
    overlay.innerHTML = '';
    return;
  }

  window.setTimeout(() => {
    if (seq !== sheetSeq) return;
    if (!overlay.classList.contains('is-open')) overlay.innerHTML = '';
  }, 350);
}

function initSheetDrag(sheet) {
  const grab = sheet.querySelector('[data-sheet-grab]');
  if (!grab) return;

  let dragging = false;
  let startY = 0;
  let startTime = 0;
  let distance = 0;

  grab.addEventListener('pointerdown', (event) => {
    dragging = true;
    startY = event.clientY;
    startTime = performance.now();
    distance = 0;
    grab.setPointerCapture(event.pointerId);
    sheet.style.transition = 'none';
  });

  grab.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    distance = Math.max(0, event.clientY - startY);
    sheet.style.transform = `translateY(${distance}px)`;
  });

  const finish = () => {
    if (!dragging) return;
    dragging = false;
    const elapsed = Math.max(1, performance.now() - startTime);
    const velocity = distance / elapsed;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (distance > 90 || velocity > 0.55) closeSheet();
  };

  grab.addEventListener('pointerup', finish);
  grab.addEventListener('pointercancel', finish);
}

function openConfirmSheet(fromCompose = false) {
  confirmFromCompose = fromCompose;
  const selected = state.priceChoice;

  openSheet(`
    <p class="sheet-eyebrow">Perlu dipastikan</p>
    <h2 class="sheet-title" id="sheetTitle">Delapan ratus ribu?</h2>
    <p class="sheet-body">Sistem mendengar <strong>“ratus”</strong>, tetapi angka ini menentukan harga di surat. Pilih yang benar — tidak ada angka yang ditebak.</p>

    <button type="button" class="option${selected === 'ratus' ? ' is-selected' : ''}" data-price="ratus">
      <span class="radio" aria-hidden="true"></span>
      <span class="opt-main">
        <span class="opt-label">Delapan ratus ribu</span>
        <span class="opt-sub">Rp 800.000</span>
      </span>
      <span class="opt-tag">Terdengar</span>
    </button>

    <button type="button" class="option${selected === 'puluh' ? ' is-selected' : ''}" data-price="puluh">
      <span class="radio" aria-hidden="true"></span>
      <span class="opt-main">
        <span class="opt-label">Delapan puluh ribu</span>
        <span class="opt-sub">Rp 80.000</span>
      </span>
    </button>

    <p class="sheet-note">Sumber: Giliran 3, “harganya delapan ratus ribu”.</p>
    <div class="sheet-actions">
      <button type="button" class="sheet-close" data-sheet-close>Batal</button>
    </div>
  `);
}

function openJvSheet() {
  openSheet(`
    <p class="sheet-eyebrow">Kata Jawa</p>
    <h2 class="sheet-title" id="sheetTitle">“Niki” tidak dipakai.</h2>
    <p class="sheet-body">Yang didukung adalah ucapan Indonesia beraksen daerah. Kata Jawa murni ditandai, bukan diterjemahkan. “Niki” tidak masuk ke surat.</p>
    <div class="quote">Assalamualaikum Bu Retno. <span class="jv-mark">Niki</span>, eh, saya Slamet…</div>
    <p class="sheet-note">Produk tidak mengklaim mengerti bahasa Jawa.</p>
    <div class="sheet-actions">
      <button type="button" class="sheet-close" data-sheet-close>Mengerti</button>
    </div>
  `);
}

function openSourceSheet(id) {
  const turn = TURNS.find((item) => item.id === id);
  if (!turn) return;
  const uses = SOURCE_USES[id] || [];

  openSheet(`
    <p class="sheet-eyebrow">Sumber · ${turn.label}</p>
    <h2 class="sheet-title" id="sheetTitle">Dari ucapan ke surat</h2>
    <div class="quote">${turnQuoteHTML(turn)}</div>
    <p class="sheet-label">Dipakai untuk</p>
    <div class="uses">${uses.map((use) => `<span class="use-chip">${escapeHTML(use)}</span>`).join('')}</div>
    <p class="sheet-note">Setiap angka di surat bisa dilacak ke giliran ini.</p>
    <div class="sheet-actions">
      <button type="button" class="sheet-close" data-sheet-close>Tutup</button>
    </div>
  `);
}

function openSendSheet() {
  openSheet(`
    <p class="sheet-eyebrow">Kirim</p>
    <h2 class="sheet-title" id="sheetTitle">Kirim surat penawaran?</h2>
    <dl class="summary">
      <div class="summary-row"><dt>Kepada</dt><dd>Bu Retno Wulandari</dd></div>
      <div class="summary-row"><dt>Lampiran</dt><dd class="mono">${DOC_NUMBER}.pdf</dd></div>
      <div class="summary-row"><dt>Lewat</dt><dd>WhatsApp</dd></div>
    </dl>
    <div class="sheet-actions">
      <button type="button" class="primary" data-send-confirm>Kirim sekarang</button>
      <button type="button" class="sheet-close" data-sheet-close>Batal</button>
    </div>
    <p class="sheet-note">Prototipe: pengiriman disimulasikan. Tidak ada data yang keluar dari perangkat ini.</p>
  `);
}

function choosePrice(choice, goToCompose) {
  if (choice !== 'ratus' && choice !== 'puluh') return;
  state.priceChoice = choice;
  closeSheet();
  syncReviewState();

  if (goToCompose) {
    confirmFromCompose = false;
    window.setTimeout(() => {
      if (state.step === 1) enterStep(2);
    }, 240);
  }
}

function confirmSend() {
  const sheet = overlay.querySelector('.sheet');
  if (!sheet) return;
  markSent();
  sheet.innerHTML = `
    <div class="success">
      <div class="success-icon">${ICONS.check}</div>
      <h2 class="success-title" id="sheetTitle">Terkirim.</h2>
      <p class="success-body">Surat penawaran ${DOC_NUMBER} sudah dikirim ke Bu Retno Wulandari lewat WhatsApp.</p>
    </div>
    <div class="sheet-actions">
      <button type="button" class="sheet-close" data-sheet-close>Selesai</button>
    </div>`;
  sheet.scrollTop = 0;
  const done = sheet.querySelector('button');
  if (done) done.focus({ preventScroll: true });
}

/* ============================================================
   Event
   ============================================================ */

screen.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  switch (target.dataset.action) {
    case 'record':
      if (state.phase === 'recording') stopRecording();
      else if (state.phase === 'idle') startRecording();
      break;

    case 'to-compose':
      if (state.priceChoice === null) openConfirmSheet(true);
      else enterStep(2);
      break;

    case 'redo':
      resetSession();
      break;

    case 'back':
      if (state.step === 2) enterStep(1);
      else if (state.step === 3) enterStep(2);
      break;

    case 'to-doc':
      enterStep(3);
      break;

    case 'send':
      openSendSheet();
      break;

    case 'flag':
      if (target.dataset.flag === 'num') openConfirmSheet(false);
      else openJvSheet();
      break;

    case 'src':
      openSourceSheet(Number(target.dataset.src));
      break;
  }
});

overlay.addEventListener('click', (event) => {
  if (event.target.closest('[data-sheet-close]')) {
    closeSheet();
    return;
  }

  const price = event.target.closest('[data-price]');
  if (price) {
    choosePrice(price.dataset.price, confirmFromCompose);
    return;
  }

  if (event.target.closest('[data-send-confirm]')) confirmSend();
});

document.addEventListener('keydown', (event) => {
  if (!sheetOpen) return;
  const sheet = overlay.querySelector('.sheet');
  if (!sheet) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeSheet();
    return;
  }

  if (event.key !== 'Tab') return;
  const focusable = [...sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

window.addEventListener('resize', () => {
  /* tidak ada yang perlu diukur ulang; sheet memakai lebar perangkat */
});

/* ============================================================
   Mulai
   ============================================================ */

enterStep(1);
