# 01: Core MCP Server and Business Tool Definitions

**What to build:**
A self-contained Model Context Protocol (MCP) server instance using `@modelcontextprotocol/sdk` registering the four core Suara Lapangan domain tools (`list_documents`, `get_document`, `create_quotation_draft`, and `get_document_pdf`). This enables any compliant MCP client transport to execute business operations against existing document stores.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Core MCP server factory created in `lib/server/mcp/server.ts`
- [ ] Tool `list_documents` returns active documents and filterable statuses ("siap" | "perlu_konfirmasi")
- [ ] Tool `get_document` retrieves complete quotation JSON by ID
- [ ] Tool `create_quotation_draft` processes input turns through guard rules and stores draf
- [ ] Tool `get_document_pdf` returns PDF download readiness and endpoint URL
- [ ] Unit tests in `lib/server/mcp/server.test.ts` verify tool listing and execution against mock/real stores
