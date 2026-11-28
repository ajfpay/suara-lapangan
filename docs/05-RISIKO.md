# Suara Lapangan — Daftar Risiko

Diurutkan menurut **dampak × kemungkinan**. Setiap risiko punya pemilik, pemicu, dan tindakan yang
sudah ditulis sebelum terjadi — bukan reaksi saat panik.

Skala dampak: **K** = dapat mematikan produk, **B** = merusak nilai, **S** = mengganggu.

---

## Risiko tingkat K (dapat mematikan)

### K1 — Aksen daerah merusak bagian Indonesia yang diucapkan (sementara `Native English` berjalan penuh, kata Jawa murni tidak didukung)

**Dampak K pada segmen lokal · Kemungkinan menengah–tinggi.** Dokumentasi Meta menyebut 25 bahasa
dengan code-switching, termasuk **`English`**, **`Indonesian`**, dan **`Malay`**. Bahasa Inggris (`Native
English`) didukung penuh untuk pasar global Meta Hackathon. Sebaliknya, **bahasa daerah seperti Jawa
tidak ada di daftar.** Pengguna segmen lokal berbicara **Indonesia dengan aksen Jawa/daerah**, dan
sesekali menyelipkan kata Jawa murni.

Yang jadi taruhan pada segmen lokal bukan kata Jawanya — yang dibutuhkan maknanya (berapa meter, bahan
apa, di mana, kapan). Yang jadi taruhan adalah **apakah aksen daerah merusak bagian Indonesianya juga**:
"sepuluh" jadi "setengah", "miter" jadi "meter" yang salah, nama bahan berubah.
- **Pemicu:** WER pada bagian Indonesia melewati 25%, atau angka/dimensi/lokasi pada dokumen acuan
  gagal diambil meski kalimatnya sudah Indonesia.
- **Tindakan sebelum Gate 1:** rekam 10–15 sampel Indonesia beraksen Jawa, campur kata teknis dan
  angka; ukur WER bagian Indonesia dan ukur makna yang berhasil diambil.
- **Tindakan produk:** dukungan dwibahasa penuh (`locale: "en" | "id"`); `keywords` untuk istilah
  teknis konstruksi **English** & **Indonesia**; `languageBias: ["English", "Indonesian"]`; kata daerah
  murni yang tidak yakin **ditandai tidak pasti lalu dikonfirmasi ke pekerja**, tidak ditebak.
- **Keputusan Gate 1:** kalau aksen daerah merusak bagian Indonesianya (> 25% WER) → **STOP jalur
  aksen daerah dalam 24 jam**, bukan dipaksakan. Pemutusnya **pemilik produk**: dapat langsung memilih
  Opsi A (**fokus penuh ke segmen Global `Native English` & Bahasa Indonesia standar** yang akurasinya
  stabil) sesuai `docs/03-GATE-GO-NO-GO.md` §"Bila G1 berakhir STOP".
- **Yang dihindari:** menulis "mengerti Jawa" atau "mendukung bahasa Jawa" di README, UI, atau video.

### K2 — Ucapan lapangan bising merusak transkripsi

**Dampak K · Kemungkinan sedang–tinggi.** Model tidak punya deteksi suara latar maupun pengurangan
bising. Bising alat, angin, gema ruang kosong, dan dua orang berbicara bersamaan adalah kondisi nyata.

- **Pemicu:** WER naik > 10 poin pada rekaman bising dibanding rekaman tenang.
- **Keputusan:** penanganan bising ada **di perangkat**, bukan di model — model tidak punya
  pengurangan bising maupun deteksi suara latar.
- **Tindakan hardware/produk:** rekomendasi headset kabel mikrofon kecil (± Rp50 ribu / $5) di onboarding;
  clip mic kerah; panduan 15 detik di aplikasi "pegang ponsel 20 cm dari mulut, matahari di belakang".
- **Tindakan teknis (dicoba, bukan dijanjikan):** pra-proses klien sederhana (high-pass + gate);
  bila gagal di Gate 1, tandai sebagai batas produk dan geser ekspektasi ke "berbicara saat jeda".
- **Bukan solusi:** menambah lapisan LLM untuk "membersihkan" transkrip. Itu menutupi masalah dan
  menambah halusinasi.

### K3 — Model mengarang angka uang atau volume

**Dampak K · Kemungkinan sedang.** Dokumen resmi berisi angka. Satu angka karangan = dokumen tidak
bisa dipercaya, dan itu merusak seluruh premis produk.

- **Tindakan berlapis (Guard Angka Deterministik §B2 / ADR-0002):**
  1. Skema wajib `sumber_kutipan` (`turnId` / `turn_N`) untuk setiap angka, diverifikasi di server
     terhadap `(session_id, turn_id)` dengan `final = true` (mencegah kutipan lintas sesi/partial).
  2. Pemeriksa deterministik di server: mencocokkan **angka + satuan + kata kunci konteks ±6 kata**
     (agar harga tidak lolos sebagai volume dalam giliran yang sama) setelah normalisasi kata-angka
     dwibahasa **English & Indonesia**, pecahan (`"half"`/`"setengah"`, `"a quarter"`/`"seperempat"`),
     dan desimal titik/koma (`24.5` / `24,5`).
  3. Seluruh perhitungan `jumlah = volume * harga_satuan`, total, `amountInWords()` (EN), dan
     `terbilang()` (ID) dieksekusi di server (model `Spark 1.3` dilarang menghitung). Bila tidak cocok
     → masuk `butuh_konfirmasi` dan status dokumen ditahan di `perlu_konfirmasi`.
  4. Halusinasi diuji eksplisit melalui **tes otomatis 10 transkrip cacat sengaja** (`K4`).
- **Ambang Gate 2 / GD2:** 0 kasus angka tanpa sumber terverifikasi pada dokumen yang berstatus `siap`.

### K4 — Ponsel lapangan tidak kuat atau baterai habis

**Dampak K · Kemungkinan sedang.** Perekaman audio terus-menerus berat untuk ponsel kelas bawah di
bawah matahari.

- **Tindakan:** seragamkan **PCM 16 kHz s16le mono tunggal** di semua jalur (10 menit = ±19,2 MB,
  hemat memori dan kuota dibanding 24 kHz), tanpa membebani RAM dengan pustaka `vad` atau
  `extendable-media-recorder`. Potong rekaman lokal per segmen ≤ 60 detik di IndexedDB (`idb`); bila
  baterai < 15% atau sinyal putus, simpan segmen dan kirim lewat REST saat pulih (`O1`).

---

## Risiko tingkat B (merusak nilai)

### B1 — Video 3 menit dikerjakan di menit terakhir

**Dampak B (25% nilai) · Kemungkinan tinggi pada tim yang mengerjakan produk dulu.**
- **Tindakan:** versi 1 wajib selesai awal Minggu 4 (hari ke-2); rekaman lokasi mentah dikumpulkan
  Minggu 1 sehingga tidak bergantung pada cuaca/lokasi di akhir.
- **Pemicu:** pada hari ke-2 Minggu 4 belum ada versi yang bisa ditonton → hentikan fitur baru,
  kerjakan video.

### B2 — Klaim offline yang tidak bisa dibuktikan

**Dampak B · Kemungkinan sedang.** Menjanjikan "offline" lalu yang tersedia hanya "catatan tetap
tersimpan tanpa sinyal" akan terlihat menipu di video.

- **Keputusan pemilik:** tidak ada klaim offline di ponsel. Yang dijanjikan hanya **unggah tertunda**:
  audio direkam dan disimpan di perangkat, dokumen dibuat saat sinyal kembali.
- **Muse Glimmer** hanya jalur **Best Open Weight** di satu laptop, dan sampai diuji dengan angka
  hanya boleh ditulis **"dirancang"** — bukan "sudah berjalan tanpa internet".
- **Tindakan:** gunakan istilah yang tepat di semua materi (lihat `docs/01-ARSITEKTUR.md` §4).

### B3 — Dokumen terlihat seperti keluaran AI, bukan dokumen firma

**Dampak B · Kemungkinan sedang.** Klien mandor akan menolak PDF yang tampak chatbot.
- **Tindakan:** template dokumen dwibahasa (`Quotation / Estimate` [EN, USD] & `Surat Penawaran` [ID, IDR],
  dirender lewat pipeline `invoify`: HTML + CSS cetak → Chromium headless → `page.pdf()`, berdasarkan
  spesifikasi slot variabel `K6` dari D)
  dilengkapi nomor dokumen berurutan dari server, kop perusahaan, tabel RAB/item, `amountInWords()` /
  `terbilang()` server, stempel, dan tanda tangan resmi.

### B4 — Overfit prompt ke set uji yang sama

**Dampak B · Kemungkinan sedang.** Akurasi 95% pada 30 dokumen lalu jatuh di lapangan.
- **Tindakan:** set uji lapangan kedua dengan rekaman baru di minggu 3; set pertama menjadi
  "set pengembangan" dan tidak dipakai untuk klaim akhir.

### B5 — Biaya naik tak terkendali (atas kredit hackathon)

**Dampak B · Kemungkinan rendah** (perhitungan: ±$3,5/100 dokumen; $150 ≈ 4.000 dokumen).
- **Tindakan tetap:** rate limit eksplisit per rute (maks 1 stream WSS aktif/pengguna, 30 req/menit
  untuk dokumen) dan **hard-stop kuota harian** di `usage_meter` ($5/hari keseluruhan atau kuota
  harian per pengguna) yang otomatis menolak sesi baru dengan kode `1008` saat batas tercapai.

### B6 — Waktu penyelesaian dokumen terasa lambat di lapangan

**Dampak B · Kemungkinan sedang.** Model berbicara → 3 detik endpointing → dokumen 8–12 detik.
- **Tindakan:** tampilkan progres per tahap yang jujur ("mendengar → menyusun → dokumen"), bukan
  spinner kosong. Target p95 < 12 detik.

---

## Risiko tingkat S (mengganggu)

| # | Risiko | Tindakan |
|---|---|---|
| S1 | Izin mikrofon browser ditolak / hilang | Onboarding 15 detik; fallback shell Android |
| S2 | Sesi 60 menit terputus pada rapat panjang | Sambung ulang otomatis + penanda jahitan |
| S3 | Limit 256 stream bersamaan (bukan masalah MVP) | Monitor, antre dengan pesan ramah |
| S4 | Koneksi putus saat unggah | Antrean IndexedDB + idempotensi pembuatan dokumen |
| S5 | Data pribadi klien di audio | Retensi audio 30 hari; hapus atas permintaan; jangan kirim audio ke log |
| S6 | Tim kehilangan satu orang | Kontrak antar-muka tertulis memungkinkan pengambil-alihan per modul |
| S7 | Ketergantungan pada layanan Meta jika gangguan | `muse-spark-1.2` sebagai cadangan; `/v1/asr/transcribe` file sebagai jalur kedua |

---

## Risiko kepatuhan hackathon

| Item | Status | Catatan |
|---|---|---|
| Repo publik di bawah `ajfpay` | **Belum dibuat** — wajib persetujuan tertulis pemilik (`Pre-Flight #7`) | Kredensial `gh` tersedia |
| Tanda jelas "dibuat 19 Jan–27 Jan" di README | Wajib di Hari 1 (`GD1`) saat repo dibuat | Belum ada kode |
| Lisensi paket pihak ketiga (§4 Guide: kode tanpa hak = diskualifikasi) | **Terverifikasi aman** (`next-intl` MIT, `puppeteer-core` Apache-2.0, `@playwright/test` Apache-2.0; daftar lengkap paket terpasang + lisensinya dijaga `THIRD-PARTY.md` dan `npm run check:third-party` di repo aplikasi). `@fastify/websocket@5` (MIT) dan `@react-pdf/renderer` (MIT) tidak lagi di jalur utama — `@react-pdf/renderer` hanya fallback dan belum terpasang | `extendable-media-recorder` & `vad` dibuang dari jalur demo |
| Larangan kategori (medis, RAG, gambar, edukasi, lamaran, gizi, kepribadian, olahraga, politik, perang) | Tidak tersentuh | Cakupan dokumen sudah diperiksa |
| Video 3 menit & Tenggat Internal | Kalender aktif **GD1–GD4**, submit terkunci **Sel 26 Jan 2027 16:59 UTC (23:59 WIB)** | Video v1 selesai di Hari 3 (`GD3`) |
| Model Meta yang dipakai sesuai dokumentasi | `Spark 1.3` untuk dokumen (`text.format: json_schema`), `Voice Transcribe` untuk audio (16 kHz), `1.2` fallback | Audio di 1.3 dihindari |

---

## Ringkasan pemilik risiko

| Risiko mematikan | Pemilik | Keputusan pertama |
|---|---|---|
| K1 Aksen daerah mengganggu bagian Indonesia | C | Gate 1 (Minggu 2) — bisa STOP |
| K2 Bising | C + A | Gate 1 (Minggu 2) |
| K3 Angka karangan | C + B | Gate 2 (akhir Minggu 3) |
| K4 Ponsel + baterai | A | Gate 1–3 (Minggu 2–4) |
