# Suara Lapangan — Pembagian Kerja 4 Orang

Tiap orang mendapat **satu alur yang bisa diverifikasi sendiri sampai di demo**, bukan potongan
lapisan yang baru bersambung di minggu terakhir. Setiap awal sprint ada kontrak antar-muka yang
dibekukan: bentuk API, bentuk data, bentuk dokumen. Setelah kontrak dibekukan, setiap orang boleh
menentukan isi internalnya sendiri tanpa menunggu.

---

## 0. Kalender Eksekusi Aktif Hackathon (Gate Harian GD1–GD4 — Tenggat 26 Jan 2027 16:59 UTC)

Sesuai putusan Gate Pra-Implementasi (`docs/03-GATE-GO-NO-GO.md` & `docs/audit/KEPUTUSAN-ADR.md`), seluruh tim bekerja pada **kalender aktif 4 hari kerja** dengan **7 Kontrak Beku (K1–K7)** dibekukan di Hari 1 pagi. Tabel Minggu 1–6 di §1 adalah **peta jalan pasca-hackathon**.

| Hari | Gate Harian | Orang A (Frontend Next.js) | Orang B (Backend Route Handlers) | Orang C (Model, Schema & Eval) | Orang D (Desain, Template & Video) |
|---|---|---|---|---|---|
| **Hari 1 (21 Jan)** | **GD1 — Bukti Nyata & Kontrak K1–K7** | Uji 10 dtk PCM **16 kHz** native (`getUserMedia`/`MediaRecorder`); toggle bahasa `EN` / `ID` di UI; integrasi mock server B (`K5`) | Repo publik (setelah izin pemilik) + rute `POST /api/asr/transcribe` (REST `ENDPOINTING` → `turns[]` Meta → giliran `turn_N`) + **1 transkrip 20 dtk nyata (`Native English` & `Indonesia`) → JSON → PDF (pipeline Chromium `page.pdf()`)** + bekukan `K1/K3/K5/K7` | Bekukan `contracts/document.schema.json` dwibahasa (`locale: "en" \| "id"`, `Quotation / Surat Penawaran` `strict: true`, `K2`) + ≥10 fixture transkrip (`EN` & `ID`) & 10 transkrip cacat (`K4`) | Bekukan spesifikasi variabel slot template PDF dwibahasa (`Quotation` [USD] & `Surat Penawaran` [IDR], `K6`) + rekaman lokasi mentah |
| **Hari 2 (22 Jan)** | **GD2 — Alur E2E & Guard §B2** | Alur penuh di aplikasi Next.js (`EN` & `ID`): rekam 16 kHz → REST `ENDPOINTING` → giliran `turn_N` → kartu koreksi `butuh_konfirmasi` (`sumber_kutipan`) + antrean IndexedDB | Guard Angka §B2 dwibahasa (isolasi FK `turnId`, satuan & kata kunci `EN`+`ID` ±6 kata, normalisasi pecahan/koma, `amountInWords()` [EN] & `terbilang()` [ID] di server, nomor dokumen server) + hard-stop kuota | Evaluasi Gate 1 dipercepat pada set `Native English` (WER ≤10%) dan 10–15 rekaman `Indonesia beraksen` (bila WER ID >25% → **STOP/Pivot 24 jam**) + tes otomatis 10 transkrip cacat | Implementasi visual template PDF dwibahasa (`Quotation / Estimate` & `Surat Penawaran`) bersama B |
| **Hari 3 (25 Jan)** | **GD3 — Video v1 & Hardening** | Rekam layar alur nyata (`EN` & `ID`) tanpa mock (`app.js:9` hardcoded sudah dihapus); bukti mode pesawat (`O1`) | Proxy WSS realtime (hanya bila GD2 sudah lulus 100%; bukan syarat submit), redaksi log `accessToken`, rate limit per rute | Verifikasi akurasi field beruang pada dokumen `Quotation` (EN) & `Surat Penawaran` (ID) serta audit 0 halusinasi angka | **Produksi Video Demo v1 (≤ 3:00, subjudul bahasa Inggris untuk juri global)** dari aplikasi nyata + tontonan uji 3 orang non-teknis |
| **Hari 4 (26 Jan)** | **GD4 — Submit (≤16:59 UTC / 23:59 WIB)** | Bekukan rilis PWA & verifikasi di 3 perangkat | Bekukan backend, cek kepatuhan lisensi paket & README dwibahasa ("dibuat 19 Jan–27 Jan") | Terbitkan lembar evaluasi jujur (`EN` & `ID`) di repo | Finalisasi video 16:9 + 9:16 & kirim submission sebelum 16:59 UTC |

---

## 1. Peta Jalan Pasca-Hackathon (Ringkasan Beban Minggu 1–6)

| Orang | Peran | Minggu 1 | Minggu 2 | Minggu 3 | Minggu 4 | Minggu 5 | Minggu 6 |
|---|---|---|---|---|---|---|---|
| **A** | Mobile | PWA rekam + antrean offline | Alur sesi + kartu koreksi | Shell Android + lapangan uji | Perbaikan hasil QA | Rilis ke tester | Iterasi |
| **B** | Backend | Fondasi + auth + DB | Proxy WSS ASR | ASR sambung ulang + PDF | Hardening + monitoring | Deploy produksi | Dukungan |
| **C** | Model & Data | Evaluasi ASR pertama | Skema & prompt dokumen | Evaluasi lapangan 30 rekaman | Perbaikan akurasi | Glimmer (O2, "dirancang") | Evaluasi akhir |
| **D** | Desain & Video | Wireframe + identitas | UI final + dokumen PDF | Uji pengguna + skrip video | **Produksi video 3 menit** | Rilis materi | Iterasi materi |

---

## A — Mobile (Frontend)

**Tanggung jawab:** pengalaman rekam, antrean offline, kartu koreksi, instalasi di ponsel lapangan.

**Minggu 1**
- Aplikasi web Next.js App Router (basis `invoify`) dengan tombol rekam besar yang bisa ditekan dengan sarung tangan (target ≥
  96 px, tahan tekanan jari tidak sengaja ≥ 0,3 detik), mode satu tangan.
- `getUserMedia` + `AudioWorklet` / `MediaRecorder` **native** (tanpa `extendable-media-recorder` dan
  tanpa `vad`) → **PCM s16le mono 16 kHz tunggal**; uji di Android Chrome, Safari iOS, dan satu ponsel
  kelas bawah (< Rp2 juta).
- Antrean IndexedDB: rekaman tersimpan bila sinyal putus; bukti dengan mode pesawat.

**Minggu 2**
- Alur sesi: mulai → parsial tampil bersusun → selesai → kartu konfirmasi.
- Kartu koreksi: setiap angka menampilkan giliran bicara asal (sumber kutipan); unggah ulang satu
  kalimat untuk melengkapi field kosong.
- Tombol kirim via WhatsApp (share sheet) + unduh PDF.

**Minggu 3 (Pasca-Hackathon — tidak dibangun sebelum submit 26 Jan)**
- Shell Android (`Capacitor`): izin mikrofon, rekam latar, lokasi opsional untuk mengisi tempat kerja.
- Uji lapangan pertama dengan 3 mandor asli, 5 sesi.

**Minggu 4–6**
- Perbaikan temuan QA; rilis ke 10 tester lewat APK langsung + tautan PWA.

**Definisi selesai (per fitur):** berjalan di 3 perangkat, uji di mode pesawat, tidak ada audio
hilang lebih dari 1 detik, baterai turun < 8% untuk sesi 10 menit.

**Apa yang bukan tanggung jawab A:** menulis prompt model, membuat PDF, mengatur kunci API.

---

## B — Backend

**Tanggung jawab:** semua yang di antara ponsel dan Meta. Auth, penyimpanan, proxy ASR, siklus
hidup sesi, pembuatan PDF, meteran biaya.

**Minggu 1**
- Satu layanan Next.js App Router (Route Handlers), Postgres (Neon), penyimpanan WAV lokal untuk demo
  (object storage pasca-hackathon).
- Auth tanpa kata sandi: tautan WhatsApp/OTP. Akun dibuat saat dokumen pertama; tidak ada
  pendaftaran yang menghalangi.
- Struktur DB sesuai `docs/01-ARSITEKTUR.md` §3.4.

**Minggu 2 (Dipercepat ke Hari 1–2 pada Gate Harian GD1–GD2)**
- Jalur utama ASR: rute `POST /api/asr/transcribe` → REST `ENDPOINTING` Meta (multipart `request` +
  `audio`) → `turns[]` dinormalkan menjadi giliran `turn_1`, `turn_2`, … (**Meta yang memutuskan batas
  giliran**; tidak ada pemotongan segmen manual).
- Proxy WSS ASR ditangguhkan (bukan syarat submit; hanya setelah jalur utama lulus GD2): menyisipkan
  kunci, meredaksi `authorization` dari log, menjaga laju (real time, backlog ≤ 5 detik), menangani
  kode tutup 1000/1008/1011/1013.
- Panggilan `Spark 1.3` inline dengan `text.format: { type: "json_schema", strict: true }`; Guard Angka
  Deterministik §B2 dwibahasa (`EN` + `ID`: isolasi FK `turnId` per `session_id`, cek satuan & kata kunci
  ±6 kata dalam bahasa Inggris & Indonesia, normalisasi pecahan/desimal koma, perhitungan `jumlah`,
  `amountInWords()` [EN], & `terbilang()` [ID] di server); penyuntikan nomor dokumen di server; render
  PDF lewat pipeline `invoify` (HTML + CSS cetak → Chromium headless → `page.pdf()`) untuk `Quotation`
  [USD] & `Surat Penawaran` [IDR].
- Meteran pemakaian (`usage_meter`): detik audio, token, estimasi biaya per pengguna per hari dengan
  **hard-stop kuota harian** (tolak sesi baru saat batas tercapai; jalur WSS memakai kode tutup `1008`,
  sedangkan status rute REST ditetapkan di tiket 09) dan rate limit per rute.

**Minggu 3**
- Sambung ulang sesi 60 menit tanpa kehilangan giliran (kunci urutan pada `turnId`).
- Riwayat dokumen, versi, unduh ulang.
- Telemetri: `session_started`, `turn_finalized`, `doc_generated`, `field_edited`, `doc_sent`.

**Minggu 4**
- Hardening: batas laju, idempotensi pembuatan dokumen, pembersihan audio setelah 30 hari,
  backup harian, health check + uptime monitor, alert biaya harian.

**Minggu 5–6**
- Deploy produksi (butuh persetujuan eksplisit pemilik produk), rotasi kunci, patok pada pengguna nyata.

**Definisi selesai:** 100 sesi berurutan tanpa kehilangan giliran, p95 latensi giliran→dokumen
< 12 detik, semua endpoint punya batas laju, tidak ada kunci di log.

**Apa yang bukan tanggung jawab B:** merancang UI, mengevaluasi WER, menulis skrip video.

---

## C — Model & Data

**Tanggung jawab:** kualitas transkripsi dan kualitas isi dokumen. Ini orang yang paling menentukan
apakah produk benar-benar bekerja.

**Minggu 1**
- Kumpulkan **rekaman uji `Native English` (kontraktor/lapangan global) + 30 rekaman asli pekerja
  lapangan Indonesia** (izin tertulis, ±60–180 detik): campuran bahasa, kata teknis Inggris & Indonesia,
  angka uang (`USD`/`IDR`) dan volume, latar bising.
- Buat transkrip acuan manual. Ukur WER keseluruhan dan WER khusus "token uang/volume" baik untuk
  `Native English` maupun `Bahasa Indonesia beraksen daerah`.
- Uji `keywords` dan `languageBias: ["English", "Indonesian"]`; catat akurasi pada ucapan **Native
  English** (target WER ≤ 10%) dan seberapa akurat **bagian Indonesia** pada ucapan beraksen Jawa (target
  WER ≤ 15%, bukan apakah kata Jawa keluar utuh).
- Hasil: **lembar evaluasi Gate 1 (`EN` & `ID`)**.

**Minggu 2**
- Tiga skema JSON (penawaran, laporan harian, berita acara) + instruksi sistem + contoh.
- Pipeline: transkrip → entitas + kutipan → validasi skema → "butuh_konfirmasi".
- Set data 30 transkrip + dokumen acuan buatan mandor; ukur akurasi field beruang.

**Minggu 3**
- Evaluasi lapangan kedua (rekaman baru, bukan set yang sama) untuk mendeteksi overfit prompt.
- Daftar istilah lokal per wilayah (Jawa Timur vs Jawa Barat) untuk `keywords`.
- Prosedur menangani `butuh_konfirmasi`: memastikan sistem bertanya, bukan mengarang angka.

**Minggu 4**
- Perbaikan akurasi berdasarkan temuan; catat regresi pada set uji lama.
- Uji Muse Spark 1.2 sebagai fallback dan Muse Spark Open (Baseten/Modal) hanya bila diperlukan.

**Minggu 5–6**
- O2 (Minggu 5–6): Muse Glimmer di satu laptop, skrip pengukuran waktu proses, bukti tanpa internet.
  Status di semua materi tetap **"dirancang"** sampai angka waktu proses dan rekaman asli ada.
- Evaluasi akhir yang dilaporkan jujur di README.

**Definisi selesai:** dokumen evaluasi yang dapat dijalankan ulang oleh orang lain; tidak ada angka
akurasi yang dilaporkan tanpa lembar acuan; setiap klaim WER dapat ditelusuri ke berkas.

**Apa yang bukan tanggung jawab C:** membangun UI, deploy, membuat video.

---

## D — Desain & Video Demo

**Tanggung jawab:** kejelasan antarmuka untuk tangan yang kotor dan sinar matahari, konsistensi
dokumen resmi, serta video demo yang nilainya 25%.

**Minggu 1**
- Wireframe alur: rekam → parsial → kartu konfirmasi → kirim.
- Identitas ringan: satu warna aksen, tipografi besar, kontras tinggi untuk luar ruangan.
- **Batch rekaman video mentah**: 2 mandor, 30 menit, cahaya siang, di lokasi asli.

**Minggu 2**
- UI final (desain di Figma/frame), diserahkan ke A sebagai spesifikasi.
- Template dokumen dwibahasa (`Quotation / Estimate` [EN, USD] dan `Surat Penawaran` [ID, IDR]): kop,
  tabel, penomoran, tanda tangan — kelihatan seperti dokumen firma konstruksi sungguhan, bukan keluaran AI.

**Minggu 3**
- Uji pengguna 5 orang dengan prototipe; catat waktu sampai dokumen pertama.
- Skrip video 3 menit versi final (lihat `docs/04-RENCANA-VIDEO-DEMO.md`).

**Minggu 4**
- **Produksi video**: rekam layar alur nyata, rekam lapangan, sulih suara, teks. Target versi 1
  selesai di hari ke-2 minggu 4, karena video adalah 25% nilai.

**Minggu 5–6**
- Perbaikan video berdasarkan tontonan uji (3 orang non-teknis menonton tanpa penjelasan).
- Materi rilis: tangkapan layar, tautan pendaftaran.

**Definisi selesai:** video ≤ 3:00, terbaca di ponsel tanpa suara (ada teks), tidak ada layar palsu
(animasi fitur yang tidak ada), setiap angka di video dapat dibuktikan.

**Apa yang bukan tanggung jawab D:** menulis backend, memanggil API.

---

## Aturan kerja bersama

1. **Tujuh Kontrak Beku (K1–K7 di `docs/01-ARSITEKTUR.md` §5) dikunci pada Hari 1 pagi.** Setelah itu,
   perubahan kontrak harus lewat B/A dan dicatat di `docs/03-GATE-GO-NO-GO.md` bagian keputusan.
2. **Satu orang boleh memblokir rilis, bukan memblokir orang.** Temuan QA dianggap blocker kalau
   menyentuh angka uang, nomor dokumen, atau kehilangan audio.
3. **Demo selalu bisa jalan.** Sejak hari 5 minggu 1, ada versi publik yang dapat direkam kapan pun.
   Fitur setengah jadi ditaruh di balik bendera yang mati di demo.
4. **Evaluasi bukan pendapat.** Kalau dua orang berbeda soal kualitas, jawabannya lembar evaluasi,
   bukan rapat.
5. **Waktu penentu:** video selesai minggu 4, bukan minggu 6. Gate akhir minggu 4 memakai video
   yang sudah ada.
