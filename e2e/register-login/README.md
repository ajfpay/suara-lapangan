# register-login-e2e

E2E suite for the [Suara Lapangan](https://github.com/ajfpay/suara-lapangan) app
(local dev server `http://localhost:3100`, local Postgres test DB), built on the
`~/repos/e2e` framework linked as `file:` dependencies.

## Scenarios

| Test | What it proves |
|---|---|
| `01-register-fresh` | Fresh account registers; user is unauthenticated until verified |
| `02-duplicate-rejection` | Second registration of an existing email is visibly rejected |
| `03-inbox-verify-and-login` | Verification link clicked in the real inbox; wrong password rejected |
| `04-jackwefirst-login` | Real account logs in through the UI |
| `05-fullflow-rekam-susun-dokumen` | Rekam, ASR, susun turns, document, konfirmasi, edit, approve, PDF download, email send |

Scenario 03 stops and reports when the inbox provider shows an anti-bot page. It never circumvents one. Scenario 05 asserts real data end to end: a real 16 kHz WAV fixture, the real Meta ASR endpoint, a server-issued document number, a `%PDF-` download, and a Gmail API send.

## Running

```
npm install
npm run test        # full suite
npm run report      # evidence report
```

Prerequisites are a dev server on :3100 (`GET /api/auth/ok` returns `{"ok":true}`), Postgres on :5432, and an authenticated Akeyless CLI. Credentials come from Akeyless under `/suara-lapangan/credentials/*`; secret values are never printed or committed.

## Owner contract encoded in the spec

1. Local first. Public release is a separate decision.
2. An anti-bot page stops the run and gets reported.
3. A new-account registration failure stops the run and gets reported, with no silent fallback to an old account.
4. The deliverable is the evidence report, not an automatic commit or push.

## App quirks the tests encode

- Turn cards are 1-indexed; `turn-card-1` is the first turn.
- Konfirmasi cards use `konfirmasi-<field>` testids; `konfirmasi-panel` is the container.
- Record start and stop need a press held at least 300 ms (`longPress`), not a click.
- The fake recorder emits the fixture WAV once, in `stop()` only.
