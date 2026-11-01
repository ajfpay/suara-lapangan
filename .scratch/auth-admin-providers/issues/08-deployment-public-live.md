# 08: Deployment — public repo + live deployment

**What to build:** make the repository public and ship a live deployment the judges can open, plus the infra prep (Dockerfile, CI, env example) needed to run it. The public flip itself requires the owner's written approval; infra prep can land in parallel.

**Blocked by:** 01, 02, 03, 04

**Status:** blocked — waiting on the owner's written approval to make the repository public and to choose the deployment host. Do not start.

- [ ] Dockerfile and CI build the app and run tests
- [ ] `.env.example` documents all required env vars (MODEL_API_KEY, DB, auth secrets, encryption key)
- [ ] A live deployment URL is reachable by judges
- [ ] Repository is public (owner approval recorded)
- [ ] Secret scan clean before the flip
- [ ] README updated with the live URL
