# Suara Lapangan — Rencana Video Demo 3 Menit

Video adalah 25% nilai hackathon. Prinsipnya: **tunjukkan masalah, lalu biarkan produk bekerja
di waktu nyata, lalu akhiri dengan dokumen yang keluar.** Jangan menampilkan slide, animasi
fitur yang tidak ada, atau angka yang tidak bisa dibuktikan.

---

## Aturan yang tidak dilanggar

1. **Rekaman asli.** Suara dan gambar dari lokasi sungguhan dengan pekerja sungguhan (izin
   tertulis). Kalau aktor terpaksa dipakai, katakan di layar.
2. **Tidak ada layar palsu.** Setiap UI yang tampil adalah aplikasi nyata yang dijalankan.
3. **Waktu nyata dipertahankan.** Potongan versi cepat ditandai ("2×") atau dihapus. Menyunting
   hasil untuk menutupi kegagalan adalah pelanggaran.
4. **Teks di layar.** 70% penonton menonton tanpa suara. Jangan andalkan sulih suara saja.
5. **Bahasa (Pasar Global Meta Hackathon).** Subjudul/teks layar menggunakan **Bahasa Inggris yang jelas**
   agar juri internasional memahami seluruh alur tanpa suara; demo menampilkan dukungan penuh **Native
   English (`Quotation / Estimate` dalam USD)** sekaligus **Bahasa Indonesia beraksen daerah (`Surat
   Penawaran` dalam IDR)**.

## Tampilan

| Aspek | Nilai |
|---|---|
| Durasi | 2:50–3:00 (batas keras 3:00) |
| Resolusi | 1920×1080, 30 fps |
| Rasio | 16:9 untuk juri; potongan 9:16 (60–90 detik) untuk langsung sosial |
| Subjudul | Tertanam di video (bukan bergantung pada platform) |
| Musik | Latar minimal, -22 LUFS, tanpa musik di bagian dialog lapangan |

---

## Papan cerita

### 0:00–0:15 — Masalah (15 detik)

**Gambar:** tangan bersarung, plester di dinding, ponsel di saku. Cahaya siang penuh.
Teks layar: *"Mandor tidak mengetik. Tangannya sibuk."*

**Sulih suara:** "Setiap hari, catatan pekerjaan hilang antara lokasi dan kantor. Volume tidak
tercatat. Kesepakatan tambahan tidak tertulis. Yang tersisa hanya ingatan, besok pagi."

*Pilihan: satu kalimat pengguna asli diambil dari wawancara, disulih dengan suara aslinya.*

### 0:15–0:25 — Produk (10 detik)

**Teks layar (EN):** *Suara Lapangan — Speak on site with gloves on, get an official client-ready PDF (`Native English` & `Indonesian`).*

**Gambar:** layar aplikasi satu tombol yang benar-benar berjalan (bukan prototipe mock `app.js`), menampilkan pilihan bahasa `EN` / `ID`.

### 0:25–1:35 — Demo utama: 1 Alur Dokumen Penuh Dwibahasa (`Quotation` [EN] & `Surat Penawaran` [ID], 70 detik, waktu nyata)

Satu sesi utuh dari aplikasi nyata yang merekam mikrofon (`getUserMedia`), membuktikan produk untuk pasar global dan lokal:

- **0:25–0:50 — Sesi 1 (`Native English` — Pasar Global):**
  - Tekan tombol rekam (`EN`); pekerja berbicara dalam bahasa Inggris:
    *"Drywall installation living room, twenty-four square meters at twenty-five dollars per square meter... plus five recessed light points, agreed price eight hundred dollars."*
  - Sistem mengekstrak item, mengikat setiap angka ke `sumber_kutipan` (`turn_1`, giliran dari `turns[]` Meta), menghitung otomatis `amountInWords()` di server, dan merender PDF resmi **`Quotation / Estimate` (USD)** dengan nomor dokumen dari server.
- **0:50–1:20 — Sesi 2 (`Bahasa Indonesia Beraksen Daerah` + Bukti 20 Detik "Kontrol, Bukan Keajaiban"):**
  - Mandor berbicara sambil bekerja: *"Plester dinding ruang tamu dua puluh empat meter persegi, harga enam puluh lima ribu per meter... tambah pasang titik lampu lima titik, harga delapan ratus ribu..."*
  - *(Catatan jujur: jalur utama memakai REST `ENDPOINTING` (`turns[]` Meta) — bukan streaming, jadi jangan gunakan kata "real-time/langsung" di layar maupun sulih suara).*
  - **Bukti Guard Angka §B2:**
    1. Nomor dokumen buatan server berubah tiap dokumen (bukan hardcoded `app.js:9`).
    2. Satu field meragukan (`ratus` vs `puluh` atau kata daerah) tertahan di `butuh_konfirmasi`, terhubung ke kutipan suara asal (`turn_1`), dan diselesaikan 1-ketuk.
    3. Satu percobaan angka tanpa sumber di transkrip **ditolak otomatis oleh Guard Angka §B2** (dokumen ditahan pada `perlu_konfirmasi`).
- **1:20–1:35** PDF **`Quotation` (EN)** dan **`Surat Penawaran` (ID)** tampil berdampingan: kop perusahaan, nomor dokumen server, tabel volume & harga, `amountInWords()` / `terbilang()` dari server, tanda tangan. Tekan Share.

**Teks layar di sini:** *"Voice → Citation-Locked Number Guard (`EN` & `ID`) → Official Client PDF."*

### 1:35–2:05 — Cakupan Dokumen Jujur (30 detik)

Tampilkan secara jujur:
- **1 Alur Dokumen Penuh E2E yang berjalan (`EN` & `ID`):** **Quotation / Estimate (USD)** & **Surat Penawaran / RAB (IDR)** (tampilkan PDF nyatanya).
- **2 Skema JSON `strict: true` yang sudah siap di kontrak untuk tahap berikutnya (`EN` & `ID`):** **Daily Field Report / Laporan Harian** dan **Change Order / Berita Acara CCO** (tampilkan skema terkonstrainnya, **jangan diklaim ketiganya sudah jadi**).
Teks layar: *"1 full E2E document (`Quotation` / `Surat Penawaran`) + 2 strict JSON schemas ready."*
### 2:05–2:35 — Bukti, bukan klaim (30 detik)

Ini bagian yang membedakan dari demo biasa. Tampilkan hanya yang sudah terbukti nyata:

- **Layar evaluasi (HANYA bila lembar evaluasi nyata sudah diukur saat rekaman):** tampilkan angka
  WER apa adanya dari lembar acuan. **Dilarang keras menampilkan layar "WER 30 rekaman", "akurasi ≥95%",
  atau "0 angka karangan" bila pengukuran belum selesai.**
- **Demo sinyal buruk** (`O1`, unggah tertunda — hanya bila direkam dengan mode pesawat nyata): mode
  pesawat di ponsel, satu catatan direkam dan tetap tersimpan di IndexedDB; sinyal kembali dan
  dokumennya terbentuk. Teks layar: *"Catatan tersimpan tanpa sinyal; dokumen dibuat saat sinyal kembali."*
- **Muse Glimmer (`O2`) DILARANG disebut atau ditampilkan** di video maupun sulih suara selama belum
  ada bukti waktu proses dan rekaman asli (statusnya tetap **"dirancang"** di dokumen).
- **Jujur soal cakupan bahasa**: satu baris teks — *"Full native support for `English` & `Indonesian` (both in Muse Voice Transcribe's 25 languages). Unrecognized regional words (e.g., pure Javanese) are flagged for worker confirmation — never guessed."*
  Kejujuran ini menambah kepercayaan juri global.

### 2:35–2:55 — Pengguna nyata (20 detik)

Rekaman uji lapangan: mandor memakai aplikasi untuk pertama kali, bereaksi setelah melihat PDF.
Suara asli diutamakan. Teks layar: jumlah pengguna yang mencoba, jumlah dokumen yang dibuat.

### 2:55–3:00 — Penutup (5 detik)

Teks layar: logo, tautan repo publik, satu kalimat —
*"Catatan lapangan tidak lagi menunggu besok pagi."*

---

## Produksi

| Tahap | Kapan (Kalender Aktif GD1–GD4) | Pemilik |
|---|---|---|
| Rekaman lokasi mentah + spesifikasi variabel template PDF (`K6`) | **Hari 1 (29 Okt — GD1)** | D |
| Rekaman layar alur nyata E2E (`Surat Penawaran` + Guard §B2) | **Hari 2 (30 Okt — GD2)** | D dibantu A & B |
| **Versi 1 (≤ 3:00, tanpa layar palsu) + tontonan uji 3 orang non-teknis** | **Hari 3 (2 Nov — GD3)** | D |
| **Versi final terkirim bersama repo (sebelum 16:59 UTC / 23:59 WIB)** | **Hari 4 (3 Nov — GD4)** | D + Pemilik |
## Pemeriksaan sebelum serah

- [ ] Durasi ≤ 3:00; tidak ada bagian yang terasa menunggu.
- [ ] Menonton tanpa suara tetap paham alurnya.
- [ ] Setiap angka di layar dapat dibuktikan dari dokumen evaluasi.
- [ ] Tidak ada UI/animasi yang tidak ada di produk.
- [ ] Nama produk terdengar sama di sulih suara dan teks.
- [ ] Tidak muncul data pribadi klien asli tanpa izin (nama, alamat, nomor).
- [ ] Ada versi 9:16 untuk sosial.
- [ ] Mematuhi 9 larangan klaim (`docs/audit/KEPUTUSAN-ADR.md` §4): tidak mengklaim "mengerti Jawa", tidak mengklaim "3 dokumen berfungsi", tidak mengarang statistik WER/akurasi, tidak mengklaim transkripsi offline di ponsel, tidak menyebut Glimmer, tidak mengklaim PDF `<50 ms`, tidak mengklaim APK Android, tidak memakai rekaman prototipe mock `app.js`, dan tidak memakai kata "real-time/langsung" bila memakai jalur REST segmen.
