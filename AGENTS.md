# AGENTS.md — Suara Lapangan MVP

Instruksi untuk semua agen yang bekerja di repo ini (dan semua worktree-nya).
Dokumen sumber yang mengikat: `$HOME/repos/prototype/suara-lapangan/docs/` dan
`$HOME/repos/prototype/.scratch/suara-lapangan-mvp/`. Bila instruksi di sini bertabrakan dengan
spec, spec menang; laporkan tabrakannya, jangan diakali.

## Aturan kepemilikan folder (mengikat)

Setiap tiket punya worktree + cabang sendiri. Satu folder hanya punya SATU pemilik tulis.

- **Tiket 05** pemilik tunggal `app/api/documents/**` dan `lib/server/guard/**`. Tiket 05 yang
  membangun rute `PATCH /api/documents/{id}`.
- **Tiket 07** hanya boleh menulis di `app/[locale]/(suara)/**`. Ia boleh memakai rute
  `PATCH /api/documents/{id}` dari tiket 05, tetapi tidak boleh membangunnya.
- **Tiket 08** hanya boleh menulis di `app/api/pdf/**` dan `app/components/templates/**`.
- **Siapa pun yang perlu mengubah `app/api/documents/**` harus lewat tiket 05.** Agen lain tidak
  boleh mengedit langsung, bahkan untuk "satu baris"; ajukan perubahan ke pekerja/verifikator tiket 05.

Batasan lain yang sudah berlaku: pekerja tidak menyentuh worktree tiket lain, tidak merge, tidak
menghapus cabang/worktree, dan tidak membuat repo publik atau deploy (butuh persetujuan tertulis
pemilik).

## Project Status

Diperbarui 29 Okt 2026.

- **Batch 1 — SELESAI.**
  - Tiket 01 — commit `56a112a`: kerangka Next.js App Router + `next-intl`, tiga layar (Rekam,
    Susun, Dokumen) di `app/[locale]/`, locale `en` + `id`, alur faktur dihapus, notis lisensi MIT
    dipertahankan, 32/32 tes hijau.
  - Tiket 04 — commit `3add279` di cabang `agent/04-skema-fixtures-v2`, **belum merge ke `main`**:
    skema Quotation `strict` `en`/`id` di `contracts/`, 30 fixture bersih, 12 transkrip cacat,
    13/13 tes hijau.
  - Tiket 12 — commit `a315798` di repo dokumen `/home/ubuntu/repos/prototype`: dokumen arsitektur
    disinkronkan.
- **Batch 2 — SEDANG BERJALAN.** Tiket 02 (layar UI; `app/[locale]/(suara)/**` + `lib/client/**`,
  thread `T-01a185a8-7872-7705-92b7-dcff4746e323`, worker `test-automation-engineer`) dan tiket 03
  (endpoint ASR; `app/api/asr/**` + `lib/server/**` + `db/**`, thread
  `T-01a185a8-87f6-74e1-ad19-a76acda0dfc7`, worker `senior-developer`).
- Remote: `origin` = `git@github.com:ajfpay/suara-lapangan.git` (privat). Push hanya untuk cabang
  kerja; **merge ke `main` tetap keputusan manusia**.
