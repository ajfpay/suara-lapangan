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

The backend and Expo server plugin use Better Auth 1.5.5. The mobile application should use the same client version. Configure exact native origins with NATIVE_AUTH_ORIGINS (suara-lapangan://, or explicitly selected -development / -staging schemes). Do not enable Expo Go wildcard origins.

Recovery requests use request-password-reset and return a generic response. The email links to the localized web form with the token in a fragment; submit the token in the JSON body to reset-password. Password reset revokes old sessions. The native client can request a reset and use this web fallback.

SMTP_HOST, SMTP_PORT and SMTP_FROM select Mailpit only outside production; production uses Gmail API exclusively. Run AUTH_TEST_SMTP=1 with the email transport test for the explicitly configured development service. This sends a synthetic message, not a real account recovery email.
