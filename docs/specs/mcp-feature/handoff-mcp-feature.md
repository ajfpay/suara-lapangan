# Handoff: Suara Lapangan MCP Feature Implementation

- **Date:** 2026-10-31
- **Focus Sesi Berikutnya:** Menjalankan implementasi Ticket 01 (`lib/server/mcp/server.ts`) di worktree baru `feature/mcp-server`.
- **Absolute Path Artifact:** `/home/ubuntu/repos/suara-lapangan/.scratch/mcp-feature/handoff-mcp-feature.md`

---

## Ringkasan Konteks & Status Terakhir

Sesi ini telah menyelesaikan tahap perencanaan arsitektur dan spesifikasi teknis untuk penambahan fitur **Model Context Protocol (MCP)** pada aplikasi Suara Lapangan:
1. **Pemahaman Proyek:** Suara Lapangan adalah aplikasi Next.js 15 untuk mandor konstruksi membuat Surat Penawaran Harga (RAB) dari memo suara.
2. **Kebutuhan Fitur:** Mengizinkan agent AI lokal (Claude Code, Cursor, Muse Code) dan web agent (Web Muse `muse.ai` / Meta AI Connectors) mengakses draf penawaran dan membuat dokumen tanpa mengedit file sistem.
3. **Penyelarasan Tahapan (Engineering Mode):**
   - **Phase 3 (Spec):** Disimpan di `docs/specs/mcp-feature/2026-10-31-mcp-feature-spec.md` (Approval Gate 1 disetujui).
   - **Phase 4 (Tickets):** 3 vertical slice tickets dibuat di `.scratch/mcp-feature/issues/`:
     - `01-mcp-server-core.md`: Core server factory & 4 business tools (`list_documents`, `get_document`, `create_quotation_draft`, `get_document_pdf`).
     - `02-mcp-http-route.md`: Streamable HTTP route handler (`app/api/mcp/route.ts`).
     - `03-mcp-stdio-and-connector-docs.md`: Local stdio CLI runner (`scripts/mcp-server.ts`) & Web Muse Custom Connector guide.
   - **Phase 5 (Execution Graph):** Disimpan di `.scratch/mcp-feature/execution-graph.md`.
   - **Phase 7 (Topology & PR Plan):** Disimpan di `.scratch/mcp-feature/execution-plan.md`.

---

## Referensi Dokumen & Artefak (Tanpa Duplikasi)

- **Spesifikasi Teknis:** `docs/specs/mcp-feature/2026-10-31-mcp-feature-spec.md`
- **Daftar Tiket:**
  - `.scratch/mcp-feature/issues/01-mcp-server-core.md`
  - `.scratch/mcp-feature/issues/02-mcp-http-route.md`
  - `.scratch/mcp-feature/issues/03-mcp-stdio-and-connector-docs.md`
- **Execution Graph:** `.scratch/mcp-feature/execution-graph.md`
- **Execution Plan:** `.scratch/mcp-feature/execution-plan.md`
- **Aturan Batasan Kode:** `AGENTS.md` (Folder ownership: tiket lain tidak boleh disentuh; kode baru terbatas di `lib/server/mcp/**`, `app/api/mcp/**`, dan `scripts/mcp-server.ts`).

---

## Suggested Skills untuk Agen Selanjutnya

Agen yang melanjutkan sesi ini disarankan memanggil skill-skill berikut:
1. `engineering-mode` — Melanjutkan alur kerja standar Phase 8 (Parallel Worker Implementation).
2. `mcp-server-patterns` — Pola implementasi `@modelcontextprotocol/sdk` (tools, zod schema, WebStandardStreamableHTTPServerTransport, StdioServerTransport).
3. `tdd` / `tdd-workflow` — Menerapkan pengujian unit terlebih dahulu untuk tools MCP sebelum menghubungkannya ke runtime.
4. `verification-loop` — Menjalankan uji regresi lokal (`pnpm vitest run app lib`) untuk memastikan tidak ada fitur existing yang patah.

---

## Langkah Tindakan Sesi Berikutnya

1. Pindah ke worktree baru: `/home/ubuntu/repos/suara-lapangan-mcp` di cabang `feature/mcp-server`.
2. Pasang dependensi resmi MCP: `pnpm add @modelcontextprotocol/sdk`.
3. Kerjakan Ticket 01 (`lib/server/mcp/server.ts` dan `lib/server/mcp/server.test.ts`).
4. Jalankan pengujian unit hingga hijau, kemudian lanjutkan ke Ticket 02 dan Ticket 03 sesuai urutan di `execution-graph.md`.
