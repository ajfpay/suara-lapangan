# 02: Admin dashboard + "Dokumen saya" + document ownership

**What to build:** an admin-only `/admin` dashboard in Indonesian (user list, enable/disable user, all documents, usage and daily cost, per-user cost limit) and a customer "Dokumen saya" page listing and opening their own documents. Documents gain a nullable `user_id` recorded at creation; legacy ownerless rows stay null and are visible to admins only. Resumes the backend already drafted on `agent/11-auth-admin` (migrations 0005_auth_tables.sql, 0006_documents_user_id.sql, quota changes).

**Blocked by:** 01

**Status:** ready-for-agent

**Findings from the paused provider thread:**
- The admin seam must read `role='admin'` from the `0005_auth_tables.sql` schema (which already defines role and ban columns plus `scripts/seed-admin.mjs`), not invent a second role source.
- The cost meter overstates: cached tokens are read nowhere, and the documents route meters a flat `$0.005` per document. The per-user cost limit must be applied against the real meter.

- [ ] `/admin` reachable only by users with the admin role (read from `0005_auth_tables.sql`); non-admins redirected
- [ ] Admin dashboard lists users with enable/disable action
- [ ] Admin dashboard lists all documents with status and owner
- [ ] Admin dashboard shows usage and daily cost per user and in total
- [ ] Admin can set a per-user cost limit; the hard-stop honours it
- [ ] "Dokumen saya" lists only the signed-in customer's documents
- [ ] A customer can open one of their documents and reach Unduh/Kirim
- [ ] Legacy ownerless documents visible to admins only
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green
