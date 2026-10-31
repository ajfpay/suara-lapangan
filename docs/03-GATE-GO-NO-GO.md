# Suara Lapangan — Gate Go/No-Go per Fase

Runbook NEXUS-Sprint dipakai apa adanya: gate tidak dilewati untuk menghemat waktu. Setiap gate
punya **bukti yang harus ada**, **pemutus**, dan **pilihan bila gagal**. Keputusan dicatat di
bagian akhir dokumen.

Ambang di bawah sengaja numerik. "Kelihatannya sudah bagus" bukan lulus.

**Dua kalender yang dibedakan secara tegas (Putusan Gate Pra-Implementasi 28 Okt 2026):**
1. **Kalender Aktif Hackathon (Gate Harian GD1–GD4 menuju Sel 3 Nov 2026, 16:59 UTC / 23:59 WIB):**
   mengikat seluruh pekerjaan 5 hari kerja menuju submit tanpa melonggarkan ambang numerik maupun
   disiplin **STOP 24 jam di Gate 1**.
2. **Tangga Gate Minggu 1–6 (G0–G5):** dipertahankan utuh sebagai **peta jalan pasca-hackathon** dan
   rujukan ambang kualitas/tata kelola STOP.

---

## GATE PRA-IMPLEMENTASI — Putusan Juri Arsitektur & Studio Producer (28 Okt 2026)

**Vonis Resmi:** **`GO BERSYARAT (DENGAN REVISI KONTRAK K1–K7)`**  
**Pemutus:** Studio Producer bersama Software Architect (Juri Utama) — lihat laporan lengkap di `docs/audit/KEPUTUSAN-ADR.md` §6.

### Amendemen Kalender Aktif Hackathon: Gate Harian (GD1–GD4)

| Hari | Gate Harian | Bukti Lulus Wajib | Tindakan Bila Gagal |
|---|---|---|---|
| **Hari 1 (Kam, 29 Okt)** | **GD1 — Bukti Nyata & Kontrak K1–K7** | (1) Kontrak K1–K7 dibekukan di repo, (2) Uji 10 dtk PCM **16 kHz** ke endpoint berhasil, (3) **1 transkrip 20 detik dari API sungguhan (`Native English` & `Bahasa Indonesia`) → JSON → PDF (`Quotation` / `Surat Penawaran`)** | Bila belum ada 1 panggilan API nyata atau butir 1–4 Pre-Flight Checklist gagal pada akhir Hari 1 → **NO-GO otomatis**, laporkan ke pemilik produk |
| **Hari 2 (Jum, 30 Okt)** | **GD2 — Alur E2E & Guard Angka §B2** | Rekam native 16 kHz → REST `ENDPOINTING` (`turns[]` Meta → giliran `turn_N`) → `Spark 1.3` + Guard §B2 (`EN` & `ID`) → PDF bernomor server (pipeline Chromium); **1 angka salah terbukti ditolak otomatis** (`butuh_konfirmasi`); evaluasi G1 dipercepat (`Native English` + 10–15 rekaman `Indonesia beraksen`) | Bila WER bagian Indonesia > 25% → **jalankan prosedur STOP/Pivot 24 jam Gate 1** (pemilik memilih A/B/C; jalur `Native English` tetap berjalan) |
| **Hari 3 (Sen, 2 Nov)** | **GD3 — Video Demo v1 (25% Nilai)** | Video v1 ≤ 3:00 selesai dari aplikasi nyata (mendemokan `Native English` untuk juri global + `Indonesia beraksen`, tanpa layar mock `app.js`), ditonton 3 orang non-teknis | Hentikan seluruh pekerjaan fitur/WSS; 100% tim fokus memperbaiki alur yang tampil di video |
| **Hari 4 (Sel, 3 Nov ≤16:59 UTC)** | **GD4 — Submit Terkunci (23:59 WIB)** | Repo publik (dengan izin tertulis pemilik), README bertanda "dibuat 27 Okt–4 Nov", daftar lisensi paket terverifikasi, video + formulir submission terkirim **9 jam sebelum batas resmi** | — |

### Pre-Flight Checklist (7 Butir Wajib Sebelum Baris Kode Pertama)

| # | Tindakan Wajib | Pemilik | Batas Waktu |
|---|---|---|---|
| 1 | Seragamkan **16 kHz s16le mono PCM** di seluruh dokumen & kode; buang `extendable-media-recorder`; **jalur utama = REST `ENDPOINTING`** (`turns[]` Meta → `turn_N`; proxy WSS ditangguhkan, bukan syarat submit); bekukan `Typst` (pakai pipeline `invoify`: HTML + CSS cetak → Chromium → `page.pdf()`; `@react-pdf/renderer` hanya fallback; hapus klaim `<50 ms`); tangguhkan `Capacitor` ke pasca-hackathon | B + C | Hari 1 pagi |
| 2 | Bekukan **Kontrak K1–K7** (`contracts/api.json`, `contracts/document.schema.json` tunggal, fixture 30 transkrip + 10 transkrip cacat sengaja, mock server B, spesifikasi variabel template PDF D, isolasi FK `turnId` & hard-stop kuota) | B, C, D | Hari 1 pagi |
| 3 | Tegaskan kalender aktif **GD1–GD4 (tenggat 3 Nov 16:59 UTC)** dan tandai kalender Minggu 1–6 sebagai pasca-hackathon | Pemilik + Studio Producer | Hari 1 pagi |
| 4 | Selaraskan klaim materi: **1 alur dokumen penuh dwibahasa (`Quotation / Estimate` [EN] & `Surat Penawaran` [ID]) + 2 skema JSON siap (`Daily Field Report / Laporan Harian`, `Change Order / Berita Acara`)**; hapus klaim yang belum diukur ("3 dokumen berfungsi", "WER 30 rekaman", "0 angka karangan") | D + Pemilik | Hari 1 |
| 5 | Jalankan uji 10 detik PCM 16 kHz ke endpoint ASR sebelum menulis kode; bila 16 kHz ditolak, balik ke 24 kHz dan catat di tabel keputusan di bawah | A + B | Hari 1 |
| 6 | Kunci batas klaim jujur Video 3 Menit (7 klaim boleh, 9 larangan — dilarang kata `"real-time/langsung"` bila memakai REST segmen, dilarang `"mengerti Jawa"`, `"APK"`, atau menyebut `Glimmer`) | D | Sebelum rekam video |
| 7 | **Persetujuan tertulis eksplisit pemilik produk** untuk: (a) pembuatan repo publik `ajfpay/suara-lapangan`, dan (b) deploy produksi di Gate 4. Tidak ada penyiapan diam-diam sebelum izin tertulis turun | Pemilik Produk | Hari 1 (a) · Gate 4 (b) |
---

## GATE 0 — Go/No-Go Konsep (akhir Minggu 1)

| Item | Ambang lulus | Bukti |
|---|---|---|
| Masalah nyata | ≥ 3 dari 5 wawancara menyebut kehilangan catatan/penagihan sebagai kerugian terjadi berulang | Ringkasan wawancara, kutipan |
| Pengguna bisa menjangkau | ≥ 3 mandor bersedia diuji di lokasi dalam 2 minggu | Daftar nama + tanggal |
| Produk bukan di daftar larangan | Tidak satu pun kategori terlarang tersentuh | Checklist cakupan |
| Rekaman uji tersedia | ≥ 10 rekaman asli sudah dikumpulkan | Folder audio + izin |

**Pemutus:** Studio Producer (orchestrator) bersama pemilik produk.

**Bila gagal:** jangan lanjut. Dua pilihan: (a) sempitkan pengguna ke pemilik usaha kecil bangunan
yang sudah punya klien rutin, (b) berhenti dan laporkan — lebih baik daripada 4 minggu mengerjakan
produk yang tidak ada yang menunggu.

---

## GATE 1 — Kelayakan Ucapan Lapangan: `Native English` (Global) & `Indonesia Beraksen Daerah` (Minggu 2 / GD2)

Gate ini menguji dua jalur bahasa yang menjadi fondasi produk di pasar global Meta Hackathon dan pasar lokal:
1. **Jalur Global (`Native English`):** ucapan kontraktor/pekerja lapangan berbahasa Inggris dengan satuan dan istilah teknis konstruksi (`"twenty-four square meters"`, `"eight hundred dollars"`).
2. **Jalur Indonesia (`Bahasa Indonesia beraksen daerah`):** ucapan **Indonesia** dengan aksen Jawa/daerah dan istilah teknis Inggris. Bukan apakah kata Jawa murni keluar utuh, melainkan apakah makna kalimat Indonesianya tertangkap akurat.

| Item | Ambang lulus | Bukti |
|---|---|---|
| **Akurasi ucapan `Native English` (Global)** | **WER ≤ 10%** pada kalimat konstruksi berbahasa Inggris; **≥ 95% makna/angka tertangkap** | Set rekaman uji `Native English`, lembar acuan |
| Akurasi ucapan `Indonesia beraksen` | WER ≤ 15% pada bagian kalimat yang berbahasa Indonesia | 10–15 rekaman, lembar acuan |
| Akurasi token uang/volume (`EN` & `ID`) | ≤ 10% salah pada `"twenty-four square feet"`, `"eight hundred dollars"`, `"dua puluh empat meter persegi"`, `"sembilan ratus ribu"` | Subset token beruang (`USD` & `IDR`) |
| **Makna tetap tertangkap (`ID` beraksen)** | ≥ 90% angka/dimensi/lokasi/waktu pada dokumen acuan berhasil diambil dari rekaman beraksen | Lembar per-field |
| Kata daerah/Jawa murni | Dilaporkan **seadanya**; ditandai tidak pasti lalu dikonfirmasi ke pekerja — tidak diklaim | Contoh kalimat + cara sistem menandainya |
| Latensi giliran | Median < 3 detik dari akhir ucapan ke `speechComplete` | Log 20 giliran |
| Endpointing pada jeda "merenung" | Tidak memotong satu kalimat jadi 3+ giliran lebih dari 1 kali per rekaman | Catatan manual |
| Porsi lokasi tanpa sinyal | Terukur (bukan diasumsikan), ≥ 5 wawancara | Hasil wawancara |

**Pemutus:** C (Model & Data) untuk pembacaan angka; pemilik produk untuk keputusan berhenti.

**Bila gagal:**
- Akurasi 15–25%: lanjut, tapi semua angka wajib dikonfirmasi sekali, dan target akurasi dokumen
  diturunkan; catat sebagai risiko terbuka dengan angka.
- Akurasi > 25% **atau** makna kunci (angka, dimensi, lokasi) gagal diambil pada rekaman beraksen:
  **STOP.** Berhenti, bukan dipaksakan. Artinya aksen daerah merusak bagian Indonesianya juga, dan
  produk ini tidak bisa dijual ke pasar yang dibidik. Laporkan dengan angka, jangan lanjut ke
  Sprint 1. Rencana sesudah STOP ada di §"Bila G1 berakhir STOP" di bawah — bukan improvisasi.
- Latensi > 6 detik: pertimbangkan input file (`/v1/asr/transcribe`) alih-alih realtime; pengalaman
  berubah dari "langsung" ke "beberapa detik", masih dapat diterima.

### Bila G1 berakhir STOP — siapa memutuskan, lalu apa

Gate tanpa rencana sesudahnya akan dilewati orang. Karena itu STOP punya alur tertulis:

**1. Dalam 24 jam setelah angka G1 keluar**
- C menerbitkan lembar evaluasi G1: 10–15 rekaman, WER bagian Indonesia, porsi makna yang
  tertangkap, contoh kalimat yang gagal. Angka apa adanya, tanpa pembulatan yang menguntungkan.
- B menghentikan pekerjaan lanjutan: proxy WSS, pipeline sambung ulang, dan pekerjaan PDF berhenti.
  Yang sudah jalan dibiarkan, tidak ditambah.
- A membekukan workstream: tidak ada shell Android, tidak ada uji lapangan baru, tidak ada
  perekrutan pengguna.
- D membekukan produksi video dan materi klien.
- Studio Producer mengubah status proyek menjadi **STOP** dan menulisnya di puncak README.

**2. Pemutus: pemilik produk.** Bukan tim, bukan aku, bukan mayoritas suara. Pemilik memilih salah
satu dalam **3 hari kerja**:

| Pilihan | Isi | Beban bukti sebelum dipilih |
|---|---|---|
| **A. Fokus Segmen Global (`Native English`) & Indonesia Standar** | Fokuskan rilis utama ke kontraktor berbahasa **Native English** (pasar global Meta Hackathon) serta pengawas/mandor kota yang berbahasa Indonesia standar, di mana akurasi `muse-voice-transcribe-1.0` sudah terbukti tinggi. | Wajib rekam ulang 10 sampel dari segmen tersebut dan capai ambang G1 sebelum lanjut. |
| **B. Ganti jalur input** | Ucapan pendek berstruktur (`keywords` + pilihan field tertutup: bahan, dimensi, lokasi) atau ketik-cepat + koreksi suara, bukan ucapan bebas. | Wajib tunjukkan bahwa makna tertangkap ≥ 90% pada segmen asal dengan jalur baru. |
| **C. Tutup** | Proyek dihentikan. Yang dikirim ke hackathon: dokumen ini, lembar evaluasi G1, dan temuan bahwa aksen daerah merusak ucapan Indonesianya. Bukan demo palsu. | — |

**3. Waktu yang tersisa dipakai untuk apa**
- Minggu 2–3 (sisa): evaluasi ulang segmen atau jalur baru, **hanya** bila pemilik memilih A atau B.
  Batasnya jelas: bila pada akhir Minggu 3 ambang G1 belum tercapai, keputusan jatuh ke C.
- Minggu 4: tidak ada video demo fitur. Yang disiapkan adalah **laporan temuan** — 4–6 halaman,
  berisi angka, rekaman contoh (dengan izin), dan alasan pasar tidak bisa dilayani.
- Minggu 5–6: tidak ada rilis. Tim menutup pekerjaan, mengembalikan kredit yang tidak terpakai, dan
  merilis temuan secara publik bila pemilik setuju. Tidak ada klaim kemenangan.

**4. Yang dilarang setelah STOP**
- Menghaluskan angka supaya gate "lulus".
- Mengganti ambang gate setelah melihat hasil.
- Memakai kata "hampir" atau "sebagian besar berhasil" untuk menutupi STOP.
- Melanjutkan build sambil berharap masalahnya hilang.


Catatan terverifikasi: Muse Voice Transcribe mendukung 25 bahasa dengan code-switching, termasuk
Indonesia, Inggris, Melayu — **Jawa tidak termasuk**. Karena itu produk tidak pernah menjanjikan
"mengerti Jawa"; yang dijanjikan adalah dokumen Indonesia yang benar dari ucapan Indonesia
beraksen, dengan kata Jawa murni yang dikonfirmasi balik.

---

## GATE 2 — Kelayakan Dokumen dan Arsitektur (akhir Minggu 3)

| Item | Ambang lulus | Bukti |
|---|---|---|
| Akurasi field beruang | ≥ 95% cocok pada set 30 dokumen acuan | Lembar per-field |
| Halusinasi angka | 0 kasus mengarang angka | Audit manual seluruh keluaran |
| Butuh konfirmasi bekerja | Semua field kosong terpicu `butuh_konfirmasi`, tidak diisi tebakan | Uji 10 transkrip cacat sengaja |
| Skema valid | 100% keluaran lolos validasi JSON Schema pada 50 percobaan | Log validasi |
| PDF dapat dikirim | 3 klien nyata menerima dan tidak menolak format | Komentar klien |
| Scaffold & infra | Versi publik berjalan di domain, auth, DB, CI — paling lambat akhir Minggu 2 | Tautan + status CI |

**Pemutus:** B (Backend) untuk arsitektur; C untuk dokumen; Project Manager untuk paket arsitektur.

**Bila gagal:** perpendek jenis dokumen — **satu dokumen dulu** (Surat Penawaran) sampai 95%,
daripada tiga dokumen yang semuanya setengah. Ini keputusan Ruang Lingkup Sprint (lihat GATE 3).
*(Konsisten dengan putusan audit 28 Okt 2026 — lihat `docs/audit/KEPUTUSAN-ADR.md` §5.)*

---

## GATE 3 — Kelayakan Lapangan (awal Minggu 4)

Uji dengan orang sungguhan di lokasi, bukan demo.

| Item | Ambang lulus | Bukti |
|---|---|---|
| Dokumen pertama tanpa dibantu | ≥ 4 dari 5 pengguna baru menyelesaikan dalam < 5 menit | Rekaman sesi |
| Dokumen diterima klien | ≥ 2 dari 3 dokumen terkirim tidak ditolak | Tangkapan percakapan |
| Kehilangan audio | 0 sesi kehilangan > 1 detik audio pada 20 sesi | Log klien |
| Tanda tangan/kop diterima | Tidak ada keluhan "ini bukan dokumen resmi" | Catatan uji |
| Catatan tanpa sinyal | Sesi tanpa sinyal tetap tersimpan di perangkat dan selesai saat sinyal kembali | Uji mode pesawat |

**Pemutus:** Reality Checker (oracle), dengan D (desain) sebagai pengamat uji pengguna.

**Bila gagal:** perpanjangan 3 hari, ulang uji dengan 3 pengguna baru. Bila gagal dua kali pada item
"tanpa dibantu", masalahnya hampir pasti alur, bukan model — kembali ke wireframe, bukan tuning prompt.

---

## GATE 4 — Kesiapan Produksi (Minggu 4)

| Item | Ambang lulus | Bukti |
|---|---|---|
| Uptime uji beban | > 99% selama 72 jam | Monitor |
| Latensi p95 | Giliran selesai → dokumen < 12 detik | Data telemetri |
| Video demo | Versi 1 selesai, ≤ 3:00, ditonton 3 orang non-teknis tanpa penjelasan | Tautan video + catatan |
| Keamanan dasar | Kunci hanya di server; audio dihapus setelah 30 hari; batas laju aktif | Daftar periksa |
| Biaya | Rata-rata per dokumen ≤ $0,05; proyeksi 30 hari dalam kredit | Meteran |
| README | Menyatakan apa yang dibuat 27 Okt–4 Nov, apa yang sudah ada sebelumnya | Tautan repo |
| Repo publik | Ada, publik, dapat diakses tanpa login — **dibuat hanya setelah pemilik menyetujui** | Tautan |

**Pemutus:** Reality Checker untuk kesiapan; **Studio Producer bersama pemilik untuk peluncuran.**

Keputusan gate ini: `SIAP`, `PERLU KERJA` (perpanjangan 2–3 hari perbaikan), atau `TIDAK SIAP`.

**Deploy produksi adalah keputusan pemilik produk di Gate 4, dan harus persetujuan eksplisit.**
Tidak ada penyiapan deploy diam-diam: tidak ada domain produksi, kredensial produksi, atau
migrasi database produksi yang disiapkan sebelum persetujuan itu diberikan secara tertulis.

---

## GATE 5 — Rilis & Pertumbuhan (Minggu 5–6)

| Item | Ambang | Bukti |
|---|---|---|
| Pengguna nyata | ≥ 10 mandor membuat dokumen pertama | Analitik |
| Retensi 7 hari | ≥ 40% kembali | Kohort |
| Umpan balik | ≥ 50 respons | Formulir |
| Insiden | Semua insiden tingkat-1 ditangani dalam 24 jam | Log insiden |
| Evaluasi akhir model | Dilaporkan dengan lembar acuan yang sama seperti Gate 1 | Dokumen evaluasi |

---

## Kalender ringkas Pasca-Hackathon (minggu 1–6)
| Minggu | Fase | Gate |
|---|---|---|
| **Minggu 1** | Discovery terkompresi + arsitektur + fondasi | **G0** akhir Minggu 1 (keputusan konsep) |
| **Minggu 2** | Uji kelayakan model + skema dokumen + versi publik | **G1** akhir Minggu 2 (ucapan Indonesia beraksen; bisa berhenti di sini) |
| **Minggu 3** | Sprint 1–2 inti + uji lapangan pertama | **G2** akhir Minggu 3 (dokumen & arsitektur) — boleh menyusul awal Minggu 4 bila G1 baru lulus di akhir Minggu 2 |
| **Minggu 4** | Penguatan + uji lapangan + video 3 menit | **G3** awal Minggu 4 (kesiapan lapangan) dan **G4** akhir Minggu 4 (kesiapan produksi + persetujuan deploy — hanya dengan persetujuan eksplisit pemilik) |
| **Minggu 5** | Rilis + pengguna nyata pertama | — (tanpa persetujuan eksplisit di G4, tidak ada deploy) |
| **Minggu 6** | Iterasi + eval akhir | **G5** akhir Minggu 6 (retensi, umpan balik, evaluasi akhir) |

Catatan urutan: Gate konsep (G0) dan Gate kelayakan model beraksen (G1) **tidak boleh dilewati**.
Kalau G1 berakhir STOP, Minggu 3–6 tidak dimulai — alur dan pemutusnya ada di
§"Bila G1 berakhir STOP" di dalam GATE 1.

---

## Catatan keputusan

| Tanggal | Gate | Keputusan | Alasan | Pemutus |
|---|---|---|---|---|
| 28 Okt 2026 | — | Lingkup: dokumen lebih dulu, implementasi ditunda | Arahan pemilik produk | Pemilik |
| 28 Okt 2026 | — | Repo GitHub publik belum dibuat | Arahan pemilik ("tunggu arahan") | Pemilik |
| 28 Okt 2026 | — | **Dukungan penuh `Native English` (pasar global Meta Hackathon) + `Bahasa Indonesia beraksen daerah`**; tidak mengklaim "mengerti Jawa" (kata daerah ditandai & dikonfirmasi) | `English` & `Indonesian` didukung resmi di 25 bahasa Voice Transcribe; pasar global Meta Hackathon membutuhkan demo & dokumen berbahasa Inggris asli (`Quotation / Estimate`) di samping `Surat Penawaran` Indonesia | Pemilik |
| 28 Okt 2026 | — | Tidak ada klaim offline di ponsel; Glimmer hanya jalur Best Open Weight di laptop, status "dirancang" | Belum diuji dengan angka | Pemilik |
| 28 Okt 2026 | G1 | Rencana sesudah STOP ditulis: pemutus = pemilik produk, 24 jam untuk lembar evaluasi, 3 hari kerja untuk memilih ganti segmen / ganti jalur input / tutup, sisa waktu untuk laporan temuan | Gate yang bisa menghentikan produk tanpa rencana akan dilewati orang | Pemilik |
| **TERBUKA** | G4 | **Repo publik `ajfpay/suara-lapangan` belum dibuat.** Bila implementasi dibuka: publik, dan pembuatannya menunggu persetujuan eksplisit pemilik — tidak dijalankan sendiri | Lingkup sekarang dokumen | Pemilik |
| **TERBUKA** | G4 | **Deploy produksi** belum diputuskan; hanya boleh setelah persetujuan eksplisit pemilik. Tidak ada domain, kredensial, atau migrasi produksi yang disiapkan sebelum itu | Keputusan pemilik | Pemilik |
| 28 Okt 2026 | Pra-Implementasi | **GO BERSYARAT (DENGAN REVISI KONTRAK K1–K7)**: sample rate tunggal 16 kHz s16le mono, jalur utama REST `ENDPOINTING` (`turns[]` Meta → `turn_N`) + Guard §B2 + PDF lewat pipeline `invoify` (Chromium `page.pdf()`; `@react-pdf/renderer` hanya fallback), 1 dokumen penuh (`Surat Penawaran`) + 2 skema siap, Capacitor & Typst ditangguhkan pasca-submit, kalender aktif Gate Harian GD1–GD4 menuju tenggat internal **Sel 3 Nov 2026 16:59 UTC (23:59 WIB)** | Putusan konvergen AO Multi-Agent Validation Gate (`Software Architect` + `Backend Architect` + `Multi-Agent Coordinator` + `Minimal Change Engineer` + `Rapid Prototyper` + `Studio Producer`), diselaraskan dengan keputusan pemilik Q1/Q2 | Studio Producer + Software Architect + Pemilik |
| 29 Okt 2026 | — | **Sinkronisasi dokumen (tiket 12 / D12)**: `docs/01-ARSITEKTUR.md`, `docs/02`, `docs/04`, `docs/05`, README, dan `docs/audit/KEPUTUSAN-ADR.md` diselaraskan dengan keputusan pemilik 28 Okt 2026 (Q1: basis Next.js `invoify`; Q2: REST `ENDPOINTING`) dan implementasi repo aplikasi pada commit `56a112a`. Keputusan lama — `Vite + React`, pemotongan segmen manual `seg_N`, `@react-pdf/renderer` sebagai perender utama, backend `Fastify` — ditandai **sudah digantikan**. Tidak ada ambang gate, kontrak K1–K7, atau kalender yang diubah | Tiket 12 (D12) | Pemilik (keputusan 28 Okt) + pelaksana tiket 12 |
| **MENUNGGU SIGN-OFF** | — | **Perubahan kontrak beku K2 (tiket 02 / D5, seri document-pipeline): format nomor dokumen** — lama `SL/QTN/<YYYY-MM-DD>/NNN` (3 digit, per tanggal) → baru `SL/QTN/YYYY/NNNN` (4 digit, per tahun kalender, reset tiap tahun, dialokasikan server saat dokumen dibuat, tidak pernah dipakai ulang). Implementasi selesai di `contracts/quotation.schema.json` + `contracts/contract.test.mjs`; PR #D2 **tidak boleh merge sebelum persetujuan tertulis pemilik** dicatat di baris ini | Tiket 02 (spec document-pipeline R13–R18, keputusan pemilik 3) | **Pemilik** |
| _(isi saat gate dijalankan)_ | | | | |
