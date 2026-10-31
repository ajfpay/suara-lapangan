# 02: Next.js App Router Streamable HTTP Endpoint

**What to build:**
A Next.js App Router route handler at `app/api/mcp/route.ts` implementing `WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`. This exposes the core MCP server over standard HTTP (POST/GET) for remote agents including Cursor, Windsurf, remote Muse Code, and Meta AI Connectors.

**Blocked by:** 01: Core MCP Server and Business Tool Definitions

**Status:** ready-for-agent

- [ ] Route handler created at `app/api/mcp/route.ts` with `POST` and `GET` exports
- [ ] Connects `WebStandardStreamableHTTPServerTransport` to `createMcpServer()`
- [ ] Correctly processes JSON-RPC `tools/list` and `tools/call` over HTTP
- [ ] Handles errors and unsupported methods with standard JSON-RPC error responses
- [ ] Route handler test in `app/api/mcp/route.test.ts` passes with synthetic requests
