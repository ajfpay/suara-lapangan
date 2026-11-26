# Backend sandbox setup with Lightvela PostgreSQL

This guide explains how to run the `suara-lapangan` backend sandbox and connect it to the dedicated test database on Lightvela over Tailscale.

## Prerequisites

- Direct Tailscale connection to Lightvela (`100.69.30.9:5432`). Do not start local Docker or PostgreSQL containers, and do not open SSH or Cloudflare TCP tunnels.
- Sandbox credentials stored outside the repository with `chmod 600` (for example `~/.config/suara-lapangan-sandbox/sandbox.env`). Never commit `.env` files or print credentials in logs.
- Dedicated database `suara_lapangan_test` owned by non-superuser role `suara_lapangan_test` inside container `pg-dev-db` on Lightvela. Do not use `dev`, `ticket01_test`, or the production `suara_lapangan` database.

## 1. Verify database identity

Confirm the connection targets the dedicated Lightvela test database with a non-superuser role:

```bash
set -a && source ~/.config/suara-lapangan-sandbox/sandbox.env && set +a
node scripts/sandbox/verify-db-identity.mjs --identity-only
```

The script accepts only the exact database and role `suara_lapangan_test` at `100.69.30.9:5432`, a nonempty password, and the single query parameter `sslmode=disable`. It rejects elevated role privileges. Identity-only mode does not require a migrated database.

## 2. Apply migrations

Migrations in `db/migrations/*.sql` are idempotent:

```bash
node scripts/sandbox/verify-db-identity.mjs --identity-only && node db/migrate.mjs
node scripts/sandbox/verify-db-identity.mjs
```

## 3. Start backend on a free port

Ports `8080` and `8081` belong to `backend_go`, and port `3773` is already exposed on the root Tailscale HTTPS path. Run `suara-lapangan` on port `3010`:

```bash
node scripts/sandbox/verify-db-identity.mjs && PORT=3010 npm run dev -- --hostname 127.0.0.1
```

## 4. Expose HTTPS over Tailscale for Android testing

Use Tailscale Serve only within the authorized tailnet. Never use Funnel or a public proxy. Restrict peer access with tailnet policy. Serve local port `3010` on dedicated Tailscale HTTPS port `3443` without modifying the existing service on port `443`:

```bash
sudo tailscale serve --bg --https=3443 3010
```

Verify readiness locally and from the physical Android device (`LGMV300L3f605971`) using the configured `BETTER_AUTH_URL`:

```bash
curl -fsS "localhost:${PORT:-3010}/api/health"
adb -s LGMV300L3f605971 shell "curl -fsS '${BETTER_AUTH_URL}/api/health'"
```

To verify real login, secure HTTP-only cookies, session lookup, and logout on the physical Android device, run:

```bash
node scripts/sandbox/verify-android-session.mjs
```

The script creates a unique temporary verified account in `suara_lapangan_test`, deletes only that account on normal exit or a handled interrupt, and does not send email or print cookies. Run it while the test database is not in use by another suite. Set `ANDROID_SERIAL` to select another authorized device. A forced kill or power loss can interrupt cleanup; inspect the exact synthetic account rather than deleting all test accounts.

## 5. Run backend test suite against the sandbox database

The workstation shell may export `NODE_ENV=production`, which switches React to its production bundle and disables `act()` in component tests. Remote Tailscale queries also add network latency compared to localhost. Always run Vitest with `NODE_ENV=test` and an increased timeout when `DATABASE_URL` points to Lightvela:

```bash
set -a && source ~/.config/suara-lapangan-sandbox/sandbox.env && set +a
node scripts/sandbox/verify-db-identity.mjs || exit 1
if ss -H -ltn "( sport = :3010 )" | grep -q .; then
    echo "Stop the sandbox server before tests"; exit 1
fi
export ASR_TEST_DATABASE_URL="$DATABASE_URL"
unset DATABASE_URL
NODE_ENV=test ./node_modules/.bin/vitest run --testTimeout=30000
```

The CI workflow intentionally leaves `DATABASE_URL` unset for unit and route tests. Stop the sandbox server before running suites that truncate test tables.

Health checks share one database probe per process and reuse the result for five seconds. They do not expose connection errors. Expected response from `/api/health` is HTTP `200` with `{"status":"ok","service":"suara-lapangan","database":{"status":"ok",...}}` and `Cache-Control: no-store`.
