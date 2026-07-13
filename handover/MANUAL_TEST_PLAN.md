# MANUAL_TEST_PLAN.md — Role-based end-to-end checklist

> Run in a staging environment against a real (test) Outlook + Splose + SMTP. Mark ✅/❌/N-A.
> ⚠ marks steps that will fail today due to a known bug — see KNOWN_ISSUES.md. Test them so you confirm the fix later.

## Setup preconditions
- [ ] `.env` fully set (ENVIRONMENT_VARIABLES); `ALLOWED_EMAILS` includes the first-owner address
- [ ] Server boots; `GET /health` returns healthy
- [ ] A test Outlook mailbox and a test Splose account are available
- [ ] SMTP configured (or watch server logs for the printed links)

---

## A. OWNER

### Registration → first login (bootstrap)
- [ ] Register the owner email (allowlist path) → account created, verification email/link received
- [ ] Verify email → status advances; owner auto-active (first-owner bootstrap) → can log in
- [ ] Login → lands on onboarding (profile_completed=false)

### Onboarding
- [ ] Step through profile / work-location / travel-bases / notifications
- [ ] ⚠ Outlook connect step (KNOWN_ISSUES #4 — expected to fail today; connect later via Settings)
- [ ] Review step → app opens

### Outlook connection (Settings)
- [ ] Settings → Integrations → Connect Outlook → Microsoft login → redirected back "connected"
- [ ] Sync status shows "connected · <email> · N events"; events appear on the calendar within ~90 s

### Organisation settings
- [ ] Settings → Business/Org → change km rate, feature flags → save → reload persists
- [ ] Non-owner cannot see owner-only org fields (verify with a therapist account)

### User management  ⚠ (KNOWN_ISSUES #2 — list fails today)
- [ ] User list loads (all users, statuses)
- [ ] Invite a therapist → invite email/link received
- [ ] Invite a read_only user  ⚠ (KNOWN_ISSUES #9 — rejected today)
- [ ] Approve a pending_approval user → approval email sent → that user can log in
- [ ] Change a user's role → reflected on their next `/api/auth/me`
- [ ] Suspend a user → their active session is invalidated (they're logged out on next action) → login blocked with "suspended"
- [ ] Reactivate → they can log in again

### Appointments / calendar / sync — see shared section S below (owner sees all via master calendar)
- [ ] Master calendar loads (⚠ empty until real therapist_profiles exist)

### Notifications / password
- [ ] Notifications panel loads; billing-readiness + team-profile checks visible (owner-only)
- [ ] ⚠ Change password (KNOWN_ISSUES #1 — 500 today)
- [ ] Bug report submit → appears in logs/notifications

---

## B. ADMINISTRATOR
- [ ] Login as admin (created via invite or role-change)
- [ ] Can view all calendars / master calendar; **cannot** see financial fields (verify a booking's rate is absent in API response)
- [ ] Can invite therapists only (not owner/admin) — owner/admin invite attempt → 403
- [ ] Can approve/suspend therapists; cannot manage owners
- [ ] Leave/CPD approval: approve a therapist's leave and CPD → status updates, therapist sees it
- [ ] Appointments/sync — shared section S

---

## C. THERAPIST
### Account
- [ ] Register via invite token → verify email → pending_approval → after owner approval, login → onboarding → app
- [ ] Login lands on own calendar only

### Employee settings
- [ ] My Settings: change time format, calendar hours, default duration → persists across reload
- [ ] Work-location schedule: set locations for the week → saved (drives travel + Friday alarm)
- [ ] Notification prefs toggle → persists

### Calendar isolation
- [ ] Only own events visible; `/api/calendar/events?therapistIds=<someone else>` still returns only own (server-forced)
- [ ] No access to `/api/admin/*`, master calendar, org settings (403)

### Appointments/sync — shared section S
### Leave / CPD / Credentials
- [ ] Submit leave → appears as submitted → owner/admin approves → status updates
- [ ] Submit CPD activity + hours → CPD progress notification reflects it
- [ ] Add a credential with expiry <90 days → expiry notification appears at the right threshold
- [ ] Upload a PD document (<5 MB) → listed; >5 MB → 413

### Password
- [ ] ⚠ Change password (KNOWN_ISSUES #1)
- [ ] Forgot password → email link → reset → old sessions invalidated → login with new password

---

## D. READ-ONLY USER
- [ ] Create via role-change (invite path blocked today — #9)
- [ ] Can view calendars/clients per read_only permissions
- [ ] **Every write is blocked (403)**: create booking, edit, delete, approve, change settings, manage users
- [ ] Read-only clearly indicated in the UI (verify no dangling active write buttons that then 403)

---

## S. SHARED — appointments, sync, calendar (run per role that can book)

### Appointment creation
- [ ] Smart Booking → client session: pick patient, type, slot → "Write to Splose" → success modal shows Splose ✓ + Outlook status
- [ ] The new event appears on the calendar immediately, on the correct date/time (Perth)
- [ ] Refresh (Cmd/Ctrl-R) → event still there, on the same week
- [ ] Confirm in Splose UI the appointment exists; confirm in Outlook the event exists
- [ ] Non-client booking (email/admin/noting/custom): step 1 → step 4 → creates Outlook-only event (no Splose); success modal notes Splose-manual
- [ ] Drag-to-book on the grid: duration preserved; correct date after navigating weeks

### Appointment editing
- [ ] Edit an Outlook-backed event's time/title in the app → reflected in Outlook within seconds; no duplicate created
- [ ] Set a manual routing address on an Outlook event → written to Outlook; survives next sync (not overwritten)
- [ ] Edit the same event in Outlook directly → app reflects it within ~90 s (manual address preserved)

### Appointment deletion
- [ ] Right-click event → Delete → gone from app AND Outlook
- [ ] Delete in Outlook directly → gone from app within ~90 s
- [ ] Delete an already-deleted event (double action) → no error, stays gone (idempotent)

### Outlook → app sync
- [ ] Create an event in Outlook → appears in app within ~90 s (or seconds if webhooks fixed+enabled)
- [ ] Run "Sync now" ⚠ (KNOWN_ISSUES #5 — no-op today) vs waiting for the poll

### Splose sync
- [ ] Create an appointment in Splose UI → appears in app after a Splose poll / booking-screen load
- [ ] Cancel an appointment in Splose UI → removed from app within 15 min (and from Outlook)
- [ ] ⚠ Data-safety: (in staging only) simulate a Splose empty/failed response → confirm the app does NOT delete everything (KNOWN_ISSUES #7 — expected to fail until fixed)

### Calendar live refresh
- [ ] With two browsers logged in as the same user: change a calendar event in one → the other refreshes via socket (no manual reload)

### Stability
- [ ] Book one appointment, then let 3 full sync cycles pass (~5 min) → event count stable, no duplicates (check `/api/sync/diagnostics`: possibleDuplicates empty, ghostCandidates low)

---

## E. Cross-cutting

### Mobile layout
- [ ] Load the app at 375px width (phone): tabs, calendar, Smart Booking, settings are usable/scrollable; no horizontal page scroll; modals fit

### Error states
- [ ] Log out → protected pages redirect to /login
- [ ] Expired/idle session (>8 h) → next action returns 401 → redirect to login
- [ ] Suspended mid-session → next action logs out

### External API failure handling
- [ ] Stop/deny Splose (bad key in staging) → Splose tabs show an error/toast + a durable notification; calendar (Outlook) still works
- [ ] Revoke Outlook token → sync stops; a token-expiry notification appears; reconnect via Settings restores it
- [ ] Remove GOOGLE_MAPS_API_KEY → travel/geocode return 503 gracefully; rest of app unaffected
- [ ] SMTP down → registration still succeeds; link is logged; no crash
