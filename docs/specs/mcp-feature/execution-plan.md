# Execution Plan: Suara Lapangan MCP Feature

- **Feature:** MCP Server Integration (Local AI & Web Muse Connector)
- **Task Slug:** `mcp-feature`
- **Target Branch:** `feature/mcp-server`
- **Worktree Target:** `/home/ubuntu/repos/suara-lapangan-mcp` (sibling directory to main repo)

---

## PR Topology

Because Ticket 01, 02, and 03 form a coherent, tightly coupled vertical feature that touches only new non-conflicting paths (`lib/server/mcp/**`, `app/api/mcp/**`, `scripts/mcp-server.ts`), we map them into a single focused PR:

```
PR: feature/mcp-server -> main
├── Commit 1: feat(mcp): core server factory and business tools (Ticket 01)
├── Commit 2: feat(mcp): streamable http route handler for next.js (Ticket 02)
└── Commit 3: feat(mcp): stdio cli runner and web muse connector guide (Ticket 03)
```

---

## Agent & Role Allocation

| Step | Role | Agent Model / Specialty | Deliverable |
|---|---|---|---|
| Ticket 01 | Worker | `senior-developer` | Core MCP server factory and unit tests |
| Ticket 01 | Verifier | `test-automation-engineer` | Verify tool execution and schema validation |
| Ticket 02 | Worker | `backend-architect` | Route handler with Streamable HTTP transport |
| Ticket 02 | Verifier | `api-tester` | Verify HTTP request/response JSON-RPC contracts |
| Ticket 03 | Worker | `developer-tooling-engineer` | CLI runner script & Muse connector documentation |
| Final PR | Verifier | `code-reviewer` | Diff cleanup, regression check, and verification logs |

---

## Worktree Setup Strategy

- **Worktree Directory:** `$HOME/repos/suara-lapangan-mcp`
- **Base Branch:** `main` (commit `eb7dabd`)
- **Feature Branch:** `feature/mcp-server`
- **Independence:** Isolates MCP development completely from the ongoing work in main and other tickets.
