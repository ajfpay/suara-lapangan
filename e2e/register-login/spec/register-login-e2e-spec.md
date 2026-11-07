# Technical Specification: Register + Email Verification + Login E2E Suite (Phase 3)

## 1. Location and Artifact Boundary Justification

This specification resides at `~/repos/.scratch/register-login-e2e/spec/register-login-e2e-spec.md`. Under the Engineering Mode conventions established in this workspace (mirroring `~/repos/prototype/.scratch/suara-lapangan-mvp/`), all planning, specification, and execution artifacts for test validation are maintained strictly inside the ephemeral `.scratch/` hierarchy outside application repositories.

Maintaining this suite under `~/repos/.scratch/register-login-e2e/` guarantees:
1. **Repository Cleanliness**: The target application codebase (`/home/ubuntu/repos/suara-lapangan-hackathon-pr`) and the framework workspace (`/home/ubuntu/repos/e2e`) remain completely clean of scratch test harnesses, local credential caches, temporary screenshots, and disposable run traces.
2. **Zero Blast Radius**: Test runners and artifact generators do not risk dirtying git working trees or introducing uncommitted test code into application branches.
3. **Disposability**: Scratch artifacts can be archived or deleted post-verification without git cherry-picking or history rewriting.

---

## 2. Problem Statement

Suara Lapangan implements authentication using Better Auth with email/password authentication (`emailAndPassword.enabled: true`) and strict email verification enforcement (`requireEmailVerification: true`). While earlier test suites relied on developer shortcuts, specifically direct SQL mutations (`UPDATE auth_user SET email_verified = true`) or local Mailpit interceptions at `127.0.0.1:8025`, the application requires undeniable end-to-end proof that:
1. A fresh user can register on the live local application serving at `http://localhost:3100`.
2. An activation email is delivered through public internet mail routing to a real disposable inbox service (`generator.email`).
3. The verification link can be located, rendered, and clicked in a real browser context.
4. The verified user can successfully authenticate into protected sessions, while invalid passwords and duplicate email registrations are explicitly rejected.

---

## 3. Owner Contract (Verbatim Hard Rules)

The following 8 rules are non-negotiable contract invariants governing all execution phases:

1. **Local first; only discuss public release after local passes.**
   No remote deployments, tunneling services, or production releases will be configured or discussed until the complete local suite passes with full evidence.
2. **Two accounts:**
   - Pre-existing old account: `liam25e2b@ycalstore.shop` strictly reserved for negative testing (second registration attempt with the same email must be clearly rejected).
   - Fresh account: `ethan9b21b@ultrmigos.online` for the complete fresh registration, inbox activation, and authenticated login flow.
3. **Real browser inbox verification:**
   The public inbox at `https://generator.email/ethan9b21b@ultrmigos.online` MUST be opened in a browser (Playwright page from the e2e framework or `agent-browser` CLI), and the verification link clicked/validated there. Database-only mutations or Mailpit-only checks are strictly forbidden.
4. **Anti-bot hard stop:**
   On encountering any anti-bot mechanism (CAPTCHA, Cloudflare Turnstile, bot challenge, or rate-limit block) on `generator.email` or the application: STOP immediately, capture a screenshot artifact, and report. Do not attempt circumvention.
5. **Deterministic password derivation:**
   Passwords must follow the deterministic pattern documented in the Akeyless item `/suara-lapangan/credentials/demo-user`. Never print, log, echo, or commit the actual password plaintext.
6. **Akeyless CLI credential management:**
   Retrieve credentials exclusively via the Akeyless CLI (`akeyless get-secret-value`). If new secrets are created, store them under `/suara-lapangan/credentials/`. Never output secret values in terminal output, test reports, or logs.
7. **No silent fallback:**
   Failure of the new-account registration flow (`ethan9b21b@ultrmigos.online`) constitutes a critical failure: STOP and report immediately. Silent fallback to the old account for the happy path is prohibited.
8. **No auto commit or push:**
   Execution must not produce git commits, branch mutations, or git pushes. The sole required deliverable of the test execution is a consolidated evidence report with timestamps, terminal outputs, exit codes, and screenshot paths.

---

## 4. Environment Prerequisites & Verification Checks

Every prerequisite must be verified prior to initiating execution:

| Subsystem | Requirement | Deterministic Verification Command | Expected Output / Exit Code |
|---|---|---|---|
| Target Application | Next.js server running on port 3100 | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/en/register` | HTTP `200` |
| Auth API Health | Better Auth health endpoint responding | `curl -s http://localhost:3100/api/auth/ok` | `{"ok":true}` (HTTP 200) |
| Relational Database | PostgreSQL listening on loopback | `pg_isready -h 127.0.0.1 -p 5432` | `127.0.0.1:5432 - accepting connections` (Exit code `0`) |
| E2E Framework | TesterArmy `e2e` core and web packages built | `test -f /home/ubuntu/repos/e2e/packages/e2e/dist/index.js && test -f /home/ubuntu/repos/e2e/packages/web/dist/index.js && echo OK` | `OK` (Exit code `0`) |
| Secret Manager | Akeyless CLI authenticated | `akeyless list-items --path /suara-lapangan/credentials/ >/dev/null && echo OK` | `OK` (Exit code `0`) |
| Secret Path | Demo user item exists in vault | `akeyless describe-item --name /suara-lapangan/credentials/demo-user >/dev/null && echo OK` | `OK` (Exit code `0`) |
| Browser Engine | Chromium engine available for Playwright | `which agent-browser || which google-chrome || npx @e2e-dev/web install chromium` | Executable path resolved (Exit code `0`) |

---

## 5. Account Matrix

| Account Type | Email Address | Role in Suite | Source of Credentials | Expected Behavior |
|---|---|---|---|---|
| **Old Account** | `liam25e2b@ycalstore.shop` | Negative duplicate registration test | Akeyless: `/suara-lapangan/credentials/demo-user` | Registration attempt on `/en/register` is rejected with visible duplicate error; database record remains untouched. |
| **New Account** | `ethan9b21b@ultrmigos.online` | Fresh happy path: registration, email verification, authenticated login | Derived via Akeyless pattern, stored in transient session memory | Registration succeeds; activation email arrives at `generator.email`; link verification succeeds; user authenticates into protected session. |

---

## 6. End-to-End Scenarios and Acceptance Steps

### Scenario A: Fresh Account Registration (Happy Path)
1. **Navigate**: Open browser to `http://localhost:3100/en/register`.
   - *Pass*: Registration form loads with `Name`, `Email`, `Password`, and `Submit` elements visible.
   - *Fail*: HTTP error, blank page, or missing input fields.
2. **Fill Form**:
   - Name: `Ethan Test User`
   - Email: `ethan9b21b@ultrmigos.online`
   - Password: deterministic password handle resolved from Akeyless (redacted).
3. **Submit**: Click submit button.
4. **Assert State**:
   - *Pass*: UI transitions to email verification pending screen (e.g., prompt indicating verification email sent), or redirects to login with verification banner; user is NOT authenticated into protected routes yet.
   - *Fail*: Unhandled exception, form submission crash, or unexpected bypass of email verification.

### Scenario B: Duplicate Registration Rejection (Negative Path)
1. **Navigate**: Open browser to `http://localhost:3100/en/register`.
   - *Pass*: Fresh registration form rendered.
2. **Fill Existing User**:
   - Name: `Liam Duplicate Attempt`
   - Email: `liam25e2b@ycalstore.shop`
   - Password: deterministic password handle resolved from Akeyless (redacted).
3. **Submit**: Click submit button.
4. **Assert Rejection**:
   - *Pass*: UI displays a clear, distinct, visible error notification (e.g., "Email already registered" / "User already exists" / API 400 or 422 error banner). No verification email is dispatched. Form remains on register view or prompts login.
   - *Fail*: Silent failure, false success screen, or unhandled 500 server crash.

### Scenario C: Public Inbox Verification & Session Authentication
1. **Navigate to Public Inbox**: Open browser page to `https://generator.email/ethan9b21b@ultrmigos.online`.
   - *Pass*: Inbox loads showing message list or waiting state.
   - *Stop Rule*: If CAPTCHA or Cloudflare Turnstile appears, immediately capture `.amp/in/artifacts/generator-email-antibot.png`, abort, and report.
2. **Poll and Locate Verification Email**:
   - Wait up to 300 seconds (5 minutes) for an email from Suara Lapangan (`Verifikasi Email` for Suara Lapangan, or a body containing the verification URL).
   - Refresh inbox once at 150 seconds if not yet received.
   - *Pass*: Email arrives; body displays clickable verification link or button pointing to `/api/auth/verify-email?token=...` or `/en/verify-email?...`.
   - *Fail / Stop Rule*: No email after 300 seconds -> mark status `BLOCKED (Email delivery timeout)`.
3. **Execute Verification**:
   - Click the verification link, or navigate directly to the extracted target URL.
   - *Pass*: Application confirms email verification (redirects to `/en/login` or shows "Email verified successfully" confirmation).
   - *Fail*: Verification token invalid, expired, or server 500 error.
4. **Negative Login Test (Wrong Password)**:
   - Navigate to `http://localhost:3100/en/login`.
   - Enter `ethan9b21b@ultrmigos.online` with deliberate incorrect password `IncorrectTestPassword123!`.
   - Click Submit.
   - *Pass*: Login rejected with explicit error message ("Invalid email or password"). Session is not created.
   - *Fail*: Successful login or silent hang.
5. **Positive Login Test (Verified Account)**:
   - Enter `ethan9b21b@ultrmigos.online` with valid deterministic password.
   - Click Submit.
   - *Pass*: User authenticated; redirected to dashboard / record screen (`/en` or `/en/rekam`); user profile or session indicator visible; protected routes accessible.
   - *Fail*: User redirected back to login, remaining in unverified status, or session cookie not issued.

---

## 7. Stop Rules and Circuit Breakers

Execution MUST immediately halt under any of the following conditions:

1. **Anti-Bot Challenge Encountered**:
   If `generator.email` or `localhost:3100` presents Cloudflare challenge, hCaptcha, reCAPTCHA, or bot-mitigation page:
   - Action: Halt test execution immediately.
   - Artifact: Save full-page screenshot to `.amp/in/artifacts/antibot-challenge.png`.
   - Report: Log exact URL, challenge type, and timestamp. Never attempt bypass or headless evasion scripts.
2. **Fresh Registration Failure**:
   If registration of `ethan9b21b@ultrmigos.online` fails on `localhost:3100`:
   - Action: Halt test execution.
   - Report: Log response status, UI error state, and server log snippet. Do NOT fall back to reusing `liam25e2b@ycalstore.shop`.
3. **Inbox Delivery Timeout**:
   If verification email is not visible in `https://generator.email/ethan9b21b@ultrmigos.online` within 300 seconds (with 1 refresh at 150 seconds):
   - Action: Halt test execution.
   - Report: Mark suite BLOCKED due to public mail transport delay; do not bypass with database queries.
4. **Akeyless Secret Unavailable**:
   If `/suara-lapangan/credentials/demo-user` cannot be retrieved via CLI:
   - Action: Halt test execution.
   - Report: Missing credential path; do not guess or hardcode fallback passwords.

---

## 8. Artifact and Evidence Format

Execution will produce a structured markdown report at `.amp/in/artifacts/register-login-e2e-evidence.md` detailing:
- Test execution timestamps and environment variables.
- Step-by-step audit table with action, expected behavior, observed behavior, exit codes, and pass/fail status.
- Screenshot artifacts stored in `.amp/in/artifacts/`:
  - `01-register-page-loaded.png`
  - `02-scenario-a-fresh-register-submitted.png`
  - `03-scenario-b-duplicate-rejected.png`
  - `04-scenario-c-inbox-email-received.png`
  - `05-scenario-c-verification-confirmed.png`
  - `06-login-negative-rejected.png`
  - `07-login-positive-authenticated.png`
- Absolute zero git commits or pushes.

---

## 9. Out of Scope

The following areas are explicitly excluded from this specification:
1. Public domain deployment or DNS/ingress routing.
2. Stress, concurrency, or volumetric load testing.
3. Password recovery / forgotten password reset workflow.
4. Third-party OAuth authentication (Google, GitHub, Apple).
5. Mobile viewport or native touch emulation testing (standard desktop 1280x720 Chromium only).
