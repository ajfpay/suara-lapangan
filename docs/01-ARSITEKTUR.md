# Suara Lapangan — Arsitektur

Semua bentuk API di bawah ini diambil dari dokumentasi resmi Meta (`dev.meta.ai/docs`),
diakses 28 Oktober 2026. Yang belum terverifikasi ditandai eksplisit.

**Status sinkronisasi — 29 Okt 2026.** Dokumen ini sudah diselaraskan dengan implementasi nyata di repo
aplikasi `~/repos/suara-lapangan` pada commit **`56a112a`** ("rebrand `invoify` → kerangka Suara
Lapangan"): basis **Next.js 15 App Router + React 18 + `next-intl`** (locale `en`/`id`, default `en`),
tiga layar langkah di `app/[locale]/**` (`/` Rekam, `/susun` Susun, `/dokumen` Dokumen), backend
**Route Handlers Next.js** dalam satu proses. Keputusan lama yang **sudah tidak berlaku** — `Vite +
React`, pemotongan segmen manual `seg_N`, dan `@react-pdf/renderer` sebagai perender utama —
digantikan oleh keputusan pemilik 28 Okt 2026 (Q1: basis Next.js `invoify`; Q2: REST `ENDPOINTING`
sebagai jalur utama) dan commit `56a112a`; tiap penggantian diberi catatan di tempatnya.

---

## 1. Gambaran besar

```diagram
┌───────────────────────────┐
│  Ponsel (PWA; Android      │
│  shell opsional)           │
│  • rekam 16 kHz PCM mono  │
│  • catatan lokal (IndexedDB)
│  • form koreksi cepat     │
└─────────────┬─────────────┘
              │ HTTPS (WSS ditangguhkan)
┌─────────────▼──────────────────────────────────────────────┐
│  Backend: Next.js App Router (Route Handlers, 1 proses)    │
│                                                            │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐  │
│  │ ASR Gateway  │→ │ Turn Assembler│→ │ Doc Engine      │  │
│  │ (REST        │  │ (turn_N dari  │  │ (Spark 1.3 +    │  │
│  │  ENDPOINTING,│  │  turns[] Meta │  │  Guard §B2)     │  │
│  │  16 kHz, key)│  │  isolasi sesi,│  │  → render PDF   │  │
│  └──────────────┘  └───────────────┘  └─────────────────┘  │
│         │                 │                    │           │
│  ┌──────▼─────────────────▼────────────────────▼────────┐  │
│  │ Postgres (Neon): users, projects, sessions, turns,   │  │
│  │ documents, field_edits, usage_meter (hard-stop kuota)│  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐    │
│  │ Penyimpanan│  │ Auth (token│  │ Telemetry (tabel   │    │
│  │ WAV lokal  │  │ demo → OTP │  │ DB / log; tanpa    │    │
│  │ (→ S3 pasca│  │ pasca-demo)│  │ layanan eksternal) │    │
│  └────────────┘  └────────────┘  └────────────────────┘    │
└───────┬─────────────────────┬──────────────────────┬───────┘
        │                     │                      │
┌───────▼──────┐   ┌──────────▼────────┐   ┌─────────▼──────┐
│ Muse Voice   │   │ Muse Spark 1.3    │   │ Muse Spark 1.2 │
│ Transcribe   │   │ (dokumen, schema  │   │ (fallback bila │
│ (REST)       │   │  terkonstrain)    │   │ 1.3 bermasalah)│
└──────────────┘   └───────────────────┘   └────────────────┘

Mode Glimmer — **dirancang**, belum diuji dengan angka (fase 3, terbatas, laptop saja; bukan di ponsel):
┌──────────────────────────┐
│ Laptop/workstation lokal │   ┌───────────────────────────┐
│ Muse Glimmer (30B, Apache │←──│ Sinkronisasi saat sinyal  │
│ 2.0, ~17 GB terkuantisasi)│→──│ kembali: audio + hasil    │
│ + transkripsi lokal      │   │ transkrip ke cloud        │
└──────────────────────────┘   └───────────────────────────┘
```

## 2. Keputusan arsitektur dan alasannya

| # | Keputusan | Alasan | Alternatif yang ditolak |
|---|---|---|---|
| D1 | Backend **Next.js App Router** (Route Handlers dalam satu proses, basis `invoify`), bukan microservices; `Spark 1.3` dan PDF dirender in-process (tanpa job queue/worker terpisah) | Keputusan pemilik 28 Okt 2026 (Q1: basis Next.js `invoify`) + tim 4 orang, tenggat internal 3 Nov 2026. Service boundary kedua menambah risiko gagal | Backend terpisah ASR & dokumen; layanan `Fastify` sendiri (keputusan lama, digantikan commit `56a112a`) |
| D2 | ASR lewat server: **satu rekaman → REST `ENDPOINTING`** (`POST /v1/asr/transcribe`; Meta mengembalikan `turns[]` → giliran kita `turn_N`); aplikasi tidak memanggil Meta langsung. Proxy WSS realtime ditangguhkan (bukan syarat submit) | Kunci API di klien mobile terbaca siapa saja. Meta yang memutuskan batas giliran, jadi tidak ada pemotongan segmen manual di klien. Juga memungkinkan isolasi sesi dan hard-stop kuota biaya per pengguna | SDK ASR di perangkat; pemotongan segmen manual `seg_N` (keputusan lama, digantikan keputusan pemilik Q2) |
| D3 | Format default `ENDPOINTING` untuk MVP; `DIARIZATION` ditangguhkan ke pasca-hackathon | Diarization bukan endpoint bersih dan menambah latensi; fokus MVP adalah satu alur dokumen penuh yang andal | Satu mode untuk semua |
| D4 | **Sample rate tunggal PCM s16le mono 16 kHz** di semua jalur (simpan lokal klien boleh `webm/Opus` native, kirim tetap PCM 16 kHz) | 10 menit @16 kHz = ±19,2 MB (aman di bawah batas 32 MB; 24 kHz = 28,8 MB terlalu mepet). Uji 10 detik ke endpoint realtime sebelum koding; balik ke 24 kHz hanya bila 16 kHz ditolak | Tiga angka sample rate berbeda |
| D5 | Dokumen sebagai objek terstruktur dwibahasa (`locale: "en" \| "id"`, `Quotation / Surat Penawaran` penuh E2E + 2 skema siap), PDF dirender **lewat pipeline `invoify`** (HTML + CSS cetak → Chromium headless → `page.pdf()`; tiket 08); `@react-pdf/renderer` hanya fallback dan `Typst` dibekukan sampai submit | `Spark 1.3` + `json_schema` `strict: true` menjamin bentuk keluaran; semua aritmetika, `amountInWords()` (EN), & `terbilang()` (ID) dihitung server | Meminta model menulis HTML/PDF atau menghitung total |
| D6 | Nomor dokumen dibuat di server dan berubah tiap dokumen, bukan oleh model atau hardcoded di klien | Model tidak boleh punya wewenang atas identifier yang mengikat klien; hardcoded `app.js:9` dihapus di Hari 1 | Nomor dari model / hardcoded |
| D7 | Penggantian data dokumen memakai `muse-spark-1.3`; audio mentah memakai Voice Transcribe; `muse-spark-1.2` hanya fallback | Dokumentasi Meta: audio di 1.3 belum penuh | 1.3 untuk audio |
| D8 | Postgres (Neon) + filesystem lokal untuk WAV pada tahap demo (object storage terpisah pasca-hackathon) | Mengurangi ketergantungan infrastruktur pada jalur kritis 5 hari tanpa mengorbankan skema relasional | File JSON di disk |
| D9 | Aplikasi web **Next.js App Router** (basis `invoify`, repo `~/repos/suara-lapangan`) untuk submit hackathon; shell Android (`Capacitor`) ditangguhkan pasca-hackathon | Satu basis kode dengan backend (Route Handlers) dan pipeline PDF; install dari browser tanpa Play Review dan tanpa risiko gagal build APK di hari terakhir | PWA `Vite + React` terpisah (keputusan lama, digantikan keputusan pemilik Q1 + commit `56a112a`); membungkus APK sebelum alur web selesai |
| D10 | Tidak ada transkripsi offline di ponsel. Tanpa sinyal: audio disimpan di perangkat (`O1`), dokumen dibuat saat sinyal kembali | 17 GB model tidak realistis di ponsel lapangan kelas menengah. `O2` (Glimmer) tetap berstatus "dirancang", **0 baris kode ditulis sebelum submit** | Transkripsi di ponsel |
## 3. Komponen dan kontrak

### 3.1 Klien (aplikasi web Next.js)

- Klien adalah proyek **Next.js App Router** di repo `~/repos/suara-lapangan` (basis `invoify`, commit
  `56a112a`), bukan PWA `Vite + React` terpisah. Tiga layar langkah hidup di `app/[locale]/**`
  (`/` Rekam, `/susun` Susun, `/dokumen` Dokumen); pekerjaan tiket 02/06/07 berada di
  `app/[locale]/(suara)/**` menurut rencana eksekusi.
- `getUserMedia` + `AudioWorklet` / `MediaRecorder` **native** (tanpa `extendable-media-recorder`
  dan tanpa `ricky0123/vad` di jalur demo) → **PCM s16le mono 16 kHz tunggal** lewat fungsi murni
  `toWav16k(blob)`; frame ±80 ms hanya untuk pemantauan laju, bukan pemotongan segmen.
- **Tidak ada pemotongan segmen manual di klien:** satu rekaman dikirim utuh (≤ 10 menit) ke server,
  dan **Meta yang memutuskan batas giliran** (§3.2). Ini menggantikan pemotongan `seg_N` pada
  keputusan lama.
- Rekaman disimpan lokal lebih dulu di **IndexedDB**; bila sinyal putus, rekaman masuk antrean FIFO
  dan diunggah saat sinyal kembali (**O1 — unggah tertunda**). Pilihan paket penyimpanan ditetapkan di
  tiket 02 — pada commit `56a112a` belum ada paket penyimpanan perangkat yang terpasang.
- Pilihan bahasa sesi (`EN — English` / `ID — Bahasa Indonesia`): menyesuaikan label UI (`next-intl`,
  locale `en`/`id`), format mata uang (`USD` / `IDR`), dan bahasa cetakan PDF resmi.
- Kartu koreksi: field yang masuk `butuh_konfirmasi` disorot; setiap angka menampilkan lencana
  `sumber_kutipan` (`turn_N`) yang dapat diketuk untuk memutar/melihat giliran bicara asal.
- Teks parsial (`partialMode: CUMULATIVE`) hanya berlaku pada jalur WSS realtime yang ditangguhkan
  (§3.2); pada jalur utama, giliran muncul setelah balasan Meta diterima.

### 3.2 Kontrak ASR (sisi server → Meta)

**Jalur utama — satu rekaman → REST `ENDPOINTING` → `turns[]` Meta → giliran kita.** Ini yang
dibangun untuk submit (keputusan pemilik Q2; pemotongan segmen manual `seg_N` sudah tidak berlaku):

1. Klien menyimpan rekaman lokal lebih dulu, lalu mengirim **satu** WAV mono 16-bit 16 kHz ke
   `POST {origin}/api/asr/transcribe` (multipart: `audio` + `locale` + `sessionId` klien yang
   idempoten).
2. Route Handler server memanggil Meta: `POST https://api.meta.ai/v1/asr/transcribe`, header
   `Authorization: Bearer $MODEL_API_KEY`, query `sessionId`, dengan multipart part **`request`**
   (`application/json`) dan part **`audio`** (file WAV):

```json
{
  "mode": "ENDPOINTING",
  "model": "muse-voice-transcribe-1.0",
  "audioEncoding": "WAV",
  "languageBias": ["English", "Indonesian"],
  "keywords": [
    "drywall", "square feet", "linear feet", "concrete slab", "rebar", "change order", "recessed light",
    "semen 50 kg", "besi 10 mm", "cakar ayam", "CCO", "realpaving"
  ]
}
```

3. **Meta yang memutuskan batas giliran.** Balasan memuat `turns[]` (`startMs`, `endMs`, `transcript`);
   server menormalkannya menjadi giliran kita `turn_1`, `turn_2`, … (deterministik menurut urutan
   `startMs`), terikat `session_id` di tabel `turns`, sehingga kontrak `sumber_kutipan` di hilir
   seragam. Bentuk giliran (dibekukan, K3):

```json
{ "turn_id": "turn_1", "startMs": 0, "endMs": 4120, "transcript": "…", "final": true }
```

4. Batas yang dihormati: **10 menit audio / 32 MB** per permintaan (16 kHz mono 10 menit ≈ 19,2 MB →
   aman). Kode `400/401/413/429/500` dari Meta dipetakan ke pesan pengguna + status HTTP kita; kunci
   API hanya hidup di proses server dan **wajib diredaksi dari semua log**.

**Jalur WSS realtime (`wss://api.meta.ai/v1/asr/realtime`) — ditangguhkan, bukan syarat submit:**
hanya dikerjakan setelah jalur utama 100% lulus GD2 (paling cepat GD3). Karena backend-nya Route
Handlers Next.js, proxy-nya adalah route Next.js + `ws` (`@fastify/websocket@5` dari keputusan lama
tidak dipakai). Bila jalur ini dibuka, kontrak handshake-nya tetap seperti di bawah — frame JSON
pertama dalam 10 detik, kunci di `authorization.accessToken` (bukan header HTTP), dan **proxy wajib
meredaksi/menghapus field `authorization` dari seluruh log dan error trace**):

```json
{
  "authorization": { "accessToken": "Bearer <MODEL_API_KEY>" },
  "model": "muse-voice-transcribe-1.0",
  "audioEncoding": "PCM_16KHZ",
  "mode": "ENDPOINTING",
  "partialMode": "CUMULATIVE",
  "languageBias": ["English", "Indonesian"],
  "keywords": [
    "drywall", "square feet", "linear feet", "concrete slab", "rebar", "change order", "recessed light",
    "semen 50 kg", "besi 10 mm", "cakar ayam", "CCO", "realpaving"
  ],
  "emitAudioProgress": false
}
```

*(Bentuk field handshake di atas berdasarkan contoh resmi. Tipe dan nilai baku seluruh sembilan
field ada di `/docs/api-reference/voice/schemas`; tim model harus membaca halaman itu sebelum
menulis kode.)*

*(Berlaku hanya bila jalur WSS dibuka.)* Event server yang harus ditangani: `speechStart` →
`transcript` (partial, tanpa `turnId`) → `speechEnd` → `speechComplete` (teks final per `turnId`),
ditambah `speaker` (mode diarization), `audioProgress`, dan `error`. Giliran dapat tumpang tindih:
kunci state pada `turnId`, jangan mengandalkan urutan kedatangan.

*(Berlaku hanya bila jalur WSS dibuka.)* Siklus hidup: sesi maksimum 60 menit, tanpa resume. Pada
menit ke-55 backend membuka sesi baru dan menempelkan transkrip dengan penanda jahitan yang tidak
terlihat pengguna. Kode tutup: 1000 selesai, 1008 kesalahan konfigurasi (jangan ulang), 1011 gagal
internal (ulang dengan backoff), 1013 limit (backoff + beri tahu klien "menunggu giliran").

### 3.3 Kontrak dokumen & Guard Angka Deterministik (server → Spark 1.3 → Guard §B2)

- Endpoint: Responses API, `text.format: { type: "json_schema", strict: true }` — jangan
  `response_format` (itu parameter Chat Completions). Pemanggilan `Spark 1.3` dilakukan inline di
  Route Handler Next.js (`app/api/documents/**`), bukan melalui antrean worker terpisah.
- Skema JSON tunggal per dokumen di-commit di repositori (`contracts/document.schema.json`),
  non-rekursif, `strict: true`: setiap objek `additionalProperties: false`, `required` mendaftar
  semua properti. Untuk submit hackathon, **Quotation / Surat Penawaran (`locale: "en" | "id"`)**
  diimplementasikan penuh E2E, sedangkan skema **Daily Field Report / Laporan Harian** dan **Change
  Order / Berita Acara** siap di kontrak.
- Bentuk keluaran tervalidasi (mendukung `locale: "en"` [USD] maupun `locale: "id"` [IDR]):

```json
{
  "jenis": "surat_penawaran",
  "locale": "en",                         // "en" (Global/English) atau "id" (Bahasa Indonesia)
  "mata_uang": "USD",                     // "USD" atau "IDR"
  "nomor": "SL/QTN/2026-10-29/001",       // dibuat server, berubah tiap dokumen
  "tanggal": "2026-10-29",
  "proyek": { "nama": "Living Room Remodel", "lokasi": "Austin, TX", "klien": "Mr. Carter" },
  "pekerjaan": [
    {
      "uraian": "Drywall installation and taping (living room)",
      "volume": 24,
      "satuan": "sq_m",
      "harga_satuan": 25,
      "jumlah": 600,                      // dihitung deterministik di server (volume * harga_satuan)
      "sumber_kutipan": "turn_1"
    }
  ],
  "total_nominal": 600,                   // dihitung deterministik di server
  "terbilang": "Six hundred US dollars",  // dihitung amountInWords() [EN] / terbilang() [ID] di server
  "butuh_konfirmasi": [
    { "field": "pekerjaan[1].harga_satuan", "alasan": "ambiguous number word (eighty vs eight hundred)", "sumber_kutipan": "turn_2" }
  ]
}
```

- **Spesifikasi Guard Angka Deterministik Dwibahasa (§B2 / ADR-0002 — wajib dijalankan di server setelah `zod`):**
  1. **Isolasi kepemilikan `turnId`:** server memverifikasi bahwa setiap `sumber_kutipan` benar-benar
     ada di tabel `turns` dengan `session_id` yang sama dengan dokumen dan berstatus `final = true`
     (menolak `turnId` partial atau milik sesi/pengguna lain).
  2. **Pencocokan angka + satuan + kata kunci konteks dwibahasa (±6 kata):** mencegah harga lolos sebagai
     volume bila diucapkan dalam giliran yang sama, baik dalam **Native English** maupun **Bahasa Indonesia**:
     - **Kata kunci harga (`harga_satuan`):** English (`"price"`, `"rate"`, `"cost"`, `"dollar"`, `"dollars"`,
       `"usd"`, `"bucks"`, `"per"`, `"each"`, `"total"`) & Indonesia (`"harga"`, `"rupiah"`, `"ribu"`, `"juta"`,
       `"per"`, `"borongan"`).
     - **Kata kunci satuan (`volume`/`satuan`):** English (`"sq ft"`, `"sqft"`, `"square feet"`, `"square meters"`,
       `"linear feet"`, `"lf"`, `"bags"`, `"sheets"`, `"bars"`, `"points"`, `"fixtures"`, `"hours"`) & Indonesia
       (`"meter"`, `"m2"`, `"m3"`, `"sak"`, `"batang"`, `"titik"`, `"hari"`).
  3. **Normalisasi kata-angka dwibahasa (EN + ID) & pecahan/desimal:** parser server menormalisasi
     kata-angka **Inggris** (`"eight hundred"`, `"twenty-four"`, `"twelve hundred"`, `"half"` → `0.5`,
     `"a quarter"` → `0.25`, `"two point five"` → `2.5`) dan **Indonesia** (`"delapan ratus ribu"`,
     `"dua puluh empat"`, `"setengah"` → `0.5`, `"seperempat"` → `0.25`, `"setengah juta"` → `500000`,
     desimal koma `"24,5"` / `"tiga koma lima"` → `24.5`) sebelum membandingkan nilai dengan transkrip.
  4. **Aritmetika, `amountInWords()` (EN), & `terbilang()` (ID) murni di server:** model `Spark 1.3`
     dilarang menjadi sumber hasil perkalian atau teks terbilang; server menghitung ulang
     `jumlah = volume * harga_satuan`, `total_nominal`, serta teks nominal dalam Bahasa Inggris
     (`amountInWords()` untuk `locale: "en"`) maupun Bahasa Indonesia (`terbilang()` untuk `locale: "id"`).
  5. **Penahanan status & uji negatif otomatis:** bila satu saja angka gagal cocok dengan transkrip
     gilirannya, item tersebut dimasukkan ke `butuh_konfirmasi` dan `documents.status` ditahan pada
     `perlu_konfirmasi` (tidak boleh naik ke `siap`). Set 10 transkrip cacat sengaja (mencakup kasus
     `EN` dan `ID`) dijalankan sebagai **tes otomatis** di repo.
- Isi dokumen resmi (kop/letterhead, istilah hukum, tanda tangan) disusun dari template dwibahasa baku
  di kode (**English `Quotation / Estimate`** & **Indonesian `Surat Penawaran`**), bukan dikarang model.
- **Render PDF (ADR-0003 revisi 29 Okt 2026):** memakai **pipeline `invoify`** — render komponen React →
  HTML + CSS cetak → **Chromium headless** (`puppeteer-core`, dikecualikan dari bundle server lewat
  `next.config.js` `serverExternalPackages`) → `page.pdf()`. Dikerjakan di tiket 08
  (`app/api/pdf/**` + `app/components/templates/**`); pipeline lama dari `invoify`
  (`services/invoice/server/*`) sudah dihapus saat rebrand di commit `56a112a`, jadi tiket 08 yang
  membangunnya kembali. Klaim `"<50 ms"` dihapus. `@react-pdf/renderer` **hanya fallback** bila
  Chromium tidak tersedia di lingkungan demo (dan belum terpasang di `package.json`); `Typst` dibekukan
  sampai submit dan hanya boleh dicoba bila perender cepat gagal **serta** masih tersisa ≥ 2 hari kerja.
### 3.4 Skema data

```
users(id, nama, telepon, kota, created_at)
projects(id, user_id, nama, lokasi, klien, tarif, created_at)
sessions(id, project_id, mode, started_at, ended_at, audio_url, asr_session_ids[])
turns(id, session_id, turn_id, speaker, start_ms, end_ms, teks, final, UNIQUE(session_id, turn_id))
documents(id, session_id, jenis, nomor, status, data_json, pdf_url, created_at, sent_at)
field_edits(id, document_id, field_path, nilai_lama, nilai_baru, sumber_kutipan, edited_at)
usage_meter(user_id, hari, detik_audio, token_masuk, token_keluar, estimasi_biaya, PRIMARY KEY(user_id, hari))
feedback(id, user_id, document_id, rating, teks)
```

- **Aturan integritas `sumber_kutipan`:** setiap `sumber_kutipan` di dalam `documents.data_json` dan
  `field_edits` wajib divalidasi terhadap `(session_id, turn_id)` di tabel `turns` dengan `final = true`.
- `status` dokumen: `draft` → `perlu_konfirmasi` → `siap` → `terkirim`. Dokumen tidak dapat berpindah
  ke `siap` selama `butuh_konfirmasi` belum kosong. Pengguna hanya boleh melihat `terkirim` setelah
  tombol kirim ditekan sendiri.

### 3.5 Biaya dan kuota (perhitungan dengan tarif resmi)

- Transkripsi: $0,18/jam audio. 10 menit per dokumen ≈ $0,03.
- Dokumen: transkrip ±800 token + prompt ±1.200 token + keluaran ±700 token.
  Pada Spark 1.3: ±$0,005 per dokumen.
- Estimasi sekitar **$3,5 per 100 dokumen**. Kredit $150 cukup untuk ±4.000 dokumen, jauh di atas
  kebutuhan MVP. Biaya bukan risiko utama; risiko adalah keandalan dan evaluasi.
- **Rate limit & Hard-Stop Kuota:** setiap rute memiliki batas laju eksplisit (maksimum 1 stream WSS
  aktif per pengguna — hanya bila jalur WSS dibuka — dan maksimum 30 permintaan/menit per pengguna
  untuk endpoint transkrip/dokumen). `usage_meter` menerapkan **hard-stop harian** ($5/hari secara
  keseluruhan atau batas kuota harian per pengguna) yang otomatis menolak sesi baru saat batas
  tercapai — bukan sekadar mengirim peringatan. Kode penolakan per rute ditetapkan di tiket 09
  (jalur WSS memakai kode tutup `1008`).

## 4. Sikap terhadap sinyal buruk — sudah diputuskan

| Opsi | Pengertian | Biaya | Klaim yang boleh dipakai |
|---|---|---|---|
| **O1 — Unggah tertunda (wajib, sudah diputuskan)** | Audio direkam dan disimpan di perangkat; dokumen dibuat saat sinyal kembali | 0 hari tambahan | "Catatan tidak hilang walaupun tanpa sinyal" |
| **O2 — Laptop luring di kantor (jalur Best Open Weight)** | Laptop dengan Muse Glimmer di kantor mandor; ponsel sinkron lewat WiFi lokal | 4–5 hari tim model, di Minggu 5–6 | Status **"dirancang, belum diuji dengan angka"** sampai ada bukti waktu proses dan rekaman asli |

Yang **tidak** diklaim: transkripsi atau pembuatan dokumen di ponsel tanpa internet. Model 30B
sekitar 17 GB tidak realistis di ponsel lapangan kelas menengah, dan tanpa sinyal dokumen juga
tidak bisa dikirim ke klien. Yang diselamatkan adalah catatan, bukan koneksi.

O2 tidak menjadi jalan utama produk dan tidak boleh ditulis sebagai fitur yang sudah ada. Kalau
diuji dan berhasil, hasilnya dilaporkan dengan angka; kalau tidak diuji, tetap "dirancang".

---

## 5. Kontrak Beku 4 Orang (K1–K7 — Dibekukan Hari 1 Sebelum Koding)

| Kode | Artefak Kontrak | Spesifikasi yang Dibekukan | Pemilik | Konsumen |
|---|---|---|---|---|
| **K1** | Sample Rate & Frame Audio | **16 kHz s16le mono** tunggal di semua jalur, frame ±80 ms; backlog ≤ 5 detik hanya berlaku pada jalur WSS yang ditangguhkan (pelanggaran = server tolak frame, klien antre lokal) | B | A |
| **K2** | Skema JSON Dokumen Dwibahasa (`contracts/document.schema.json`) | Satu file sumber tunggal di repo, non-rekursif, `strict: true`, mendukung `locale: "en" \| "id"` (`Quotation / Surat Penawaran` penuh E2E + 2 skema siap) | C + B | A, B, D |
| **K3** | Kontrak Giliran ASR & `butuh_konfirmasi` (`contracts/api.json`) | REST `ENDPOINTING` → `turns[]` Meta → giliran `turn_N` (`{turn_id, startMs, endMs, transcript, final}`); payload kartu koreksi `{field, alasan, sumber_kutipan}` (`EN` & `ID`). Event WSS `speechStart` → `transcript` → `speechComplete{turnId, teks}` hanya bila jalur WSS dibuka | B | A |
| **K4** | Fixture Transkrip Dwibahasa & Tes Negatif (`fixtures/transcripts/`) | ≥ 10 transkrip berlabel `turnId`/`sumber_kutipan` di Hari 1 (**Native English** + **Indonesia beraksen**) + **10 transkrip cacat sengaja (`EN` & `ID`)** untuk tes otomatis Guard Angka | C | A, B |
| **K5** | Mock Server / Contract Stub | Respons stub REST/WSS dan dokumen lengkap (`EN` & `ID`) dengan `butuh_konfirmasi` agar UI A tidak menunggu backend B selesai | B | A |
| **K6** | Spesifikasi Variabel Template PDF (`EN` & `ID`) | Pemetaan eksplisit field JSON → slot kop surat, nomor server, tabel item, `amountInWords` (EN) / `terbilang` (ID), stempel, dan tanda tangan untuk `Quotation` & `Surat Penawaran` | D | B |
| **K7** | Isolasi `turnId`, Redaksi Log & Rate Limit | Validasi `(session_id, turn_id, final=true)`, strip `authorization` dari log proxy, rate limit per rute, dan hard-stop kuota harian di `usage_meter` | B | — |
