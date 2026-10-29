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
