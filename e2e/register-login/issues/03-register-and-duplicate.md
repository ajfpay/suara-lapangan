# 03: Fresh Registration and Duplicate Rejection Tests (Scenarios A & B)

**What to build:** End-to-end tests covering fresh account registration on `http://localhost:3100/en/register` for `ethan9b21b@ultrmigos.online` and strict duplicate registration rejection for `liam25e2b@ycalstore.shop`.

**Blocked by:** 01 (E2E Framework Project Skeleton & Smoke Target), 02 (Credential Bootstrap Helper and Account Matrix Config)

**Status:** ready-for-agent

---

## Owned Files and Artifacts

- `~/repos/.scratch/register-login-e2e/tests/01-register-fresh.e2e.ts`
- `~/repos/.scratch/register-login-e2e/tests/02-duplicate-rejection.e2e.ts`
- Screenshots generated into `.amp/in/artifacts/`:
  - `01-register-page-loaded.png`
  - `02-scenario-a-fresh-register-submitted.png`
  - `03-scenario-b-duplicate-rejected.png`

**Boundary Justification:** Test specifications and runtime outputs are kept in the scratch test harness, preventing test state pollution in application repositories.

---

## Steps

1. Implement `tests/01-register-fresh.e2e.ts` (Scenario A):
   - Navigate to `http://localhost:3100/en/register`.
   - Take screenshot `01-register-page-loaded.png`.
   - Fill form:
     - Name: `Ethan Test User`
     - Email: `ethan9b21b@ultrmigos.online`
     - Password: deterministic password resolved via `lib/credentials.ts`.
   - Submit registration.
   - Assert success state (redirect to verification notice or login screen with verification requirement banner).
   - Verify user is not automatically granted an authenticated session prior to verification.
   - Take screenshot `02-scenario-a-fresh-register-submitted.png`.
   - **Enforce Circuit Breaker**: If registration fails, STOP execution and report. Never fall back to reusing the old account.
2. Implement `tests/02-duplicate-rejection.e2e.ts` (Scenario B):
   - Navigate to `http://localhost:3100/en/register`.
   - Fill form with existing registered user `liam25e2b@ycalstore.shop`.
   - Submit registration.
   - Assert visible error element (e.g. "Email already registered" / "User already exists").
   - Take screenshot `03-scenario-b-duplicate-rejected.png`.

---

## Acceptance Criteria

- [ ] `tests/01-register-fresh.e2e.ts` automates fresh user registration for `ethan9b21b@ultrmigos.online`.
- [ ] Fresh registration success leaves the user in an unverified state requiring email confirmation.
- [ ] Any failure during fresh registration immediately halts the suite without fallback.
- [ ] `tests/02-duplicate-rejection.e2e.ts` validates that submitting `liam25e2b@ycalstore.shop` produces an unambiguous, visible rejection message.
- [ ] Verification screenshots are captured and saved to `.amp/in/artifacts/`.
- [ ] Zero files modified in `/home/ubuntu/repos/suara-lapangan-hackathon-pr` or `/home/ubuntu/repos/e2e`.
