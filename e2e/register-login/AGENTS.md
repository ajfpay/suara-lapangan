# AGENTS.md for register-login-e2e

E2E suite for the Suara Lapangan app (http://localhost:3100, local test DB) built on the
~/repos/e2e framework (linked as `file:` deps `e2e` + `@e2e-dev/web`).

## Layout

- `spec/register-login-e2e-spec.md` is the approved spec, owner contract encoded here
- `issues/` holds execution-plan issues 01 to 05
- `tests/01..05-*.e2e.ts` covers fresh register, duplicate rejected, inbox verify plus login, jackwefirst login, and the full flow rekam, susun, dokumen, konfirmasi, edit, approve, PDF, email
- `lib/` has credentials (Akeyless), accounts, and the artifact screenshot helper
- `scripts/` holds the suite runner and evidence report generator
- `run-status.json` is the scenario status matrix the tests write

## Running

```
npm install           # links local e2e packages
npm run test          # full suite via scripts/run-suite.ts
./node_modules/.bin/e2e run tests/05-fullflow-rekam-susun-dokumen.e2e.ts   # single scenario
```

Prereqs are a dev server on :3100 (`/api/auth/ok` returns `{"ok":true}`), a Postgres test DB on :5432, and Akeyless auth. Credentials live in Akeyless under `/suara-lapangan/credentials/*`; never print secret values.

## Rules encoded from the owner contract

1. Local first; public release is a separate decision.
2. An anti-bot page, for example on generator.email, stops the run. Report it, never circumvent it.
3. A new-account registration failure stops the run and gets reported. Never fall back silently to the old account.
4. Tests never commit or push on their own. Their output is the evidence report.

## App quirks the tests already encode (do not re-litigate)

- Turn cards are 1-indexed. The first turn is `turn-card-1` because `TurnReview.tsx` renders `idx + 1`.
- Konfirmasi card testids are `konfirmasi-<field>`. `konfirmasi-panel` is the container, so exclude it.
- Record start and stop need a `longPress` of at least 300 ms (`minPressDurationMs` in `lib/client/use-recorder.ts`).
- FakeMediaRecorder must emit the fixture WAV exactly once, in `stop()` only.
