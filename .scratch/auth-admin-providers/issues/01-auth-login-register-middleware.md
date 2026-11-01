# 01: Auth — login, register, email confirmation, middleware

**What to build:** a customer can register with email and password, sign in with Google or email/password, confirm their email, log out, and be redirected to login when they try to open Rekam, Susun or Dokumen. Public landing pages stay open. Backend (Better Auth tables, config, seed-admin) already exists on branch `agent/11-auth-admin`; this ticket finishes the UI, middleware and email-confirmation flow on that branch.

**Blocked by:** None (can start immediately; resume branch `agent/11-auth-admin`, worktree `/home/ubuntu/repos/suara-lapangan-w11-auth-admin`)

**Status:** ready-for-agent

**Findings from the paused provider thread:**
- The admin seam must read `role='admin'` from the `0005_auth_tables.sql` schema (which already defines role and ban columns plus `scripts/seed-admin.mjs`), not invent a second role source.

- [ ] Register screen (email + password) and Google sign-in button, both en/id
- [ ] Email confirmation required before the account can use protected routes
- [ ] Login screen with redirect-back to the originally requested page
- [ ] Logout control reachable from the app shell
- [ ] Middleware protects Rekam, Susun and Dokumen while leaving landing pages public
- [ ] Session persists across reloads; unauthenticated API calls return 401
- [ ] Admin seam reads `role='admin'` from the `0005_auth_tables.sql` schema
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green
