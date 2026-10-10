/opal-critical

# Opa Mobile Companion

**Idea**

Opa Mobile Companion

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

- `backend/mobile-routes.js` — `requireAuth` only; header comment documents strict `user_id`/own-profile scoping (self-scoped by design, same pattern as `snapshot-routes.js`).
- `backend/case-note-routes.js` — `requireAuth` on `/api/mobile/case-note-drafts` and `/api/mobile/ai/case-note`.

## Start here

This is the Case Noting pilot's own checklist in the tracker, not a code task — walk through it on the test device (dictation → AI summary → save) and tick items as they're confirmed. Because the dictation pipeline touches clinical content and an AI gateway call, treat any code fix that comes out of that walkthrough as CRITICAL level: read `.claude/rules/ai-gateway.md` first.

## Done means

The tracker's own "Case Noting" checklist reaching sign-off — code evidence is already solid (105 unit + 6 integration tests passing).

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
