# Suara Lapangan — Ringkasan Produk

**Status:** dokumen perencanaan; kerangka aplikasi (tiga layar, dua locale) sudah ada di repo lokal
`~/repos/suara-lapangan` pada commit `56a112a`. Repositori GitHub belum dibuat; publikasi dan
implementasi lanjutan menunggu arahan pemilik.
**Tanggal:** 28 Oktober 2026 (status disinkronkan 29 Oktober 2026)
**Hackathon:** Meta (jendela karya dinilai 27 Okt – 4 Nov 2026)

---

## 1. Satu kalimat

Suara Lapangan mengubah ucapan pekerja lapangan dan kontraktor kecil — sambil bekerja, dengan tangan
kotor dan sarung tangan terpasang, baik dalam **Native English (pasar global)** maupun **Bahasa Indonesia
beraksen daerah** — menjadi dokumen resmi siap dikirim ke klien: **Quotation / Surat Penawaran**,
**Daily Field Report / Laporan Harian**, atau **Change Order / Berita Acara**.

Produk dirancang untuk **pasar global Meta Hackathon sekaligus pasar lapangan Indonesia**: mendukung
penuh **Native English (`en-US`/`en`)** dan **Bahasa Indonesia (`id-ID`/`id`)** yang keduanya berada
di dalam 25 bahasa resmi `muse-voice-transcribe-1.0`. Untuk ucapan Indonesia yang diselingi kata
daerah di luar cakupan model (seperti kata Jawa murni), yang dikejar adalah makna kalimatnya dan kata
daerah yang meragukan ditandai untuk dikonfirmasi — bukan ditebak.

## 2. Masalah

Pekerja borongan dan mandor kecil tidak mengetik. Bukan karena malas, tapi karena:

- **Tangannya sibuk.** Sarung tangan terpasang, tangan penuh material. Mengetik tidak terjadi.
- **Catatannya menunggu besok pagi.** Yang terjadi adalah nol catatan di lokasi, lalu rekonstruksi
  dari ingatan — dan yang hilang justru detail yang menentukan: angka volume, dimensi, kesepakatan
  lisan soal tambahan pekerjaan, perubahan harga, siapa hadir.
- **Akibatnya uang.** Volume pekerjaan tidak tercatat → invoice kurang bayar. Kesepakatan tambahan
  tidak terdokumentasi → klien menolak. Berita acara tidak ada → serah terima molor.
- **Bahasa lapangan nyata (Native English & Indonesia campur).** Di pasar global (AS/Eropa/Australia),
  *small contractors* dan *remodelers* berbicara cepat dengan satuan teknis (`"24 sq ft drywall"`,
  `"five recessed light points at eight hundred dollars"`). Di Indonesia, mandor berbicara Indonesia
  beraksen daerah diselingi istilah Inggris (`"finishing"`, `"cor"`, `"plester"`) dan sesekali kata
  daerah/Jawa. Alat transkripsi generik hanya mengeluarkan teks mentah — padahal tidak ada kontraktor
  yang mengirim transkrip mentah ke klien.

## 3. Yang dibuat

Alur utama (satu sesi, target di bawah 3 menit dari ucap sampai kirim):

1. **Ucap (`Native English` atau `Bahasa Indonesia`).** Pengguna memilih bahasa dokumen (`EN` / `ID`),
   menekan tombol besar di ponsel, dan berbicara sambil bekerja dengan sarung tangan.
2. **Transkripsi.** `Muse Voice Transcribe` menangani percakapan, endpointing per giliran bicara,
   serta ucapan dalam **Native English** maupun **Bahasa Indonesia** (termasuk code-switching EN+ID).
   Kosakata teknis konstruksi (`"drywall"`, `"square feet"`, `"rebar"`, `"change order"`, `"semen 50 kg"`,
   `"besi 10 mm"`, `"cakar ayam"`) dibias lewat `keywords`. **Kata daerah murni di luar 25 bahasa resmi
   (mis. Jawa) tidak ditebak**: bagian yang tidak pasti ditandai lalu dikonfirmasi ke pekerja.
3. **Strukturisasi & Guard Dwibahasa.** `Muse Spark 1.3` mengubah transkrip menjadi data terstruktur
   yang divalidasi skema (`JSON Schema` terkonstrain `strict: true`), diperiksa oleh Guard Angka
   Deterministik dwibahasa (`EN` & `ID`), lalu merender dokumen PDF resmi dalam **Bahasa Inggris
   (`Quotation / Estimate`, USD)** atau **Bahasa Indonesia (`Surat Penawaran`, IDR)**.
4. **Kurang data → bertanya.** Bila volume, harga, atau pihak tidak lengkap, sistem menyorot field
   kosong (`butuh_konfirmasi`) dan pengguna cukup mengucap satu kalimat lagi atau memilih konfirmasi.
5. **Kirim.** Dokumen keluar sebagai PDF bernomor server dan dapat langsung dikirim ke klien.

### Cakupan dokumen MVP (Hackathon vs Pasca-Hackathon)

Sesuai putusan Gate Pra-Implementasi (`docs/audit/KEPUTUSAN-ADR.md` §3 & §6), cakupan untuk demo dan submit hackathon dikunci pada **satu alur dokumen penuh ujung-ke-ujung dalam dua bahasa (`Quotation / Estimate` [EN] & `Surat Penawaran / RAB` [ID])** dengan **dua skema JSON siap dikembangkan (`Daily Field Report / Laporan Harian` & `Change Order / Berita Acara`)**:

| Dokumen (`EN` / `ID`) | Status di Submit Hackathon | Kapan dipakai | Bukti nyata di lapangan |
|---|---|---|---|
| **Quotation / Surat Penawaran** | **Dokumen penuh E2E (`Native English` USD & `Bahasa Indonesia` IDR: ucap → guard angka → PDF resmi)** | Sebelum mulai; estimasi & harga borongan | Estimate renovasi / RAB borongan rumah, drywall, listrik, taman |
| **Daily Field Report / Laporan Harian** | **Skema JSON `strict: true` siap (`EN` & `ID`)** (tidak diklaim jadi di video) | Tiap hari proyek berjalan | Volume terpasang, cuaca, tenaga, material, kendala |
| **Change Order / Berita Acara** | **Skema JSON `strict: true` siap (`EN` & `ID`)** (tidak diklaim jadi di video) | Serah terima, perubahan pekerjaan (CCO), pembayaran | Kesepakatan tambahan (*verbal change order*), tukar guling volume |
### Yang sengaja tidak dibuat (MVP)

Dilarang atau di luar cakupan: saran medis, RAG dasar, penganalisa gambar, chatbot edukasi,
penyaring lamaran, coach gizi, analisa kepribadian, olahraga, politik, perang. Suara Lapangan
tidak menyentuh satu pun.

Juga di luar MVP: akuntansi/pajak, penjadwalan, marketplace tukang, aplikasi pesan, dan review
desain gambar.

## 4. Pengguna target

**Pengguna utama (Pasar Global & Lokal) — Kontraktor kecil, *handyman / remodeler*, dan mandor borongan kecil (1–5 orang).**
- **Segmen Global (`Native English`):** *Independent contractors, remodelers, electricians, plumbers, landscapers* yang bekerja di lokasi klien dengan sarung tangan dan sering kehilangan tagihan akibat *unbilled verbal change orders* atau estimasi yang tertunda.
- **Segmen Indonesia (`Bahasa Indonesia` + Aksen Daerah):** Mandor dan tukang borongan renovasi/bangun rumah yang sehari-hari memakai WhatsApp, berbicara Indonesia beraksen daerah bercampur istilah teknis Inggris dan sesekali kata Jawa murni.

**Pengguna sekunder — Pemilik usaha konstruksi/renovasi kecil (2–5 kru lapangan)** di pasar global maupun Indonesia yang menagih ke klien dan paling terasa rugi ketika catatan volume/perubahan harga tidak terdokumentasi.

**Bukan pengguna MVP:** kontraktor besar (punya admin dan sistem sendiri), BUMN, dan proyek
infrastruktur.

## 5. Metrik kesuksesan (target NEXUS-Sprint)

| Metrik | Target | Cara mengukur |
|---|---|---|
| Time-to-document | Median < 90 detik dari selesai ucap ke dokumen siap kirim | Log timestamp per tahap |
| Kelengkapan tanpa edit manual | ≥ 70% dokumen terkirim tanpa mengubah field kritis (nomor, tanggal, jumlah uang) | Event `doc_sent` vs `field_edited` |
| Akurasi urai uang & volume | ≥ 95% dari 30 rekaman uji lapangan cocok dengan dokumen acuan | Lembar verifikasi manual |
| Pengguna aktif pertama | ≥ 10 mandor nyata membuat dokumen dalam 72 jam setelah rilis | Analitik produk |
| Retensi 7 hari | ≥ 40% pengguna hari-1 membuat dokumen lagi di hari-7 | Kohort |
| Uptime minggu pertama | > 99% | Monitor uptime |
| Umpan balik | ≥ 50 respons dalam 2 minggu | Formulir dalam aplikasi |

**Ambang "berhasil di hackathon":** demo 3 menit yang berjalan tanpa jeda teknis, menggunakan
rekaman asli pekerja lapangan (bukan aktor), dan keluaran dokumen diverifikasi manusia lapangan.

## 6. Asumsi kunci yang harus diuji, bukan diasumsikan

| # | Asumsi | Uji termurah | Kapan |
|---|---|---|---|
| A1 | Ucapan **Native English** (kontraktor global) maupun **Indonesia beraksen daerah** (ditambah istilah Inggris) terbaca cukup akurat untuk mengambil makna (angka, dimensi, lokasi) | Set uji rekaman `Native English` (WER ≤ 10%) + 10–15 rekaman 60 detik Indonesia beraksen (WER bagian Indonesia ≤ 15% **dan** makna tertangkap ≥ 90%) | Gate 1 (GD2 / Minggu 2) — **bisa STOP / Pivot Segmen** |
| A2 | Muse Spark 1.3 memetakan transkrip bebas ke field dokumen dengan akurasi ≥95% pada hal beruang | 30 transkrip + dokumen acuan buatan mandor | Gate 2 (akhir Minggu 3) |
| A3 | Mandor mau memakai suara di depan klien (tidak malu) | 5 wawancara + 1 sesi bayangan di lokasi | Gate 0 / Gate 1 (Minggu 1–2) |
| A4 | Dokumen yang dihasilkan diterima klien tanpa revisi format | 3 dokumen dikirim ke 3 klien nyata, catat komentar | Gate 3 (awal Minggu 4) |
| A5 | Kata Jawa murni cukup jarang sehingga konfirmasi manual tidak membebani | Hitung porsi kata Jawa murni per 100 kata dari 15 rekaman; bila > 15%, alur konfirmasi dievaluasi ulang | Gate 1 (Minggu 2) |

## 7. Batas teknis terverifikasi (dari dokumentasi resmi Meta Model API)

Fakta ini yang membentuk arsitektur, bukan tebakan:

- Voice Transcribe: `muse-voice-transcribe-1.0`, realtime `wss://api.meta.ai/v1/asr/realtime`
  (autentikasi via handshake, bukan header), file `POST /v1/asr/transcribe` (WAV mono 16-bit PCM
  **16 kHz tunggal** di semua jalur, maksimum 10 menit / ±19,2 MB, jauh di bawah batas 32 MB).
- Mode: `PUSH_TO_TALK`, `ENDPOINTING`, `DIARIZATION`. Diarization menandai kandidat pembicara baru,
  bukan endpoint bersih — tidak cocok untuk kontrol latensi rendah.
- Timestamp hanya per giliran bicara (`startMs`, `endMs`). Tidak ada timestamp per kata, tidak ada
  deteksi emosi, tidak ada deteksi suara latar. Tidak ada deteksi suara latar berarti bising
  lokasi harus ditangani di sisi klien (headset/penjepit mic), bukan di model.
- **Bahasa code-switching yang didukung: 25 bahasa, termasuk `English`, `Indonesian`, dan `Malay`.
  Bahasa daerah seperti Jawa tidak ada dalam daftar.** Konsekuensinya: produk mendukung penuh **Native
  English** (untuk pasar global & juri internasional Meta Hackathon) dan **Bahasa Indonesia** (termasuk
  code-switching EN+ID). Untuk ucapan Indonesia beraksen daerah, kata daerah murni ditandai dan
  dikonfirmasi; bila aksen daerah merusak bagian Indonesianya di Gate 1 (>25% WER), jalur bahasa
  Indonesia beraksen dihentikan/dipivot ke segmen standar sementara jalur Native English tetap berjalan.
- Sesi realtime maksimum 60 menit, tanpa resume token; harus menyambung ulang dan menempelkan hasil.
- Harga transkripsi $0,18 per jam audio. Muse Spark 1.3 $1,25/1 juta token masuk, $4,25 keluar.
  Kredit $150 ≈ 800+ jam audio, artinya kredit bukan penghalang pada skala MVP.
- Structured output: Responses API `text.format: { type: "json_schema", strict: true }` (bukan
  `response_format` Chat Completions) memaksa decoding agar keluaran valid menurut skema. Skema rekursif ditolak.

## 8. Setiap orang yang keluar dari sesi ini tahu

- Yang dibuat adalah dokumen resmi siap kirim (**English `Quotation / Estimate`** & **Indonesian
  `Surat Penawaran`**), bukan transkrip mentah.
- Mendukung penuh **Native English** (pasar global Meta Hackathon) dan **Bahasa Indonesia**, namun
  bukan "mengerti bahasa Jawa": kata daerah murni di luar 25 bahasa resmi ditandai tidak pasti lalu
  dikonfirmasi ke pekerja. Jangan janjikan bahasa Jawa di UI, README, atau video.
- Tanpa sinyal, catatan tetap tersimpan di perangkat (unggah tertunda). Tidak ada klaim transkripsi
  offline di ponsel. Muse Glimmer hanya jalur "Best Open Weight" di satu laptop, dan sampai diuji
  dengan angka statusnya **dirancang**, bukan berjalan.
- Kalender aktif menuju submit adalah **Gate Harian GD1–GD4 (tenggat internal: Selasa 3 Nov 2026,
  16:59 UTC / 23:59 WIB)**; tangga Gate Minggu 1 sampai Minggu 6 adalah peta jalan pasca-hackathon.
