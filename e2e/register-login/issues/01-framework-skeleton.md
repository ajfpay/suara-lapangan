# 01: E2E Framework Project Skeleton & Smoke Target

**What to build:** A self-contained, runnable `e2e` test project configured inside the scratch directory that targets the local Next.js instance on port 3100, capable of executing browser-driven smoke tests against the registration route.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

---

## Owned Files and Artifacts

- `~/repos/.scratch/register-login-e2e/e2e.config.ts`
- `~/repos/.scratch/register-login-e2e/package.json`
- `~/repos/.scratch/register-login-e2e/tsconfig.json`
- `~/repos/.scratch/register-login-e2e/tests/smoke.e2e.ts`

**Boundary Justification:** All configuration and test files live strictly inside `~/repos/.scratch/register-login-e2e/`. The target application repo (`suara-lapangan-hackathon-pr`) must remain completely pristine with zero untracked test fixtures or altered dependencies.

---

## Steps

1. Initialize scratch project structure with TypeScript and ES module support.
2. Link or reference the pre-built `e2e` packages (`/home/ubuntu/repos/e2e/packages/e2e` and `/home/ubuntu/repos/e2e/packages/web`).
3. Define `e2e.config.ts` exporting a valid `E2EConfig`:
   - Engine: `@e2e-dev/web` (Chromium).
   - Target app URL: `http://localhost:3100`.
   - Output directory: `.e2e/` (with artifacts directed to `.amp/in/artifacts/`).
4. Write `tests/smoke.e2e.ts`:
   - Navigates to `http://localhost:3100/en/register`.
   - Asserts page load status and presence of the registration form.

---

## Acceptance Criteria

- [ ] `e2e.config.ts` exists in scratch root and specifies target URL `http://localhost:3100` using the `web()` engine.
- [ ] `tests/smoke.e2e.ts` validates that the `/en/register` screen mounts successfully.
- [ ] Configuration suppresses automatic video recordings unless failure occurs (`video: 'retain-on-failure'`).
- [ ] No files are modified or created inside `/home/ubuntu/repos/suara-lapangan-hackathon-pr` or `/home/ubuntu/repos/e2e`.
