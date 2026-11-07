# 04: Public Inbox Verification and Session Authentication (Scenario C)

**What to build:** Browser-driven verification of the activation email delivered to `https://generator.email/ethan9b21b@ultrmigos.online`, navigation of the verification link, and subsequent positive/negative login verification on the local application.

**Blocked by:** 03 (Fresh Registration and Duplicate Rejection Tests)

**Status:** ready-for-agent

---

## Owned Files and Artifacts

- `~/repos/.scratch/register-login-e2e/tests/03-inbox-verify-and-login.e2e.ts`
- Screenshots generated into `.amp/in/artifacts/`:
  - `04-scenario-c-inbox-email-received.png`
  - `05-scenario-c-verification-confirmed.png`
  - `06-login-negative-rejected.png`
  - `07-login-positive-authenticated.png`
  - `antibot-challenge.png` (conditional circuit breaker)

**Boundary Justification:** Browser automation scripts and visual artifacts are maintained strictly in the scratch directory. No modifications occur inside target application code.

---

## Steps

1. **Inbox Navigation and Anti-Bot Circuit Breaker**:
   - Launch browser page to `https://generator.email/ethan9b21b@ultrmigos.online`.
   - **Anti-Bot Check**: Inspect page for CAPTCHA, Cloudflare challenge, or bot detection. If detected:
     - Save screenshot to `.amp/in/artifacts/antibot-challenge.png`.
     - STOP test run immediately and report `BLOCKED (Anti-bot detected)`. Do NOT attempt circumvention.
2. **Email Delivery and Link Extraction**:
   - Poll inbox up to 300 seconds (5 minutes) for message from Suara Lapangan.
   - If not visible at 150 seconds, execute one page reload.
   - If message fails to arrive by 300 seconds, halt suite with status `BLOCKED (Email delivery timeout)`.
   - Once received, capture screenshot `04-scenario-c-inbox-email-received.png`.
   - Extract the verification URL from email content or click the verification CTA button directly.
3. **Email Verification Execution**:
   - Navigate to the verification URL.
   - Confirm successful verification state (redirect to `/en/login` or confirmation notice).
   - Capture screenshot `05-scenario-c-verification-confirmed.png`.
4. **Negative Login Test (Wrong Password)**:
   - Navigate to `http://localhost:3100/en/login`.
   - Submit `ethan9b21b@ultrmigos.online` with invalid password (`InvalidPassword999!`).
   - Assert visible error ("Invalid email or password").
   - Capture screenshot `06-login-negative-rejected.png`.
5. **Positive Login Test (Verified Account)**:
   - Submit `ethan9b21b@ultrmigos.online` with valid deterministic password.
   - Assert redirection to protected dashboard / recording page (`/en` or `/en/rekam`).
   - Confirm active session cookie or user indicator.
   - Capture screenshot `07-login-positive-authenticated.png`.

---

## Acceptance Criteria

- [ ] Inbox at `https://generator.email/ethan9b21b@ultrmigos.online` is inspected via real browser navigation without database-only bypasses.
- [ ] Anti-bot detection triggers immediate hard-stop and screenshot capture.
- [ ] Verification email is located, clicked, and acknowledged by the application.
- [ ] Invalid password login attempt is explicitly rejected with user-visible error.
- [ ] Valid credentials log the newly verified user into an authenticated session.
- [ ] All specified screenshot artifacts exist in `.amp/in/artifacts/`.
- [ ] Zero files modified in `/home/ubuntu/repos/suara-lapangan-hackathon-pr` or `/home/ubuntu/repos/e2e`.
