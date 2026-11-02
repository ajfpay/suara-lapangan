# C — Nilai Hackathon: Rubrik, Waktu, dan Klaim vs Bukti

**Penilai:** c-nilai (juri hackathon + PM yang pernah gelar demo). **Tanggal:** 28 Okt 2026.
**Sumber aturan:** [meta-hackathon.md](file:///home/ubuntu/.dsh/attachments/v1/files/c0/c0ca6042509676889f85a6cf7f428db8fd16eb1bc3539af4b0f9ed613669856c/meta-hackathon.md) §4, §7, §8.

**Kesimpulan satu baris:** rancangan nilai **untuk juri** masih 0, karena belum ada kode, repo, maupun video.
Skor di bawah = **potensi bila demo 3 menit dibuktikan pada 27 Jan**, bukan skor hari ini.

---

## 1. Apakah 4 ADR menaikkan skor? Skor per kategori

Jawab contoh: ADR-0002 (guard kutipan) **menaikkan** Technical Depth, tapi **tidak menaikkan** Impact;
ADR-0003 Typst **tidak menaikkan** skor apa pun yang bisa dipamerkan dalam 3 menit — ia hanya menurunkan risiko.

| Kategori (bobot) | Skor | Alasan (2 kalimat) | Perubahan ADR yang menaikkan skor |
|---|---|---|---|
| **Impact** (30%) | **5** | Masalahnya nyata dan spesifik (volume/kesepakatan lisan hilang → invoice kurang bayar), cocok penuh dengan "Build for Your World" §1. Namun bukti pengguna **nol**: Gate 0 mensyaratkan ≥3 dari 5 wawancara (`03-GATE-GO-NO-GO.md:18`), statusnya belum dijalankan, sehingga impact masih pernyataan dokumen. | Ganti target tambal-sulam **nominal** dengan **satu angka uang**: "rata-rata Rp X per proyek hilang karena volume tidak tercatat, dari N wawancara". Pastikan pesannya "kembalikan uang yang sudah jadi hak pekerja", bukan "hemat waktu admin". |
| **Use of Meta AI Tooling** (25%) | **6** | Voice Transcribe + Spark 1.3 (`json_schema`) + guard server sedikit **di atas integrasi dasar**, asalkan guard itu jalan di demo. Tetapi saat ini ADR tidak memakai satu pun fitur yang juri akan ingat — `mode: ENDPOINTING` (`01-ARSITEKTUR.md:62`, `:92`) justru membuang nilai `DIARIZATION` yang mampu membedakan 20+ pembicara ([pricing & feature resmi](https://dev.meta.ai/models/muse-voice-transcribe)) — padahal Berita Acara CCO selalu dua pihak, dan bagian itu yang dianggap "berani". | ADR-0002 tambah keputusan: **wajib ada 1 klip `mode: DIARIZATION`** untuk Berita Acara (siapa setuju apa), tampilkan label pembicara di kartu konfirmasi. Lalu tunjukkan **guard menolak angka** di layar. |
| **Technical Depth & Execution** (20%) | **4** | Rancangannya serius (skema tervalidasi, nomor dokumen dari server, `typing` kontrak di `01-ARSITEKTUR.md`), tapi kode belum ada (`README.md:10-12`). Typst, Capacitor, IndexedDB (`adr-decisions.md:25-34`) semuanya **di luar** yang dibutuhkan demo 3 dokumen dalam 5 hari. | Buang Typst & Capacitor dari jalur demo. Satu keputusan teknis yang tampil: **skema + guard deterministik + nomor dokumen dari server**, diperlihatkan dengan 1 transkrip sengaja cacat. |
| **Demo** (25%) | **3** | Video belum ada dan jadwalnya Minggu 4 (`04-RENCANA-VIDEO-DEMO.md:104-108`), padahal deadline 27 Jan. Prototipe yang ada masih **UI lokal tanpa model** (`app.js:1-4`), sehingga bila direkam apa adanya, itu **layar palsu** menurut aturan mereka sendiri (`04-RENCANA-VIDEO-DEMO.md:12-15`) **dan** melanggar §4 guide ("demo must only highlight what you built"). | Video diproduksi **25–26 Jan** dari **aplikasi sungguhan**. Satu take di lokasi + edit ringan. Tanpa layar mock. |

**Angka:** rata-rata berbobot = 0,30·5 + 0,25·6 + 0,20·4 + 0,25·3 = **4,65 / 10** → belum layak top-5 dari 5 per track.
Naik ke **6,5–7** hanya bila item §3 di bawah benar-benar dibuktikan.

---

## 2. Waktu: sisa 5 hari kerja, bukan 6 minggu

Hari ini **Rabu 28 Okt 2026** (2026-10-28 UTC). Deadline **27 Jan 2027 21:00 EST** = **28 Jan 02:00 UTC**.
Sisa hari kerja (Sen–Jum): Kam 29, Jum 30, Sen 2, Sel 3, Rab 4 = **5 hari** (Sab 31 & Min 1 = 2 hari libur).

Bertentangan langsung dengan dokumen:

- `03-GATE-GO-NO-GO.md:9-10` — *"ritme gate adalah minggu… Deadline hackathon tidak menggeser gate menjadi hitungan hari."*
- `02-PEMBAGIAN-KERJA.md:12-17` — tabel Minggu 1–6; video baru jadi **hari ke-2 Minggu 4** (`04-RENCANA-VIDEO-DEMO.md:106`).
- `04-RENCANA-VIDEO-DEMO.md:76` mewajibkan layar WER dari **30 rekaman lapangan**. Anda punya ≤4 hari untuk merekam + transkrip acuan manual + ukur WER. Tidak realistis.

**Yang harus ditulis ulang (bukan opsional):**
1. `03-GATE-GO-NO-GO.md` — tambahkan **Gate D** (tanggal tetap): Kam (21 Jan) satu uji API nyata + repo publik ≥5 commit bertanggal; Sen (25 Jan) satu dokumen keluar dari API ke PDF; Sel (26 Jan) video mau; Rab (27 Jan) kirim ≤18:00 UTC (**buffer 8 jam**, jangan 21:00).
2. `02` & `03` — tandai rencana 6 minggu sebagai **setelah hackathon**; untuk hackathon pakai "cutting line": wajib = satu jalur ASR→skema→PDF untuk **satu** jenis dokumen; opsional = kartu konfirmasi; jangan dibangun = Glimmer, O2, Capacitor, Auth/DB produksi, Laporan Harian + Berita Acara.
3. `04-RENCANA-VIDEO-DEMO.md:76` — ganti "30 rekaman" dengan angka yang benar-benar ada, atau hapus layar evaluasi.

Catatan risiko (bukan salah dokumen): guide menyebut "Building period: Oct 27 – Nov 4 **2027**" (§3) tapi deadline "Nov 4 2026 9:00 PM" (§3, §7). Semua dokumen proyek memakai 2026. **Kirim 27 Jan 2027**; itu pilihan yang aman.

---

## 3. Klaim yang tidak bisa dibuktikan dalam 3 menit / bertentangan dengan sumber

| # | Klaim di dokumen | Bukti/keadaan | Putuskan: perbaiki bukti atau klaim ulang |
|---|---|---|---|
| K-1 | "Tiga jenis dokumen MVP" (`00-RINGKASAN-PRODUK.md:51-57`, `04:66-70`) | Prototipe `app.js` hanya membuat **Surat Penawaran**; kata "Laporan Harian"/"Berita Acara" **tidak ada** di `app.js` | Klaim ulang: "satu dokumen penuh + dua skema siap". Jangan tampilkan 3 dokumen di video kecuali 3-nya jalan. |
| K-2 | Nomor dokumen resmi "014/SP/CV-SJ/X/2026" (`app.js:9`) | **Hardcoded**; `01-ARSITEKTUR.md:64` D6 bilang nomor dibuat server | Perbaiki: tampilkan server menghasilkan nomor (mis. `SL/SP/2026-11-04/001`), dan tunjukkan nomor itu berubah tiap dokumen. |
| K-3 | "Tidak ada angka karangan; sistem bertanya saat ragu" (`README.md:42-43`) | Prototipe: field kosong **tidak pernah** muncul; yang ada hanya 2 pilihan di satu token (`app.js:171`, `:231`) | Perbaiki demo: satu field **kosong sungguhan** + sistem bertanya + jawaban satu kalimat. Ini bukti 15 detik paling kuat. |
| K-4 | "Unggah tertunda / catatan tersimpan tanpa sinyal" (`00:134`, `01:178`) | Belum ada antrean IndexedDB; opsional untuk 3 menit | **Jangan klaim** kecuali direkam mode pesawat nyata (`04:78-80`). Kalau direkam, pamerkan juga batasnya. |
| K-5 | "Muse Glimmer jalur Best Open Weight" (`README.md:34`) | Status "dirancang" sudah jujur. Model Glimmer **nyata** (30B, Apache-2.0, [docs resmi](https://dev.meta.ai/docs/muse-glimmer/)) — jadi secara teknis mungkin, tapi sah **hanya** bila dijalankan di hardware sendiri/partner inference (bonus $10K, [guide §9](file:///home/ubuntu/.dsh/attachments/v1/files/c0/c0ca6042509676889f85a6cf7f428db8fd16eb1bc3539af4b0f9ed613669856c/meta-hackathon.md)) | **Jangan tayangkan** di video; sebut satu baris lisan pun berisiko. Fokus bonus ke **Best Agentic Use-Case $5K** (ASR→ekstraksi→guard→dokumen = rantai multi-langkah), bukan ke Open Weight. |
| K-6 | Layar WER 30 rekaman (`04:76-77`) | Tidak ada rekaman, tidak ada WER; baru uji di Gate 1 (Minggu 2, `03:31-49`) | Hapus dari video. Ganti dengan **1 klip uji kecerdikan**: angka salah dibaca model → guard menangkap. Itu "bukti, bukan klaim" versi jujur. |
| K-7 | Latensi typst "<50 ms" (`adr-decisions.md:27`) | Belum diukur di server mereka | Klaim ulang "render <1 detik" atau ukur sendiri. |
| K-8 | Judul video memakai istilah "mandor/mandor nyata" (`04:88-91`) | Guide §4: demo hanya fitur yang dibuat 19 Jan–27 Jan | Tulis di layar: "UI dan prototipe dokumen dibuat 28 Okt; integrasi model ditambahkan 29 Okt–3 Nov". Tanpa itu, risiko **diskualifikasi**. |

**Temuan tambahan (penting untuk demo):** primitif "guard angka" di ADR-0002 punya celah yang mudah diserang juri —
angka **komposit** ("dua puluh empat") bila model menulis `24`, dan **angka turunan** (total = 240.000 + 800.000)
tidak muncul literal di transkrip. Demo harus memakai aturan: setiap angka **atau** komponen penjumlahnya
harus tertelusur, dan angka turunan diberi label **"dihitung"** dengan rumus tampil. Tanpa ini, juri teknis
akan bertanya "berapa persen jaminan?" dan jawabannya tidak ada.

---

## 4. Anti-project §4, dan dua problem statement

**Apakah masuk anti-project? Tidak.** Daftar larangan guide (§4) menyebut medis, RAG dasar, penganalisa gambar,
chatbot edukasi, penyaring lamaran, coach gizi, analisa kepribadian, olahraga/coach, politik/perang. Suara
Lapangan tidak menyentuh satu pun; ia sistem dokumen untuk pekerjaan konstruksi kecil. Tidak ada masalah "kode
tanpa hak" di ADR: Typst Apache-2.0, Capacitor MIT, zod MIT — dan ADR sudah membuang `ricky0123/vad` karena
lisensi `NOASSERTION` (`adr-decisions.md:13`). Itu keputusan yang benar.

**Problem statement:**
- **"Build for Your World" — YA, kuat.** Masalah nyata di Indonesia, solusi jelas, bukan alat umum. Ini jalur
  menarik proyek supaya lolos Stage One.
- **"Push the Frontier" — sebagian.** Memahami ucapan beraksen daerah untuk menghasilkan dokumen resmi itu
  menarik, tapi tidak ada "new capability for a machine" yang benar-benar baru. Jangan pakai frama ini; klaim
  "Build for Your World" saja.

**Syarat lolos Stage One yang paling berisiko, bukan rubrik:** repo **publik**, video **3:00**, dibuat dalam
jendela 19 Jan–27 Jan. Hari ini repo proyek **belum ada** (`README.md:10-12`, `03:205`, `05:141`). Gagal di salah
satu dari tiga = tersingkir **sebelum** dinilai. Ini pekerjaan hari ini, bukan minggu depan.

---

## 5. Tiga hal yang paling menaikkan skor, urut dampak (untuk 5 hari ini)

1. **Hari ini: buat repo publik + uji satu panggilan API nyata** (transkrip 20 detik + satu dokumen JSON →
   PDF). Tanpa ini skor = 0, berapa pun bagusnya ADR.
2. **Demo yang membuktikan kontrol, bukan keajaiban:** satu field kosong → sistem bertanya → pekerja mengucap
   satu kalimat → angka muncul. Lalu satu angka salah dibaca → guard menolak. Dua momen ini, ~20 detik, lebih
   bernilai daripada semua slide arsitektur.
3. **Video direkam Selasa 26 Jan dari aplikasi yang benar-benar berjalan**, bukan dari prototipe mock. Prototipe
   mock boleh dipakai **hanya** kalau dilabeli "mock" di layar — dan itu tetap mengurangi skor Demo.
