# SPEC — Suara Lapangan MCP Feature (Local AI & Web Muse Connector)

- **Date:** 31 Oct 2026 · **Status:** DRAFT — Awaiting Approval Gate 1
- **Authoritative references:** `docs/specs/document-pipeline/2026-10-31-document-pipeline-spec.md`, `AGENTS.md`, and official Model Context Protocol specifications (Streamable HTTP & stdio).
- **Target Artifact:** `docs/specs/mcp-feature/2026-10-31-mcp-feature-spec.md`

---

## Problem Statement

Users of Suara Lapangan (project estimators, foremen, and field managers) currently must interact with the application manually through browser screens to review voice notes, confirm quotation items, and inspect generated quotation documents and PDFs.

External autonomous agents and AI assistants — specifically:
1. **Local coding and workflow agents** (e.g., Claude Code, Cursor, Windsurf, Meta's Muse Code), and
2. **Web-based personal agents** (e.g., Meta's consumer Muse agent at `muse.ai` via Custom Connectors or Meta AI Connectors)

cannot programmatically inspect existing quotations, generate quotation drafts from verbal notes, or retrieve quotation PDFs on behalf of the user. Because Suara Lapangan lacks a standardized Model Context Protocol (MCP) interface, agents have no discoverable tool definitions or structured runtime contracts to query or operate the business workflow.

---

## Solution

Implement an MCP feature directly within Suara Lapangan providing a unified tool surface over both **Streamable HTTP** (for remote / web connections like Muse and Meta AI Connectors) and **stdio** (for local CLI agents like Claude Code and Muse Code).

The MCP server exposes safe, high-level business tools:
- `list_documents`: Discover recent quotation documents and their readiness states.
- `get_document`: Retrieve complete quotation details, line items, and confirmation status.
- `create_quotation_draft`: Create a new quotation draft from turns or verbal notes, running it through the deterministic server guard.
- `get_document_pdf`: Retrieve the client-ready PDF status and download URL for an approved quotation.

The server operates strictly on application domain data and features, without exposing code editing or filesystem modifications.

---

## User Stories

1. As an estimator using Claude Code in the terminal, I want to connect to Suara Lapangan via stdio MCP, so that my AI assistant can inspect active quotation drafts without me switching to the browser.
2. As a field supervisor using Cursor, I want to query recent quotations via a local MCP server, so that I can cross-reference project material volumes with architectural notes.
3. As a project manager interacting with Meta Muse Code, I want to declare Suara Lapangan in `mcp_servers` over Streamable HTTP, so that Muse Code can trigger quotation draft creation from transcriptions.
4. As a user chatting with the Web Muse personal assistant (`muse.ai`), I want to invoke a Custom Connector pointing to Suara Lapangan, so that Muse can summarize quotation items and status during daily planning.
5. As an AI agent, I want to call `list_documents`, so that I can see the list of recent quotations, their project names, client names, and whether they are ready or need confirmation.
6. As an AI agent, I want to call `get_document` with a specific document ID, so that I can inspect line items, unit prices, total cost, and specific fields pending user confirmation.
7. As an AI agent, I want to call `create_quotation_draft` with verbal transcripts or job notes, so that the document is created with calculated totals and validated against domain rules.
8. As an AI agent, I want to receive validation warnings when quotation items have missing units or mismatched prices, so that I can prompt the user for clarification.
9. As an AI agent, I want to call `get_document_pdf`, so that I can provide the client with a direct link to download the completed PDF once all items are confirmed.
10. As a developer maintaining Suara Lapangan, I want the MCP server implemented using the official `@modelcontextprotocol/sdk`, so that the project stays compliant with MCP standards without maintaining custom protocol parsers.
11. As a security-conscious administrator, I want the MCP tool definitions strictly isolated from server filesystem and code modification commands, so that connected external agents cannot alter application source code.
12. As a developer working under strict ticket folder boundaries, I want the MCP implementation located in its own dedicated path (`lib/server/mcp/**` and `app/api/mcp/**`), so that it does not collide with tickets owning `app/api/documents/**` or `app/[locale]/(suara)/**`.

---

## Implementation Decisions

### 1. Unified MCP Server Core
- Create a dedicated MCP server factory in `lib/server/mcp/server.ts` that defines and registers the business tools using `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`.
- Use `zod` for input schema definitions, ensuring parameter types and descriptions are visible to AI clients.

### 2. Dual Transport Strategy
- **HTTP Transport (`app/api/mcp/route.ts`):**
  - Implement a Next.js App Router route handler exporting `POST` and `GET`.
  - Use `WebStandardStreamableHTTPServerTransport` to handle standard `Request` and `Response` objects natively without external Express shims.
  - Supports streaming HTTP clients (Cursor, Windsurf, remote Muse Code, Meta AI Connectors).
- **Stdio Transport (`scripts/mcp-server.ts`):**
  - Implement a standalone Node/TypeScript CLI script utilizing `StdioServerTransport`.
  - Allows local terminal agents (Claude Code, local Muse Code) to launch the MCP server as a sub-process via `node scripts/mcp-server.ts` or `pnpm mcp`.

### 3. Business Tools Definition
- **`list_documents`**:
  - Parameters: optional `limit` (number, default 20), optional `status` filter (`siap`, `draft`, `butuh_konfirmasi`).
  - Reads from the document store and returns metadata (id, nomor, proyek, total_nominal, status, created_at).
- **`get_document`**:
  - Parameters: `id` (string, required).
  - Returns complete structured quotation JSON, including line items and `butuh_konfirmasi` details.
- **`create_quotation_draft`**:
  - Parameters: `sessionId` (string), `locale` (`id` | `en`), `project` (name, client, location), `turns` or `transcript` (array of text / speaker turns).
  - Invokes existing domain helpers (`documentFromTurns` and `applyGuard`) to produce a verified quotation record.
- **`get_document_pdf`**:
  - Parameters: `id` (string, required).
  - Checks if the document is confirmed (`siap`), returning the PDF download endpoint URL (`/api/documents/{id}/pdf`) and cache status. Returns a descriptive explanation if confirmation is still required.

### 4. Integration with Web Muse (`muse.ai`)
- Web Muse uses Custom Connectors that consume HTTP/REST endpoints.
- Provide a clear connector contract mapping:
  - Tools map directly to `POST /api/mcp` for clients with MCP transport support.
  - Alternatively, Web Muse's Custom Connector builder can point directly to the existing REST endpoints (`/api/documents` and `/api/documents/{id}/pdf`), documented in an accompanying connector schema guide.

### 5. Repository Boundary Compliance (`AGENTS.md`)
- Per `AGENTS.md`, Ticket 05 owns `app/api/documents/**` and `lib/server/guard/**`.
- The MCP feature resides strictly in new, non-overlapping paths:
  - `lib/server/mcp/**`
  - `app/api/mcp/**`
  - `scripts/mcp-server.ts`
- It imports shared functions from server libraries as a caller without modifying Ticket 05's internal source files.

---

## Testing Decisions

### What Makes a Good Test
- Tests must verify external behavior through public protocol interfaces:
  - Initialize the MCP server and list available tools, verifying names, descriptions, and input schemas.
  - Invoke `list_documents`, `get_document`, `create_quotation_draft`, and `get_document_pdf` through the MCP tool handler and assert expected JSON-RPC response shapes.
  - Exercise the Next.js Route Handler (`app/api/mcp/route.ts`) with synthetic HTTP POST requests carrying valid JSON-RPC envelopes and assert 200 OK responses.

### Seams Under Test
- Protocol Seam: JSON-RPC request / response contract via `@modelcontextprotocol/sdk`.
- HTTP Seam: `POST /api/mcp` Web Standard route handler.

### Prior Art
- Existing API route tests in `app/api/documents/route.test.ts` and `app/api/asr/transcribe/route.test.ts`.

---

## Out of Scope

1. **Filesystem and Code Editing Tools:** No tools will be exposed to read, write, or search project source code or configuration files.
2. **Interactive UI Modifications:** No modifications to the Next.js frontend pages (`app/[locale]/(suara)/**`).
3. **Database Schema Migrations:** The MCP server operates on existing database tables and in-memory stores; no new migrations are introduced.
4. **Third-Party External Repositories:** No external GitHub repositories will be cloned or maintained as separate submodules.
5. **Public Hosting / Tunnel Management:** Tunneling services (Cloudflare Tunnel, Tailscale Funnel, ngrok) for exposing localhost to remote webhooks remain developer environment operations and are not hardcoded into the repo.

---

## Further Notes

- Package additions are strictly bounded to `@modelcontextprotocol/sdk` (Zod is already present in peer dependencies and TypeScript types).
- This specification establishes Approval Gate 1 of Engineering Mode.
