# 05: Consolidated E2E Evidence Report Generation

**What to build:** An automated summary generator that aggregates command exit codes, test execution outputs, and screenshot references into the final delivery artifact (`.amp/in/artifacts/register-login-e2e-evidence.md`) without making any git commits or branch pushes.

**Blocked by:** 04 (Public Inbox Verification and Session Authentication)

**Status:** ready-for-agent

---

## Owned Files and Artifacts

- `~/repos/.scratch/register-login-e2e/scripts/generate-report.ts`
- `.amp/in/artifacts/register-login-e2e-evidence.md`

**Boundary Justification:** Reporting scripts and generated evidence artifacts reside outside application repositories to prevent repository clutter.

---

## Steps

1. Implement `scripts/generate-report.ts` to parse test run outputs and verify that all expected screenshot files exist under `.amp/in/artifacts/`.
2. Generate `.amp/in/artifacts/register-login-e2e-evidence.md` with:
   - Header: Execution metadata (target URL, timestamp, node version, browser engine).
   - Prerequisite Check Table: Concrete verification commands and observed exit codes.
   - Scenario Audit Table: Step-by-step matrix with Action, Expected Result, Observed Result, Exit Code, and Status (`PASS`/`FAIL`/`BLOCKED`).
   - Visual Evidence Section: Markdown image links and file paths for all 7 required screenshots (plus anti-bot screenshot if triggered).
   - Compliance Verification: Explicit assertion that zero git commits, branches, or pushes were created.

---

## Acceptance Criteria

- [ ] `scripts/generate-report.ts` compiles and generates `.amp/in/artifacts/register-login-e2e-evidence.md`.
- [ ] Evidence report includes every scenario step with concrete exit codes and results.
- [ ] Evidence report links all captured screenshots in `.amp/in/artifacts/`.
- [ ] Execution produces zero git commits, branches, or pushes across any repository.
- [ ] Zero files modified in `/home/ubuntu/repos/suara-lapangan-hackathon-pr` or `/home/ubuntu/repos/e2e`.
