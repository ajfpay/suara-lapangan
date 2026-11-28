# REST contract

`openapi.json` is the local OpenAPI 3.1 contract for mobile and existing web endpoints. It does not replace the existing quotation/model schemas.

The private list and history use the authenticated user ID even for administrators. Existing detail and mutation routes retain their existing authorization behavior; detail version metadata follows the same access rule for each revision. The contract covers the mobile API, not web-only admin management routes. The list shows the latest owned version per root, then applies search and status filters. The cursor preserves PostgreSQL microsecond precision and the UUID tie-breaker. Keep filters unchanged between pages. The response does not contain transcripts, storage paths, or document hashes.

Generate TypeScript types locally with a pinned generator:

```sh
npx --yes openapi-typescript@7.10.1 contracts/openapi/openapi.json -o .scratch/suara-lapangan-api.d.ts
```

The mobile repository will consume the contract in its own ticket. No demo API or remote schema is used.

The CI route tests use signed Better Auth cookies and real database sessions as well as mocked-auth edge cases. The Hurl runner is intentionally a manual sandbox proof, not a CI job.

Run the real HTTP list checks on the dedicated Lightvela database and a loopback sandbox on port 3010:

```sh
HURL_BIN="$HOME/.local/bin/hurl" node tests/api/documents/run-list-hurl.mjs
```

Load the same test database and signing secret as the running sandbox. The runner checks the database identity, creates two short-lived test sessions, and deletes only its own fixture rows after the run. Never use production credentials.

## Authentication (ticket 04)

The backend and Expo server plugin use Better Auth 1.5.5. The mobile application should use the same client version. Configure exact native origins with NATIVE_AUTH_ORIGINS (suara-lapangan://, or explicitly selected -development / -staging schemes). Do not enable Expo Go wildcard origins. Use exact HTTP(S) origins without a trailing slash in TRUSTED_ORIGINS. Invalid entries are rejected with a warning that identifies the variable and entry number, not the raw value.

Recovery requests use request-password-reset and return a generic response. The email links to the localized web form with the token in a fragment; submit the token in the JSON body to reset-password. Password reset revokes old sessions. The native client can request a reset and use this web fallback.

SMTP_HOST, SMTP_PORT and SMTP_FROM select development SMTP (default port 1025); production uses Gmail API exclusively. Configure Mailpit before registering a development account. No verification or reset URL is printed to the logs. The opt-in integration test uses the approved Mailpit host 100.94.246.116:1025 and HTTP port 8025, not arbitrary SMTP environment values. It sends a synthetic message, not a real account recovery email.

```sh
AUTH_TEST_SMTP=1 npm exec -- vitest run lib/server/email/transport.test.ts
```

Run the manual recovery HTTP proof against the verified local sandbox (not production):

```sh
node scripts/sandbox/verify-db-identity.mjs && \
"$HOME/.local/bin/hurl" --test \
  --variable base_url=http://localhost:3010 \
  --variable unknown_email="ticket04-$(node -e 'process.stdout.write(require("crypto").randomUUID())')@example.test" \
  tests/api/auth/recovery.hurl
```

The recovery limiter intentionally combines a per-email budget (five requests per 15 minutes across IPs) with the IP rate limit. An attacker who knows an email can exhaust its budget temporarily; using only an email/IP pair would allow distributed abuse. The bounded map evicts its oldest entry rather than denying recovery to all new addresses when full. Eviction and process restart can reset a budget; the IP limit remains in effect. Aliases are not merged because mailbox alias semantics vary by provider. The per-email budget is in-memory; the IP budget uses PostgreSQL.

## Backend auth hardening (ticket 21)

Email registration and sign-in each allow 10 attempts per IP per fixed 60-second window starting at the first accepted attempt using atomic PostgreSQL attempt reservations before the auth handler (`0012_auth_rate_limit.sql`), shared by all backend instances. Better Auth's non-atomic limiter is disabled only on these four explicitly handled email-auth routes to prevent double counting. Password-reset windows remain 5 attempts per 900 seconds for reset requests and 10 per 60 seconds for reset submission. A blocked IP receives HTTP 429 with `X-Retry-After`; an unavailable rate-limit store fails closed with HTTP 503. IPv4-mapped IPv6 addresses share the same bucket as IPv4, and IPv6 addresses use a /64 bucket. In production, configure `AUTH_TRUST_PROXY=true` **only after** verifying that the ingress replaces X-Forwarded-For or appends the actual connecting client as its last entry and that the application cannot be reached directly by untrusted clients. Without a verified production proxy setting or valid IP, requests use a shared fallback bucket instead of bypassing the limiter. This shared bucket can deny service to other users; the server warns when it is exhausted. Do not merge for production deployment until the real ingress header behavior and direct-access isolation are verified. Forwarded client IPs must never be trusted directly from the public network.

`GET /api/auth/credential-capability` returns only the current session's `{"status":"password" | "none" | "unknown"}`. Better Auth's account-list response omits passwords, so the server derives this status internally from the signed-in owner's account records. A credential with a password takes precedence over social accounts. Missing or inconsistent account information is unknown; unauthenticated requests return 401.

The admin seed command takes `--email` and optional `--name` only. Provide `ADMIN_SEED_EMAIL_ALLOWLIST` (comma-separated exact email addresses), `ADMIN_SEED_PASSWORD` and an explicit `DATABASE_URL` through the approved secret environment. Repeated runs retain an existing verified matching credential instead of rotating its password. A mismatched, passwordless or ambiguous existing credential aborts the transaction; resolve inconsistent credential rows through the authorized account maintenance process. Do not include secrets in shell arguments or logs.

### Real HTTP regression checks

Start the built sandbox on loopback with the verified test database, the same signing secret and `AUTH_TRUST_PROXY=true` for this local-only test. Run from the repository root:

```sh
HURL_BIN="$HOME/.local/bin/hurl" AUTH_HURL_BASE_URL=http://localhost:3010 npm run test:auth:http
```

The runner checks the dedicated Lightvela database identity, uses synthetic fixtures and cleans up its own records. The rate-limit proof includes the real expiry window, so it takes at least 60 seconds. Do not run it concurrently with Vitest or Playwright on the shared sandbox database. Run the recovery proof above separately. These are manual sandbox checks; CI uses its own database.
