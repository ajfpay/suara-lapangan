# SPEC — Suara Lapangan MVP (Next.js/invoify base, REST ENDPOINTING ASR)

- **Tanggal:** 28 Okt 2026 · **Status:** DISETUJUI — Gate 1 lulus 28 Okt 2026 (pemilik menyetujui spec; D5 mesin PDF invoify/Chromium = revisi ADR-0003 disetujui; D1 repositori aplikasi = `~/repos/suara-lapangan` disetujui)
- **Tenggat internal:** Selasa 3 Nov 2026, 16:59 UTC (23:59 WIB)
- **Pemilik keputusan:** Pemilik Produk · **Pelaksana:** A (Mobile), B (Backend), C (Model & Data), D (Desain & Video)
- **Sumber yang mengikat:** `docs/00`–`05`, `docs/audit/KEPUTUSAN-ADR.md`, putusan Gate Pra-Implementasi AO (`ao-output/…-Validation-Gate-2026-10-28T20-58-16`, vonis **GO BERSYARAT**, kontrak K1–K7), dan **keputusan pemilik 28 Okt 2026 malam** (Q1: basis Next.js `invoify`; Q2: REST `ENDPOINTING` sebagai jalur utama).
- **Bukti starter code terverifikasi** (klon `~/repos/prototype/.scratch/suara-lapangan-starters/`):
  - `meta-model-cookbook/06_muse_voice/01_voice_api_fundamentals/utils.py:31` → `SAMPLE_RATES = {"PCM_16KHZ": 16000, "PCM_24KHZ": 24000}` (16 kHz diterima, di-resample server).
  - `utils.py:326-405` → `POST https://api.meta.ai/v1/asr/transcribe`, multipart: part `request` (JSON `{mode, model, audioEncoding:"WAV", keywords?, languageBias?}`) + part `audio`; balasan memuat `turns[]` berisi `startMs`, `endMs`, `transcript` bila mode `ENDPOINTING`/`DIARIZATION`; batas 10 menit / 32 MB; `sessionId` sebagai query param.
  - `utils.py:236-288` → handshake WSS `wss://api.meta.ai/v1/asr/realtime`: `{authorization:{accessToken}, model, audioEncoding, mode, partialMode:"CUMULATIVE"}`, ack pertama `{sessionId}`, penutup `{"type":"endStream"}`; kode tutup 1000/1008/1011/1013.
  - `invoify` (MIT): Next 15.3.8 + React 18 + `next-intl` ^4.1 + `zod` ^3.22 + `puppeteer-core` ^24.9; PDF = render React → HTML + Tailwind cetak → halaman Chromium tunggal (dikunci) → `page.pdf()` (`services/invoice/server/generatePdfService.ts`, `pdfPage.ts`, `pdfCache.ts`); locale `id` sudah ada di `i18n/locales/id.json`; `lib/helpers.ts` punya `formatPriceToString`/`number-to-words`; `lib/invoiceNumber.ts` penomoran pola-aman; `lib/secureStore.ts` pola IndexedDB (AES-GCM, kunci non-extractable).

---

## Problem Statement

Mandor/pekerja borongan dan kontraktor kecil kehilangan uang karena pekerjaan diucapkan, bukan ditulis.
Membuat Surat Penawaran/RAB yang bisa dikirim ke klien makan 30–60 menit di malam hari, sering ditunda
sampai terlupa, dan angka yang salah tulis (satu digit) bisa membengkakkan/menggratiskan tagihan.
Mereka bekerja dengan tangan bersarung, sinyal tidak selalu ada, dan berbicara dalam bahasa Indonesia
beraksen daerah yang dicampur istilah teknis Inggris (pasar global: kontraktor bahasa Inggris).

Alat yang ada (Raken, CompanyCam, Joist, dll.) berbahasa Inggris, mahal, dan tidak pernah menyelesaikan
masalah inti: **angka yang diucapkan tidak boleh berubah menjadi angka karangan di dokumen**.

## Solution

Aplikasi web (basis Next.js `invoify`) dengan satu alur: **Rekam → Transkrip per giliran → Konfirmasi angka → Dokumen resmi (PDF)**.

1. Pekerja menekan tombol rekam besar, bicara bebas (EN atau ID).
2. Rekaman disimpan lokal lebih dulu (aman bila sinyal mati), lalu dikirim ke server kita.
3. Server meneruskan ke Meta `POST /v1/asr/transcribe` (`mode: ENDPOINTING`) → Meta mengembalikan
   daftar `turns[]` (waktu mulai/selesai + teks) → server memberi ID giliran `turn_1..turn_N`.
4. `Muse Spark 1.3` (JSON Schema `strict`) mengekstrak dokumen; **Guard Angka Deterministik** di server
   memverifikasi setiap harga/volume terhadap giliran yang dikutip (`sumber_kutipan`) — angka yang tidak
   terverifikasi masuk `butuh_konfirmasi` dan menahan dokumen.
5. PDF resmi (kop, tabel, terbilang/amountInWords, stempel, tanda tangan) dirender in-process dan
   dibagikan via WhatsApp/unduh. Satu dokumen penuh E2E: **Quotation (EN, USD) / Surat Penawaran (ID, IDR)**.
6. Tanpa sinyal: rekaman tetap di perangkat ("Unggah Tertunda"); tidak ada klaim transkripsi offline.

## User Stories

1. Sebagai mandor borongan Indonesia, saya ingin menekan satu tombol besar (≥96 px, tahan tekanan tidak sengaja ≥0,3 dtk) dan langsung bicara, supaya saya bisa mencatat pekerjaan tanpa melepas sarung tangan.
2. Sebagai mandor, saya ingin berbicara dalam bahasa Indonesia apa adanya (aksen daerah, campur istilah teknis), supaya saya tidak perlu mengubah cara bicara saya.
3. Sebagai kontraktor kecil berbahasa Inggris, saya ingin aplikasi menanggapi dalam bahasa Inggris (UI, dokumen, mata uang USD), supaya hasilnya bisa langsung saya kirim ke klien saya.
4. Sebagai mandor, saya ingin memilih bahasa sesi (`EN — English` / `ID — Bahasa Indonesia`) sekali di awal, supaya label, mata uang, dan bahasa dokumen konsisten.
5. Sebagai pekerja di lokasi tanpa sinyal, saya ingin rekaman saya tersimpan di perangkat dan ditandai "Unggah Tertunda", supaya tidak ada audio yang hilang.
6. Sebagai pekerja, saya ingin rekaman saya otomatis terkirim saat sinyal kembali, supaya saya tidak perlu mengulang bicara.
7. Sebagai mandor, saya ingin melihat hasil transkrip terbagi per giliran bicara (`Giliran 1..N`), supaya saya bisa memeriksa potongan yang salah tanpa membaca semuanya.
8. Sebagai mandor, saya ingin setiap angka di dokumen memiliki lencana kutipan yang bisa saya ketuk untuk **memutar ulang detik suara aslinya**, supaya saya bisa memastikan angkanya benar.
9. Sebagai mandor, saya ingin kata/angka yang meragukan (misal "delapan ratus ribu" vs "delapan puluh ribu") disorot dan ditanyakan satu per satu, supaya sistem bertanya, bukan menebak.
10. Sebagai mandor, saya ingin memperbaiki satu field dengan mengetik atau merekam ulang satu kalimat saja, supaya saya tidak perlu mengulang seluruh rekaman.
11. Sebagai mandor, saya ingin kata Jawa murni yang tidak dikenali ditandai untuk saya konfirmasi (tanpa aplikasi mengklaim "mengerti bahasa Jawa"), supaya saya tahu batas kemampuan alat.
12. Sebagai mandor, saya ingin nomor dokumen dibuat otomatis oleh server dan berubah tiap dokumen, supaya tidak ada dua penawaran bernomor sama.
13. Sebagai mandor, saya ingin melihat `total_nominal`, `jumlah` per baris, dan `terbilang` dihitung oleh sistem (bukan oleh AI), supaya aritmetika bisa saya percaya.
14. Sebagai mandor, saya ingin dokumen PDF ber-kop yang terlihat seperti dokumen firma sungguhan, supaya klien menganggapnya serius.
15. Sebagai mandor, saya ingin mengirim PDF lewat tombol WhatsApp (share sheet) atau mengunduhnya, supaya klien menerimanya di saluran yang biasa kami pakai.
16. Sebagai mandor, saya ingin dokumen yang masih `perlu_konfirmasi` tidak bisa naik status menjadi "siap", supaya angka yang belum saya setujui tidak lolos ke klien.
17. Sebagai kontraktor, saya ingin istilah pekerjaan saya (drywall, rebar, cakar ayam, sak, batang) dikenali lebih akurat, supaya saya tidak perlu banyak koreksi.
18. Sebagai pemilik produk, saya ingin setiap panggilan Meta melewati server kami dengan kunci API yang tidak pernah menyentuh klien, supaya kunci tidak bocor.
19. Sebagai pemilik produk, saya ingin ada batas pemakaian harian (hard-stop kuota) dan pembatasan laju per rute, supaya biaya tidak lepas kendali selama demo.
20. Sebagai anggota tim (A/B/C/D), saya ingin kontrak antar-muka (bentuk audio, bentuk giliran, bentuk dokumen) dibekukan di Hari 1, supaya saya bisa bekerja tanpa menunggu orang lain.
21. Sebagai D (desain & video), saya ingin dapat merekam demo dari **aplikasi nyata** (tanpa mock, tanpa layar palsu) kapan saja sejak Hari 2, supaya video 3 menit (25% nilai) tidak menunggu hari terakhir.
22. Sebagai C (model & data), saya ingin menjalankan set evaluasi WER (EN & ID) dan 10 transkrip cacat sebagai tes otomatis yang bisa diulang, supaya klaim akurasi bisa ditelusuri ke berkas.
23. Sebagai juri hackathon, saya ingin membaca README dwibahasa yang jujur ("dibuat 27 Okt–4 Nov 2026", batas kemampuan ditulis apa adanya), supaya penilaian tidak bergantung pada klaim berlebihan.

## Implementation Decisions

### D1 — Basis aplikasi: fork `al1abb/invoify` (Next.js 15 + React 18) — **keputusan pemilik Q1 (opsi B)**

- Aplikasi Suara Lapangan dibangun sebagai proyek Next.js dari basis `invoify` (MIT, commit dipatok saat fork). Layar rekam suara, tampilan giliran, kartu kutipan, dan pembuatan dokumen dibangun sebagai komponen React di dalam struktur `app/` yang sudah ada (App Router, Route Handlers untuk backend).
- Yang dipinjam apa adanya dari `invoify`: pipeline PDF (Chromium tunggal + cache), `next-intl` + katalog locale (`en`, `id` sudah ada), pola validasi `zod` di batas route (`lib/server/validateRequest.ts` + batas ukuran body), penomoran dokumen pola-aman (`lib/invoiceNumber.ts`), pola penyimpanan IndexedDB (`lib/secureStore.ts`), suite Playwright (`smoke.spec.ts`) dan skrip npm.
- Yang dibuang/tidak dipakai dari `invoify`: alur faktur/e-invoice XML (`xml2js`), pengiriman email PDF, katalog template faktur yang tidak relevan (sisakan satu jalur template).
- Prototipe lama (`~/repos/prototype/suara-lapangan/app.js`, `index.html`, `styles.css`) tetap menjadi **acuan desain** (bukan basis kode): ambang tombol, tata letak 3 langkah, lencana kutipan `<sup>N</sup>`, bottom-sheet konfirmasi, `STAMP_SVG`/`SIG_SVG`.
- Lokasi kerja: repo baru `~/repos/suara-lapangan` (klon `invoify` pada commit tetap, remote ditata ulang). Publikasi ke GitHub `ajfpay/suara-lapangan` **hanya setelah persetujuan tertulis pemilik** (Pre-Flight #7). Prototipe di `~/repos/prototype/suara-lapangan` tidak diubah isinya kecuali dokumen.

### D2 — Jalur ASR utama: satu rekaman → REST `ENDPOINTING` → `turns[]` — **keputusan pemilik Q2 (opsi A)**

Klien merekam via API native browser (`getUserMedia` + `MediaRecorder`; tanpa `extendable-media-recorder`, tanpa `ricky0123/vad`). Setelah tombol Selesai:

1. **Simpan lokal dulu** (IndexedDB) → status `Unggah Tertunda` bila unggah gagal.
2. **Konversi di perangkat** ke WAV mono 16-bit PCM **16 kHz** (fungsi murni `toWav16k(blob)`; hasil = PCM s16le tanpa container tambahan setelah header WAV dibuang server).
3. `POST {origin}/api/asr/transcribe` (multipart: `audio` + `locale` + `sessionId` klien idempoten).
4. Server memanggil Meta:
   - `POST https://api.meta.ai/v1/asr/transcribe`, header `Authorization: Bearer $MODEL_API_KEY`,
     query `sessionId`, multipart part **`request`** = `application/json`
     `{"mode":"ENDPOINTING","model":"muse-voice-transcribe-1.0","audioEncoding":"WAV","languageBias":["English","Indonesian"],"keywords":[…]}` dan part **`audio`** = file WAV.
   - Batas yang dihormati: 10 menit audio / 32 MB body (16 kHz mono 10 menit ≈ 19,2 MB → aman); kode 400/401/413/429/500 dipetakan ke pesan pengguna.
5. Server menormalkan balasan `turns[]` (`startMs`, `endMs`, `transcript`) menjadi giliran kita:
   `turn_1`, `turn_2`, … (deterministik per urutan `startMs`), tersimpan di DB terikat `session_id`.
6. Tidak ada pemotongan segmen manual di klien (Meta yang memutuskan batas giliran). Jalur WSS realtime (`@fastify/websocket@5` / Next route + `ws`) hanya dikerjakan **setelah** jalur utama 100% lulus GD2.

Bentuk kontrak giliran (dibekukan Hari 1, K3):

```json
{ "turn_id": "turn_1", "startMs": 0, "endMs": 4120, "transcript": "…", "final": true }
```

### D3 — Ekstraksi dokumen: `Muse Spark 1.3` + skema JSON ketat

- Pemanggilan inline di Route Handler (tanpa job queue), Responses API dengan `text.format: { type: "json_schema", strict: true }` (bukan `response_format` Chat Completions).
- Satu file skema per dokumen di `contracts/` (non-rekursif, `additionalProperties: false`, semua properti di `required`). Untuk submit: **Surat Penawaran / Quotation (`locale: "en" | "id"`)** penuh; **Daily Field Report / Laporan Harian** dan **Change Order / Berita Acara** cukup skema siap.
- Model **dilarang** menghitung: `jumlah`, `total_nominal`, `terbilang`/`amountInWords` dihitung server.

### D4 — Guard Angka Deterministik (server, dwibahasa ID/EN) — ADR-0002 revisi

Dijalankan setelah `zod`. Lima aturan wajib (dibekukan):
1. **Isolasi kepemilikan kutipan:** `sumber_kutipan` harus merujuk giliran `final = true` milik `session_id` dokumen yang sama (validasi FK + server; menolak `turnId` milik sesi lain).
2. **Kecocokan angka + satuan:** angka pada field harus cocok dengan transkrip giliran setelah normalisasi; satuan (`m2`, `sak`, `batang`, `titik`, `sq ft`, `bags`, `bars`) harus cocok dengan jenis field.
3. **Kata kunci konteks ±6 kata:** mencegah harga lolos sebagai volume (kata kunci harga: `harga/rate/price/cost/rupiah/dollar/per/borongan`; kata kunci volume: `meter/sak/batang/titik/sq ft/lin ft`).
4. **Normalisasi dwibahasa:** kata-angka EN & ID, pecahan (`half`, `a quarter`, `setengah`, `seperempat`), desimal koma Indonesia (`24,5`), `ribu/juta/thousand/hundred`.
5. **Penahanan status:** field yang gagal → `butuh_konfirmasi` `{field, alasan, sumber_kutipan}`; `documents.status` tertahan `perlu_konfirmasi` sampai pengguna mengonfirmasi. Set **10 transkrip cacat sengaja** (EN + ID) = tes otomatis di repo.

### D5 — PDF: pakai pipeline `invoify` (HTML → Chromium → `page.pdf()`) — **deviasi dari ADR-0003, butuh persetujuan Gate 1**

- Karena basisnya `invoify`, mesin dokumennya sudah ada dan teruji: `generatePdfService` (render komponen React → HTML + Tailwind cetak → satu halaman Chromium yang dikunci `withPdfPage` → `page.pdf()`), plus `pdfCache` (input identik → keluaran identik) dan label per-locale via `next-intl` (katalog `id` sudah tersedia).
- Pekerjaan baru: **satu template "Surat Penawaran / Quotation"** (kop, tabel RAB, total, terbilang, syarat, tanda tangan, stempel) + label `en`/`id` + penyuntikan string `terbilang`/`amountInWords` yang dihasilkan server.
- `@react-pdf/renderer` (ADR-0003 revisi) diturunkan menjadi **fallback** yang hanya dipakai bila Chromium tidak tersedia di lingkungan demo. `typst` tetap dibekukan sampai submit.
- **Yang dikorbankan:** ketergantungan pada Chromium (bukan mesin JS murni); **yang didapat:** jalur PDF hidup dengan kode paling sedikit dan sudah punya cache + lencana locale.

### D6 — Dwibahasa (EN/ID) sebagai satu jalur, bukan dua aplikasi

- `locale` sesi (`en` | `id`) menentukan: label UI, mata uang (`USD` | `IDR`), judul dokumen (`Quotation / Estimate` | `Surat Penawaran`), fungsi nominal (`amountInWords()` | `terbilang()`), dan `languageBias`/`keywords` ASR.
- Nama field internal tetap Indonesia untuk data dokumen (`jenis`, `pekerjaan`, `harga_satuan`, …) dengan `locale`/`mata_uang` sebagai penentu tampilan — satu skema, bukan dua.

### D7 — Permukaan API (Route Handlers Next.js, monolit satu proses)

| Rute | Fungsi | Kontrak ringkas |
|---|---|---|
| `POST /api/asr/transcribe` | unggah WAV (≤10 mnt) → giliran | multipart `audio`,`locale`,`sessionId` → `{sessionId, turns:[…]}`; idempoten per `sessionId`+hash audio |
| `POST /api/documents` | giliran → Spark 1.3 → Guard | `{sessionId, locale}` → `{document, butuh_konfirmasi[], status}` |
| `PATCH /api/documents/{id}` | konfirmasi/koreksi field | `{field, nilai}` → status naik hanya bila `butuh_konfirmasi` kosong |
| `GET /api/documents/{id}/pdf` | render PDF resmi | `application/pdf`; cache per isi |
| `GET /api/usage` | meteran kuota | `{audio_seconds, tokens, est_cost, hard_stop}` |

Kunci API hanya ada di proses server; `authorization.accessToken` (WSS) dan header `Authorization` (REST) **wajib diredaksi dari semua log**. Pembatasan laju per rute + kuota harian hard-stop (tolak sesi baru saat batas).

### D8 — Data & audio

- Postgres (Neon) untuk `sessions`, `turns`, `documents`, `document_fields`, `field_confirmations`, `usage_meter`; driver `pg` + satu berkas migrasi SQL. WAV disimpan di filesystem lokal (`data/audio/<session>/<file>.wav`) untuk demo.
- `documents.sumber_kutipan` divalidasi FK ke `turns.id` **per `session_id`** (bagian dari K7).
- Locale & preferensi: `next-intl` yang sudah ada.

### D9 — Antrean offline (O1) & penyimpanan perangkat

- IndexedDB menyimpan: audio rekaman (webm/Opus native atau WAV hasil konversi), draf dokumen, dan antrean unggah FIFO. Pakai `idb` (4 KB, ISC — ADR-0004) atau pola `secureStore` yang sudah ada bila `idb` tidak diperlukan.
- Tidak ada transkripsi offline. UI jujur: "tersimpan di perangkat — akan diproses saat sinyal kembali".
- WAV lokal dipertahankan sampai dokumen final supaya lencana kutipan bisa memutar ulang detik suara asli.

### D10 — Kontrak Beku K1–K7 (dibekukan Hari 1, sebelum kode)

| # | Artefak | Isi | Pemilik |
|---|---|---|---|
| K1 | Audio | PCM s16le mono **16 kHz**, frame ±80 ms (klien), WAV mono 16-bit 16 kHz (unggah) | B |
| K2 | Skema dokumen | satu file skema per dokumen dikomit, `strict: true`, non-rekursif | C |
| K3 | Kontrak giliran | `{turn_id, startMs, endMs, transcript, final}` + payload `butuh_konfirmasi` `{field, alasan, sumber_kutipan}` | B |
| K4 | Fixture | 30 transkrip (EN+ID) + dokumen acuan + **10 transkrip cacat** di path tetap | C |
| K5 | Mock/contract test | respons dokumen lengkap untuk A bekerja tanpa B | B |
| K6 | Spesifikasi slot template PDF (field → kop/tabel/tanda tangan), 1 halaman | D |
| K7 | Isolasi kutipan + rate limit + kuota hard-stop | B |

### D11 — Hak dan atribusi lisensi

Kode `invoify` (MIT) dipertahankan notisnya; dependensi baru wajib lisensi permisif (MIT/ISC/Apache-2.0). `puppeteer-core` (Apache-2.0), `next-intl` (MIT), `zod` (MIT), `idb` (ISC). Larangan ADR/guide §4: tidak memakai kode tanpa hak — setiap penambahan dependensi dicatat di README sebelum submit.

### D12 — Sinkronisasi dokumen (bagian dari Hari 1, bukan opsional)

`docs/01-ARSITEKTUR.md` (D9 `Vite+React` → basis Next.js `invoify`; §3.2 jalur REST: segmen manual → `turns[]` Meta + `turn_N`; §3.3 PDF) dan `docs/audit/KEPUTUSAN-ADR.md` (ADR-0001/0003/0004) diselaraskan dengan D1/D2/D5 di Hari 1 dan dicatat di `docs/03-GATE-GO-NO-GO.md`.

## Testing Decisions

**Bentuk tes yang baik di sini:** menguji perilaku yang terlihat pengguna/konsumen kontrak (bentuk `turns`, bentuk dokumen, keputusan guard, PDF yang bisa dibuka), bukan detail internal. Setiap angka pada dokumen harus dapat ditelusuri ke fixture.

**Seam (jalur uji) — seminimal mungkin, dipilih pada titik tertinggi yang ada:**

1. **`documentFromTurns()` — seam murni server (seam utama).** Satu fungsi: `(turns, locale, project) → {document, butuh_konfirmasi}`. Semua aturan Guard §B2 diuji di sini dengan fixture K4 — termasuk **10 transkrip cacat** yang wajib: harga lolos sebagai volume, satuan salah, desimal koma, `ratus`/`puluh` keliru, kutipan giliran sesi lain, giliran `final=false`, EN `twelve hundred`, ID `setengah juta`. Runner: **Vitest** (devDependency baru; standar untuk Next.js) — unit test cepat tanpa server.
2. **`toWav16k()` — seam murni klien.** Diuji di Playwright (konteks browser nyata): header WAV yang benar, laju 16 kHz, mono, 16-bit, durasi ±1 frame.
3. **Batas route `POST /api/asr/transcribe` — seam integrasi (kontrak K3).** Uji dengan fixture WAV: idempotensi per `sessionId`, `turn_N` berurutan naik, rentang ms tidak tumpang tindih, pemetaan kode error Meta (401/413/429) ke pesan + status HTTP kita. Meta **di-mock** di tes (tanpa jaringan); bentuk balasan mock = bentuk nyata yang sudah diverifikasi di `utils.py`.
4. **Batas route `GET /api/documents/{id}/pdf` — seam integrasi.** Asersi: `%PDF` header, ukuran > 0, panggilan kedua identik dilayani cache, dan dokumen `perlu_konfirmasi` menolak render final (409).
5. **E2E Playwright (prior art: `invoify/smoke.spec.ts`).** Satu alur berkas-nyata: unggah fixture WAV → giliran muncul → konfirmasi → PDF terunduh. Tanpa mikrofon di CI (rekaman manual hanya untuk demo/video).

**Evaluasi (bukan CI):** `scripts/eval` menjalankan 30 rekaman acuan → laporan WER EN & ID + WER token uang/volume → berkas hasil untuk Gate 1 (angka apa adanya, dapat dijalankan ulang orang lain). Ambang: EN WER ≤10%, ID ≤15%; **ID >25% = STOP 24 jam** (keputusan pemilik: ganti segmen / ganti jalur / tutup dengan laporan jujur).

## Out of Scope

- **WSS realtime** (`/v1/asr/realtime`, `@fastify/websocket@5`, sambung ulang menit ke-55, backlog ≤5 dtk): hanya setelah jalur REST lulus penuh (paling cepat GD3), dan **bukan** syarat submit.
- Mode `DIARIZATION`, `PUSH_TO_TALK` di UI; multi-bahasa selain `en`/`id` (locale lain `invoify` disembunyikan).
- APK/Capacitor, izin mikrofon persisten, rekam latar, lokasi.
- Muse Glimmer / O2 / transkripsi offline di perangkat (status tetap "dirancang", 0 baris kode).
- Auth pengguna sungguhan (OTP/kata sandi): demo memakai token sesi sederhana; multi-tenant, peran, langganan — pasca-hackathon.
- Object storage eksternal, PostHog/Sentry, deploy produksi & pembuatan repo publik (butuh persetujuan tertulis pemilik), domain, email keluar.
- Typst, faktur XML/e-invoice, katalog template faktur `invoify` yang tidak dipakai.
- Laporan Harian & Berita Acara sebagai alur penuh (hanya skema siap), dan pengukuran p95/kapasitas 100 sesi.

## Further Notes

- **Kalender aktif (GD1–GD4, tenggat 3 Nov 16:59 UTC):** GD1 bukti nyata (1 transkrip 20 dtk API sungguhan → JSON → PDF, kontrak K1–K7 beku) · GD2 alur E2E + Guard §B2 (guard menolak 1 angka salah) · GD3 video v1 ≤3:00 dari aplikasi nyata · GD4 submit. Rencana 6 minggu = pasca-hackathon.
- **Batas klaim di video/materi:** dilarang menulis/mengucapkan "real-time", "mengerti bahasa Jawa", "APK", "0 angka karangan", "3 dokumen"; Glimmer tidak disebut; setiap angka di video dapat dibuktikan.
- **Test runner:** Vitest ditambahkan sebagai devDependency (satu-satunya dependensi baru non-runtime); Playwright sudah ada di `invoify`.
- **Tracker:** spec ini belum diterbitkan ke issue tracker — repo publik belum ada (Pre-Flight #7). Setelah repo dibuat dengan persetujuan pemilik, spec dipindahkan ke `docs/specs/` repo aplikasi dan diterbitkan sebagai issue.
- **Risiko terbesar yang tersisa:** (a) Puppeteer/Chromium di mesin demo (mitigasi: uji Hari 1, fallback `@react-pdf/renderer`); (b) aksen ID pada Gate 1 (prosedur STOP tertulis dipertahankan); (c) waktu 4 hari untuk 4 orang (mitigasi: K1–K7 beku + GD harian).
