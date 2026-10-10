/opal-feature

# Portal Onboarding Workflow

**Idea**

Portal Onboarding Workflow

**Why**

(not yet written in the tracker)

**Who uses it**

(not yet written in the tracker)

**What they see**

(not yet written in the tracker)

**What should happen**

(not yet written in the tracker)

**Outcome**

(not yet written in the tracker)

**Decision**

(not yet written in the tracker)

## Where it lives today

- 11 route files under `backend/onboarding-*-routes.js` (plus the legacy `onboarding-routes.js`), all guarded with `requireAuth` at minimum; 10 of 11 add `requireRole`/`requirePermission` on top for sensitive actions.
- SharePoint document storage (the rest of Stage 2): **confirmed not started** — the only `sharepoint` hit anywhere in `backend/` is a CSP allowlist domain in `server.js`, no implementation code exists.
- Frontend: `ONBOARDING TAB` banner (`mockup_v3.html:4162`), `frontend/current/onboarding.js`.

## Start here

Add SharePoint document storage to Stage 2's pack-finalise step. Start in `backend/onboarding-pack.js` / `backend/onboarding-pack-routes.js` where the finished pack is currently only written locally — follow the existing OneDrive/Graph pattern in `backend/graph-identity.js` for auth, and check `.claude/rules/backend-api.md` before adding the new write path. Separately: this sandbox's one failing onboarding test needs the `@tesseract.js-data/eng` package actually present in `node_modules` to re-verify (not a code change).

## Done means

A passing integration test that confirms a finished onboarding pack lands in SharePoint — label would move toward `proven` once Stage 2 fully closes.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
