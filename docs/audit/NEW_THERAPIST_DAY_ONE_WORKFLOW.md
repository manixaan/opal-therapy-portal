# New Therapist — Day-One Workflow Audit

What actually happens, step by step, if the new therapist started today.
Repo evidence at `8c893bf`. Verdicts: ✅ works · ⚠️ works with traps · ❌ broken/absent.

**Pre-work the owner must do before ANY of this** (outside the portal):
M365 mailbox for the therapist in the practice Entra tenant (the app
registration is tenant-scoped — `outlook-oauth.js:22`); Splose practitioner
record created and its ID noted; decision on which environment they use
(see HOSTING doc); synthetic accounts cleaned off that environment.

---

### Step 1 — Owner creates/invites therapist ⚠️→❌

Settings → Users & Roles → Invite works and creates a valid 14-day invite
(`invite-routes.js:53-160`). **But**: the UI toast says "✓ Invite sent!"
unconditionally while no email infrastructure exists in any environment —
the backend even returns `emailSkipped: true` + the `registerUrl`, and the
frontend ignores both (`mockup_v3.html:22044-22065`). The invite modal has
no "treating therapist" toggle, so the invite is created with
`is_treating_therapist=false` — the root cause of Step 5's failure.
**Missing**: SMTP config; emailSkipped handling; isTreatingTherapist toggle.
**Owner setup first**: EMAIL_HOST/USER/PASS/FROM + APP_BASE_URL app settings.

### Step 2 — Therapist receives invite ❌

No email is ever sent (`email.js:37-39` null transporter → console.log).
The registration link exists only in the Azure log stream, and without
APP_BASE_URL it reads `http://localhost:5001/register?token=…` (`email.js:61`).
**Today's workaround**: owner extracts the link from logs, rewrites the
host by hand, and sends it over Teams/SMS. That is not a launch experience.

### Step 3 — Therapist logs in ⚠️

Register page is decent; password policy enforced; verification email is
again console-only (second log-fishing round). After verifying, the account
lands in `pending_approval` — despite code comments saying invitees skip it
(`auth.js:350`) — and the pending page is static, polls nothing, and
hardcodes `mailto:admin@opaltherapy.com.au` (`pending-approval.html:146`).
The owner must know, unprompted, to go to Settings → Team → Approve (the
approval email to the therapist is also console-only). Login itself: solid.

### Step 4 — Therapist completes onboarding ✅⚠️

The 9-step wizard is genuinely good (persisted resume, OAuth return to the
right step). Traps: the Outlook step works only if Step 7's tenant pre-work
was done; skipping is allowed and nothing follows up on skipped steps.

### Step 5 — Therapist profile populates ❌

Because the UI invite cannot set `isTreatingTherapist`, no
`therapist_profile` row is created (`database.js:1557-1585`), so:
`GET /api/calendar/events` returns `[]` for them (`calendar-routes.js:283-289`),
they never appear on the owner's Master calendar, and **no screen exists to
fix it** — `POST /api/therapists` (which accepts `splosePractitionerId` and
back-fills events) is owner-only API with zero frontend callers
(`calendar-routes.js:170-222`). Today this step is an owner-crafted curl.

### Step 6 — Therapist confirms home/travel base ✅

Work-location schedule + travel bases persist correctly
(`profile-routes.js:640-683`); wizard step exists. Minor: manual address
corrections for Splose clients live in browser localStorage only.

### Step 7 — Therapist connects Outlook ⚠️

The OAuth flow itself is safe and session-correct. Traps:
1. **Masked state**: `/api/sync-status` says connected if ANY org member is
   connected, so before connecting they see a green "Outlook connected"
   pill (showing the owner's mailbox address) over an empty calendar, and
   the Connect banner is suppressed (`routes.js:1055-1077`,
   `mockup_v3.html:15211-15221`). The truthful per-user state is buried in
   Settings → Integrations.
2. Wrong-account sign-in is unrecoverable in-product: **no disconnect
   endpoint exists anywhere**.
3. If sync later dies (refresh-token revocation), the calendar silently
   ages; the only in-app warning is a false daily "expires in 1 hours"
   notification that trains users to ignore alerts (`app-routes.js:277-306`).

### Step 8 — Therapist sees their calendar ⚠️

Once profile + Outlook exist, the week/day/month views render their real
mirror (validated 65=65 for Ann). Traps: **the page never refreshes after
load** (zero polling; socket.io client CSP-blocked — `server.js:95-101` vs
`mockup_v3.html:15137`), while the header pill permanently claims "Synced
with Splose · 14s ago"; stale April-2026 labels appear in block-detail and
move-session dialogs; the cancelled-session drawer's primary button blanks
the whole screen (`mockup_v3.html:12688`).

### Step 9 — Relevant Splose/client data ⚠️ (works — too well)

There is no caseload concept: every authenticated account gets the entire
practice — all clients (names, addresses, NDIS numbers, phones), all
practitioners' appointments, and via the visible Activity tab, invoice and
payment amounts (`routes.js:1563-2101` requireAuth-only;
`mockup_v3.html:17853-17866`). The therapist will see everything on day
one; whether that is acceptable is an owner decision that currently isn't
being made consciously. Booking anything would book **as Ann**
(`practitioners[0]`, `mockup_v3.html:7794`).

### Step 10 — Resource Hub ❌ (empty)

The tab works read-only, but there is no content anywhere (zero folders,
zero resources), no authoring UI to add any, and the upload API 413s on
files >~75KB due to the global 100KB body limit (`server.js:140-142`).
Unless seeded first, week one shows "No approved resources yet."

### Step 11 — Submit leave/availability ⚠️

Submitting works; owner approve/reject works. But: the form promises
"Once approved, the leave period blocks scheduling in Splose" — **false**
(approved leave touches nothing); "The staff member will be notified" —
**false** (no notification of any kind is generated); no balances exist;
and these flows have never been exercised by a real user (all tables 0 rows).

### Step 12 — PD/CPD information ⚠️

Logging CPD hours works, approval works, behind-30h nudge works. No dollar
allowance exists; the 30h target is hardcoded; uploaded PD documents can't
be downloaded from the UI and the owner can't see them at all.

### Step 13 — Internal documents/policies ❌

No induction checklist, policies, supervision structure, or staff emergency
contacts exist in any form. The Resource Hub is the intended home and it is
empty (Step 10).

### Step 14 — Owner monitors setup completion ⚠️

The owner can see: pending approvals, team list with roles, per-user
integration status (Settings), onboarding completion flag, notifications
centre (if they reload). There is no single "new-starter checklist" view;
sync-death produces no alert; and pending leave/CPD sits invisible until
the owner happens to open My Profile.

---

## Verdict

**Today, the day-one flow stalls at Steps 1–2 (dead email), breaks at
Step 5 (no profile → empty calendar, no UI fix), and misleads at Steps 7–9.**
Every failure has a known, small fix — see ROADMAP stages 1–2. The
minimum set to make this workflow real: SMTP + APP_BASE_URL; invite UI
surfacing links + isTreatingTherapist; profile-creation control (or a
documented owner API step in the runbook); per-user sync-status; seeded
Resource Hub; corrected leave/notification copy; and a printed one-page
onboarding runbook for the owner (sequence above) plus a 2-page therapist
quick-start. None of this is large; all of it is currently missing.
