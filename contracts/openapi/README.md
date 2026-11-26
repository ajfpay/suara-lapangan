# REST contract

`openapi.json` is the local OpenAPI 3.1 contract for mobile and existing web endpoints. It does not replace the existing quotation/model schemas.

The private list and history use the authenticated user ID even for administrators. Existing detail and mutation routes retain their existing authorization behavior. The list shows the latest owned version per root, then applies search and status filters. The cursor preserves PostgreSQL microsecond precision and the UUID tie-breaker. Keep filters unchanged between pages. The response does not contain transcripts, storage paths, or document hashes.

Generate TypeScript types locally with a pinned generator:

```sh
npx --yes openapi-typescript@7.10.1 contracts/openapi/openapi.json -o .scratch/suara-lapangan-api.d.ts
```

The mobile repository will consume the contract in its own ticket. No demo API or remote schema is used.

Run the real HTTP list checks on the dedicated Lightvela database and a loopback sandbox on port 3010:

```sh
HURL_BIN="$HOME/.local/bin/hurl" node tests/api/documents/run-list-hurl.mjs
```

Load the same test database and signing secret as the running sandbox. The runner checks the database identity, creates two short-lived test sessions, and deletes only its own fixture rows after the run. Never use production credentials.
