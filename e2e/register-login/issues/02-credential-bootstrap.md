# 02: Credential Bootstrap Helper and Account Matrix Config

**What to build:** A secure credential loader module that resolves test account definitions and deterministic password handles from Akeyless without exposing secrets in logs, stdout, or repository history.

**Blocked by:** None (runs in parallel with Ticket 01)

**Status:** ready-for-agent

---

## Owned Files and Artifacts

- `~/repos/.scratch/register-login-e2e/lib/credentials.ts`
- `~/repos/.scratch/register-login-e2e/lib/accounts.ts`

**Boundary Justification:** All credential extraction logic and temporary credential representations remain within the scratch directory. No secret files or credentials are written into application repositories.

---

## Steps

1. Implement `lib/accounts.ts` declaring the typed account matrix constants:
   - Old Account: `liam25e2b@ycalstore.shop` (Role: duplicate rejection).
   - New Account: `ethan9b21b@ultrmigos.online` (Role: fresh registration & verification).
   - Public Inbox URL: `https://generator.email/ethan9b21b@ultrmigos.online`.
2. Implement `lib/credentials.ts`:
   - Interfaces with Akeyless via CLI command shape: `akeyless get-secret-value --names /suara-lapangan/credentials/demo-user --json` without echoing stdout to console.
   - Extracts the deterministic password pattern stored in the vault item.
   - Masks all returned values as redacted handles for test fixtures.
   - Halts immediately with a clear diagnostic if the Akeyless item is missing or inaccessible.

---

## Acceptance Criteria

- [ ] `lib/accounts.ts` defines explicit constants for `liam25e2b@ycalstore.shop` and `ethan9b21b@ultrmigos.online`.
- [ ] `lib/credentials.ts` resolves credentials via Akeyless CLI securely without printing secret values to stdout, stderr, or log files.
- [ ] A missing secret condition triggers an immediate typed error without attempting fallback passwords.
- [ ] No plaintext passwords or static credentials are hardcoded in test source code.
- [ ] Zero files modified in `/home/ubuntu/repos/suara-lapangan-hackathon-pr` or `/home/ubuntu/repos/e2e`.
