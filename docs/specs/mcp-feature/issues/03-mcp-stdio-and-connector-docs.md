# 03: Local stdio CLI Runner and Web Muse Connector Guide

**What to build:**
A standalone CLI runner script for local terminal agents (Claude Code, local Muse Code) connecting over stdio, plus a configuration guide for hooking the Web Muse consumer app (`muse.ai`) Custom Connector into Suara Lapangan.

**Blocked by:** 01: Core MCP Server and Business Tool Definitions, 02: Next.js App Router Streamable HTTP Endpoint

**Status:** ready-for-agent

- [ ] CLI runner created at `scripts/mcp-server.ts` using `StdioServerTransport`
- [ ] Added npm script `"mcp": "node --loader ts-node/esm scripts/mcp-server.ts"` or tsx equivalent in `package.json`
- [ ] End-to-end smoke check: stdio runner responds to protocol initialization
- [ ] Documentation created in `docs/connectors/muse-custom-connector.md` with schema mapping for `muse.ai` Custom Connector
- [ ] Verified non-interference with existing test suites (`pnpm vitest run app lib`)
