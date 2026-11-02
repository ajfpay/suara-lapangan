# KEPUTUSAN ADR — Suara Lapangan (putusan juri arsitektur)

**Pemutus:** e-juri (juri arsitektur utama). **Tanggal:** 28 Okt 2026.
**Bahan:** `A-TEKNIS.md`, `B-GUARD-ANGKA.md`, `C-NILAI-HACKATHON.md`, ADR asli, `docs/01-ARSITEKTUR.md`, README, guide hackathon §4/§7/§8.
**Konteks yang mengikat semua putusan:** sisa **5 hari kerja** (21, 22, 23, 25, 26 Jan; deadline Rab 27 Jan 2027 21:00 ET), **belum ada kode**, repo publik belum ada. ADR dinilai bukan sebagai dokumen ideal, tapi sebagai rencana yang bisa dieksekusi 4 orang sampai Senin.

---

## 1. Skor tiap ADR

| ADR | Putusan | Sebab (1 kalimat) |
|---|---|---|
| **ADR-0001** Audio & ASR Gateway | **Revisi** | Arahnya benar (AudioWorklet → proxy server → fallback REST), tetapi ada tiga angka sample rate yang beradu (16 vs 24 kHz) dan pustaka `extendable-media-recorder` menambah risiko lisensi tanpa perlu. |
| **ADR-0002** Guard angka & kutipan turnId | **Revisi (wajib sebelum kode dokumen)** | Ini ADR terbaik dan paling membedakan, tapi aturan "angka ada di giliran yang dikutip" saja bolong: harga bisa lolos sebagai volume (B #12), satuan salah lolos (B #2), dan desimal koma Indonesia tidak ditangani (B #5–#7). |
| **ADR-0003** Render PDF (Typst) | **Pertahankan + Revisi kecil** (direvisi lagi 29 Okt 2026 — lihat §7) | Typst tepat (template teks, tabel RAB, kop/stempel presisi), asalkan dijalankan sebagai binary via `child_process`, font berlisensi OFL, dan klaim "<50 ms" diukur atau dihapus. **Revisi 29 Okt 2026:** perender untuk submit = pipeline `invoify` (HTML + CSS cetak → Chromium headless → `page.pdf()`); `@react-pdf/renderer` hanya fallback; `Typst` tetap dibekukan. |
| **ADR-0004** Frontend/IndexedDB/Capacitor | **Pertahankan stack, Buang jadwal Capacitor** (direvisi 29 Okt 2026 — lihat §7) | `Vite + React` + `idb` benar; tetapi membungkus APK Capacitor di "Minggu 3" tidak ada Minggu 3-nya — itu pekerjaan minggu depan, bukan minggu ini. **Revisi 29 Okt 2026:** basis aplikasi = Next.js `invoify` (App Router + `next-intl`), bukan `Vite + React`; Capacitor tetap ditangguhkan. |

---

## 2. Temuan yang harus diperbaiki minggu ini (urut dampak)

| # | Masalah | Bukti | Perbaikan konkret | Siapa |
|---|---|---|---|---|
| 1 | **Repo publik belum ada; belum ada satu panggilan API nyata** — gagal di syarat Stage One sebelum dinilai rubrik | `README.md:10-12`, `05-RISIKO.md:141`, C §4 | Hari ini: repo publik + 1 transkrip 20 detik → JSON → PDF dari API sungguhan; tandai "dibuat 19 Jan–27 Jan" di README | B (+C untuk transkrip) |
| 2 | **Guard ADR-0002 bolong**: harga lolos sebagai volume; satuan & desimal koma tidak dicek | B #2, #5–#7, #12, #13 | Implementasi guard B §2 (cek satuan, kata kunci field ±6 kata, `dasar` hitungan dihitung server, normalisasi `koma`/`ribu`/`juta`) | B (server) + C (parser kata-angka ID/EN) |
| 3 | **Sample rate beradu**: 16 kHz di diagram, 24 kHz di kontrak, "16/24" di ADR | `01-ARSITEKTUR.md:14` vs `:74` vs `:92`; A §1 | Tetapkan **16 kHz s16le mono** untuk semua jalur; uji 10 detik ke sesi realtime (16 dan 24 kHz) sebelum menulis kode; kalau 16 ditolak, balik ke 24 | A + B |
| 4 | **Klaim & UI prototipe tidak cocok**: nomor dokumen hardcoded, prototipe tanpa mikrofon | `app.js:9`, `app.js:1-4` (tanpa `getUserMedia`); A konteks, C K-2 | Nomor dibuat server dan berubah tiap dokumen; layar "mock" diberi label; demo memakai aplikasi yang benar-benar merekam | A + B |
| 5 | **Rencana 6 minggu vs 5 hari kerja**; video baru dijadwalkan Minggu 4 | `03-GATE-GO-NO-GO.md:9-10`, `02-PEMBAGIAN-KERJA.md:12-17`, C §2 | Tambah Gate D bertanggal (21 Jan / 25 Jan / 26 Jan / 27 Jan ≤18:00 UTC); tandai rencana 6 minggu sebagai pasca-hackathon | Pemilik + lead |
| 6 | **Lisensi & ketergantungan paket** — aturan §4 = diskualifikasi bila memakai kode tanpa hak | A §2 & §5; **D §3 (verifikasi sumber primer: MIT/ISC/Apache-2.0 — aman)** | Buang `extendable-media-recorder` dan `vad` dari jalur demo (perekam native cukup). ~~Ganti `fastify-websocket` → `@fastify/websocket@5`~~ **tidak berlaku 29 Okt 2026**: backend-nya Route Handlers Next.js dan proxy WSS ditangguhkan, jadi tidak ada paket proxy Fastify di jalur mana pun (lihat §7) | A + D |
| 7 | ~~**Fallback REST tidak punya `turnId` asli** — kutipan ADR-0002 jadi rapuh~~ → **selesai/digantikan 29 Okt 2026** | A §4 | Tidak berlaku lagi: jalur utama memakai REST `ENDPOINTING`, dan **Meta sendiri** mengembalikan `turns[]` (`startMs`/`endMs`) yang dinormalkan server menjadi giliran `turn_1..turn_N`. Tidak ada pemotongan segmen manual, dan kutipan tetap punya rentang waktu asli untuk diputar ulang | B |
| 8 | **Klaim dokumen melebihi bukti**: "3 jenis dokumen", "0 angka karangan", layar WER 30 rekaman | `00-RINGKASAN-PRODUK.md:51-57`, `04-RENCANA-VIDEO-DEMO.md:76`; C K-1, K-3, K-6 | Klaim ulang: 1 dokumen penuh + 2 skema siap; hapus layar WER; statistik jangan dikarang | D (video) + pemilik |

---

## 3. Tabel keputusan ringkas "ADR-0005" (mulai kerja Senin)

| # | Hal | Keputusan | Catatan satu baris |
|---|---|---|---|
| 1 | Rekam audio di ponsel | `getUserMedia` + `MediaRecorder` **native** (webm/Opus untuk simpan lokal, PCM 16 kHz untuk kirim) | Tanpa pustaka pihak ketiga di jalur demo |
| 2 | Sample rate tunggal | **16 kHz s16le mono** di semua jalur | Uji 10 detik ke realtime sebelum kode; 24 kHz hanya bila 16 ditolak |
| 3 | Jalur ASR untuk demo | **REST `/v1/asr/transcribe` dengan `mode: ENDPOINTING`** (satu rekaman → `turns[]` Meta → `turn_N`); WebSocket realtime = "berikutnya", bukan hari ini | 3 menit @16 kHz = 5,76 MB, jauh di bawah batas 10 menit/32 MB; batas giliran ditentukan Meta, bukan pemotongan manual |
| 4 | Kutipan `turnId` | Dibuat **server** dari `turns[]` Meta (`turn_1`, `turn_2`, …), hanya giliran **final** dan hanya sesi dokumen ini | Giliran partial/proyek lain selalu ditolak |
| 5 | Guard angka | Guard deterministik §B2 dwibahasa (`EN` & `ID`): satuan, kata kunci field, hitungan `jumlah`, `amountInWords()` (EN) & `terbilang()` (ID) dihitung server, normalisasi pecahan/koma/ribu/juta | Angka tak cocok → `butuh_konfirmasi`; dokumen tidak naik ke `siap` |
| 6 | Bahasa (Global & Lokal) | **Dukungan penuh `Native English` (`en`, USD) + `Bahasa Indonesia beraksen` (`id`, IDR)**; `languageBias: ["English","Indonesian"]`; kata daerah/Jawa **ditandai, bukan ditebak** | Melayani pasar global Meta Hackathon sekaligus pasar lapangan Indonesia; jangan janjikan "mengerti Jawa" |
| 7 | Render PDF | **Sebelum submit: pipeline `invoify`** (HTML + CSS cetak → Chromium headless → `page.pdf()`) untuk `Quotation` [EN] & `Surat Penawaran` [ID]; `@react-pdf/renderer` hanya fallback; Typst dibekukan sampai submit | Klaim "<50 ms" tidak dipakai; mutu cetak diuji setelah satu PDF jadi |
| 8 | Dokumen MVP | **Satu** alur dokumen penuh dwibahasa: **Quotation / Surat Penawaran (`EN` & `ID`)**; dua skema lain siap tapi tidak diklaim jadi | Sesuai prototipe yang ada dan putusan §5 |
| 9 | Nomor dokumen | Dibuat **server**, berubah tiap dokumen | Prototipe `app.js:9` yang hardcoded tidak boleh ikut rekaman |
| 10 | Frontend | **Next.js App Router (basis `invoify`) + `next-intl`** (locale `en`/`id`); antrean perangkat di IndexedDB (paket ditetapkan di tiket 02) | Satu basis kode dengan backend & pipeline PDF; dependensi minimal |
| 11 | Offline | **Unggah tertunda (O1)** saja; rekam dipotong per giliran, bukan satu blob 10 menit | Jangan ada klaim transkripsi offline |
| 12 | Mobile shell | **Capacitor tidak dibangun** sebelum demo | PWA cukup; APK = pasca-hackathon |
| 13 | Model | Spark 1.3 untuk dokumen, Voice Transcribe untuk audio, 1.2 cadangan | Glimmer/O2 tetap "dirancang", tidak tampil di video |
| 14 | Lisensi | Setiap paket diperiksa dari file LICENSE sebelum repo publik | Aturan §4: kode tanpa hak = diskualifikasi |
| 15 | Bukti jujur | Satu demo 20 detik: field kosong → sistem bertanya → angka muncul; lalu satu angka salah → guard menolak | Ini bukti "kontrol, bukan keajaiban" |

---

## 4. Batas jujur untuk video demo 3 menit

**BOLEH diklaim (setelah terbukti di aplikasi yang berjalan):**
1. "**Native English** & **ucapan Indonesia beraksen daerah** → dokumen resmi siap kirim (`Quotation` [USD] & `Surat Penawaran` [IDR])", didemokan dari aplikasi nyata.
2. "Setiap angka tersambung ke giliran bicara asal dan bisa diputar ulang" — hanya untuk jalur yang direkam.
3. "Sistem menolak angka yang tidak ada di ucapan" — diperlihatkan dengan 1 transkrip sengaja cacat.
4. "Nomor dokumen dibuat server" — tunjukkan nomornya berubah antar dokumen.
5. "Satu jenis dokumen penuh (Surat Penawaran) dengan kop, tabel, tanda tangan" + "dua skema dokumen siap dikembangkan".
6. "Kata Jawa ditandai dan dikonfirmasi ke pekerja" — ini kejujuran yang menambah nilai, bukan mengurangi.
7. "Unggah tertunda: catatan tersimpan tanpa sinyal" — **hanya** bila direkam mode pesawat nyata.

**DILARANG diklaim:**
1. "Mengerti/mendukung bahasa Jawa" — Jawa tidak ada di 25 bahasa Voice Transcribe.
2. "Tiga dokumen berfungsi" — hanya satu yang ada.
3. "0 angka karangan / akurasi ≥95% / WER 30 rekaman" — belum ada pengukuran; jangan dikarang.
4. "Transkripsi atau dokumen dibuat offline di ponsel".
5. "Muse Glimmer berjalan tanpa internet" — statusnya **dirancang**, bahkan jangan disebut lisan.
6. "Kompilasi PDF <50 ms" — belum diukur.
7. "Aplikasi Android/APK" — Capacitor tidak dibangun.
8. Rekaman prototipe mock sebagai "aplikasi sungguhan" — itu layar palsu dan melanggar §4 guide.
9. Kata "real-time/langsung" bila demo memakai fallback REST per segmen.

---

## 5. Resolusi bentrok antar-audit

| Bentrok | A | B | C | D | Putusan juri + bukti |
|---|---|---|---|---|---|
| Sample rate | 16 kHz | — | — | — | **16 kHz** (A §1); hitung independen: 10 menit @24 kHz = 28,8 MB, sisa hanya 3,2 MB dari batas 32 MB |
| Apakah demo boleh memakai webm/Opus sementara arsitektur menulis PCM | webm/Opus native | — | — | — | **Boleh untuk simpan lokal**, kirim tetap PCM 16 kHz — dua encoder tidak boleh bertabrakan |
| Apakah REST fallback cukup | cukup untuk demo | — | demo harus dari aplikasi nyata | — | **Cukup, asalkan** `turnId` dibuat server (A §4) dan video tidak menyebut "langsung" |
| Lisensi paket | [BELUM] terverifikasi | — | ADR benar membuang `vad` | Diverifikasi dari sumber primer: `extendable-media-recorder` 9.2.40 = **MIT**; `idb` 8.0.4 = **ISC**; `typst` (typst/typst) = **Apache-2.0**. Tetapi `fastify-websocket` 4.3.0 — paket yang disebut ADR-0001 — **ditandai USANG oleh npm** dan menunjuk penggantinya: *"Please use @fastify/websocket@5.0.0 instead"* | **Tidak ada paket yang perlu ditandai `[BELUM DIVERIFIKASI]`, jadi tidak ada masalah diskualifikasi §4.** Dua putusan: (a) **`extendable-media-recorder` dibuang dari jalur demo** — lisensinya MIT dan aman, tetapi perekam bawaan browser cukup, jadi paketnya cuma menambah beban tanpa perlu; (b) **nama paket proxy di ADR-0001 diganti `fastify-websocket@4.3.0` → `@fastify/websocket@5.0.0`** — satu baris, nama yang benar, dan pekerja backend tidak lagi mengejar baris yang sudah dipensiunkan |
| Render PDF: Typst dikerjakan sekarang? | pilihan tepat secara teknis | — | Typst tidak menaikkan skor yang bisa dipamerkan 3 menit | **JANGAN DIBANGUN. 1–2 hari hilang dari 5 hari tersisa, dan risiko gagalnya jatuh di hari ke-4–5** (biner + toolchain + font; bila kompilasi gagal saat itu, W3 dan video demo jatuh sekaligus) | **Dibekukan sampai submit.** Bekerja dengan satu perender yang paling dikenal tim (mis. `@react-pdf/renderer` atau Puppeteer) yang bisa jadi dalam < 1 hari — **diputuskan 29 Okt 2026: pipeline `invoify` (Chromium/Puppeteer)**, lihat §7. **Syarat pembalik:** Typst hanya boleh dicoba bila perender cepat itu gagal **dan** masih ada ≥ 2 hari kerja tersisa. Arah jangka panjang Typst tetap sah — yang dibekukan jadwalnya, bukan keputusannya |
| Dokumen MVP untuk demo | — | — | C & prototipe (`app.js`) hanya membuat **Surat Penawaran** | W3 menulis **Laporan Harian**; §3 baris 8 menulis **Surat Penawaran** | **Satu dokumen penuh: Surat Penawaran** — sama dengan prototipe, §3 baris 8, dan §4 poin 5, jadi tidak ada satu pun bunyi dokumen yang bentrok. Baris 8 §3 sudah dibaca sebagai Surat Penawaran, bukan Laporan Harian; kalimat §4 "boleh diklaim" poin 5 sudah memakai nama Surat Penawaran. W3 §3 dibaca sebagai "satu alur ujung-ke-ujung dengan satu dokumen penuh". Laporan Harian **tidak** diklaim jadi di video (§4 larangan #2) |
| Tenggat internal | kirim ≤ 18:00 UTC 27 Jan | — | — | Deadline resmi 21:00 EST 27 Jan | **Tenggat internal proyek: Selasa 26 Jan 2027, 23:59 WIB = 26 Jan 2027 16:59 UTC** (repo + video + submission sudah terkirim). Ini yang paling aman: masih menyisakan ≈ 9 jam ke 09:00 WIB 28 Jan (= 27 Jan 21:00 EST / 28 Jan 02:00 UTC). Jangan menunggu batas resmi |

---

## 6. Pengesahan Gate Pra-Implementasi (AO Multi-Agent Validation — 28 Okt 2026)

**Alur Kerja Validasi:** `/home/ubuntu/repos/agency-orchestrator/workflows/suara-lapangan-validation.yaml`  
**Arsip Bukti Output:** `/home/ubuntu/repos/agency-orchestrator/ao-output/Suara-Lapangan-—-Pre-Implementation-Document-&-ADR-Validation-Gate-2026-10-28T20-58-16/`  
**Panel Penguji:** `engineering-software-architect` (Juri Utama), `engineering-backend-architect`, `multi-agent-coordinator`, `engineering-minimal-change-engineer`, `engineering-rapid-prototyper`, dan `project-management-studio-producer` (Pemutus Gate Go/No-Go).

1. **Putusan Gate Pra-Implementasi:** **`GO BERSYARAT (DENGAN REVISI KONTRAK K1–K7)`**.
2. **Enam Penyelarasan Dokumen yang Telah Diterapkan ke `docs/00` s.d. `05`:**
   - **Sample rate tunggal 16 kHz s16le mono** diseragamkan di diagram `01-ARSITEKTUR.md` §1, kontrak §3.1/§3.2 (`PCM_16KHZ`), `00-RINGKASAN-PRODUK.md` §7, dan `05-RISIKO.md` K4.
   - **ADR-0001 (Audio & ASR Gateway):** perekam browser native (`getUserMedia` + `AudioWorklet`/`MediaRecorder` tanpa `extendable-media-recorder` dan `vad`), jalur utama memakai REST `/v1/asr/transcribe` dengan `mode: ENDPOINTING` (satu rekaman → `turns[]` Meta → giliran `turn_N`); redaksi wajib `authorization.accessToken` dari log tetap berlaku. **Revisi 29 Okt 2026:** pemotongan segmen manual `seg_N` dan proxy WSS `@fastify/websocket@5` tidak dipakai — proxy WSS ditangguhkan dan, bila dibuka, memakai route Next.js + `ws` (lihat §7).
   - **ADR-0002 (Guard Angka Deterministik §B2 Dwibahasa `EN` & `ID`):** validasi kepemilikan `(session_id, turn_id, final=true)`, pencocokan angka + satuan + kata kunci konteks ±6 kata dalam bahasa Inggris & Indonesia, normalisasi kata-angka dwibahasa EN/ID + pecahan (`half`/`setengah`, `a quarter`/`seperempat`) + desimal titik/koma, perhitungan `jumlah`, `amountInWords()` (EN), & `terbilang()` (ID) murni di server, serta tes otomatis 10 transkrip cacat sengaja.
   - **ADR-0003 (PDF Engine Dwibahasa):** **revisi 29 Okt 2026** — perender untuk submit adalah pipeline `invoify` (HTML + CSS cetak → Chromium headless → `page.pdf()`) untuk `Quotation / Estimate` [EN] & `Surat Penawaran` [ID]; `@react-pdf/renderer` hanya fallback dan belum terpasang; `Typst` dibekukan sampai submit dan klaim `"<50 ms"` dihapus (lihat §7).
   - **ADR-0004 (Monolit & Mobile Shell):** satu proses monolit **Next.js App Router (Route Handlers)** — bukan layanan `Fastify` terpisah (`Spark 1.3` inline, penyimpanan WAV lokal untuk demo, log/tabel DB tanpa PostHog); basis frontend = Next.js `invoify` + `next-intl`; `Capacitor` APK ditangguhkan pasca-hackathon (lihat §7).
   - **Kalender Aktif, Cakupan Pasar Global (`EN` + `ID`), & Cakupan Dokumen:** tangga 6 minggu ditandai sebagai peta jalan pasca-hackathon; kalender aktif dikunci pada **Gate Harian GD1–GD4 menuju Selasa 26 Jan 2027, 16:59 UTC (23:59 WIB)** dengan dukungan penuh **Native English (pasar global Meta Hackathon) + Bahasa Indonesia** untuk **1 dokumen penuh E2E (`Quotation / Surat Penawaran`) + 2 skema JSON `strict: true` siap (`Daily Field Report / Laporan Harian`, `Change Order / Berita Acara`)**.
3. **Tujuh Kontrak Beku Hari 1 (K1–K7):** didefinisikan secara mengikat di `docs/01-ARSITEKTUR.md` §5 dan `docs/02-PEMBAGIAN-KERJA.md` §0 agar Orang A, B, C, dan D bekerja paralel penuh tanpa saling menunggu.

---

## 7. Revisi ADR 29 Okt 2026 — penyelarasan dengan basis Next.js `invoify` (tiket 12 / D12)

Tiga ADR di §1 dan §6 di atas direvisi karena **keputusan pemilik 28 Okt 2026** (Q1: aplikasi dibangun
di atas basis Next.js `invoify`; Q2: REST `ENDPOINTING` sebagai jalur ASR utama) dan karena implementasi
nyata sudah ada di repo aplikasi `~/repos/suara-lapangan` pada commit **`56a112a`** ("rebrand `invoify`
→ kerangka Suara Lapangan"). Revisi ini hanya menyelaraskan mesin/jalur yang dipakai; **ambang gate,
kontrak K1–K7, kalender GD1–GD4, dan batas klaim tidak berubah.**

| ADR | Keputusan lama (sudah tidak berlaku) | Keputusan yang berlaku (29 Okt 2026) | Alasan |
|---|---|---|---|
| **ADR-0001** Audio & ASR Gateway | REST per **segmen manual ≤ 60 detik** dengan `turnId` server `seg_1`, `seg_2`, … + proxy WSS `@fastify/websocket@5` sebagai pasangan jalur | **REST `ENDPOINTING`**: satu rekaman → `POST /v1/asr/transcribe` (multipart `request` + `audio`) → `turns[]` Meta → server menormalkan menjadi `turn_1..turn_N`. Pemotongan segmen manual **tidak ada**. Proxy WSS realtime **ditangguhkan** (bukan syarat submit; bila dibuka: route Next.js + `ws`) | Keputusan pemilik Q2: Meta sudah memutuskan batas giliran (`startMs`/`endMs`), jadi potong manual hanya menambah kode dan menghapus rentang waktu asli. Perekam native, 16 kHz mono, dan redaksi `authorization` dari log tetap berlaku |
| **ADR-0003** PDF Engine Dwibahasa | `@react-pdf/renderer` in-process sebagai perender utama untuk submit | **Pipeline `invoify`**: render komponen React → HTML + CSS cetak → **Chromium headless** (`puppeteer-core`) → `page.pdf()`. `@react-pdf/renderer` **hanya fallback** (belum terpasang); `Typst` tetap dibekukan; klaim `"<50 ms"` tetap dihapus | Basis aplikasinya `invoify` (Q1), pipeline PDF-nya ada di basis itu dan teruji; menjaga satu jalur render + satu cache, sesuai spec D5 (disetujui Gate 1) |
| **ADR-0004** Basis aplikasi / frontend / mobile shell | PWA `Vite + React` + `idb` sebagai basis | **Next.js 15 App Router (basis `invoify`) + React 18 + `next-intl`** (locale `en`/`id`); tiga layar langkah di `app/[locale]/**`; backend = Route Handlers satu proses. Penyimpanan perangkat tetap IndexedDB (paket ditetapkan di tiket 02). `Capacitor`/APK tetap ditangguhkan pasca-hackathon | Keputusan pemilik Q1 + commit `56a112a`: satu basis kode untuk UI, backend, dan PDF, tanpa layanan `Fastify` terpisah |

Catatan yang menyertai revisi ini:

- Layanan `Fastify` dan paket `@fastify/websocket@5` (MIT) tidak lagi ada di jalur mana pun; proxy WSS
  bila nanti dibuka memakai route Next.js + `ws`.
- `@react-pdf/renderer` (MIT) tidak lagi menjadi perender utama dan belum ada di `package.json`;
  `puppeteer-core` (Apache-2.0) sudah terpasang dan dikecualikan dari bundle server
  (`next.config.js` → `serverExternalPackages`).
- Pipeline PDF lama dari `invoify`
  (`services/invoice/server/{generatePdfService,pdfPage,pdfCache,browser}.ts`) dihapus pada commit
  `56a112a`; membangunnya kembali adalah lingkup tiket 08 (`app/api/pdf/**` +
  `app/components/templates/**`).
- Dokumen lain yang ikut diselaraskan: `docs/01-ARSITEKTUR.md` (D1/D2/D5/D9, §3.1–§3.3, K1/K3),
  `docs/02-PEMBAGIAN-KERJA.md`, `docs/04-RENCANA-VIDEO-DEMO.md`, `docs/05-RISIKO.md`, `docs/00-RINGKASAN-PRODUK.md`,
  dan `README.md`.
- Laporan audit bertanggal (`A-TEKNIS.md`, `B-GUARD-ANGKA.md`, `C-NILAI-HACKATHON.md`,
  `D-ADVERSARIAL.md`) **tidak ditulis ulang** — isinya adalah penilaian pada 28 Okt 2026; bagian yang
  kini tidak berlaku sudah ditandai di tempatnya masing-masing.
