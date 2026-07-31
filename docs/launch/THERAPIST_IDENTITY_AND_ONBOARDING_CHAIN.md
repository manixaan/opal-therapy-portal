# Therapist Identity & Onboarding Chain

Stage 2 fix (2026-07-31) for the audit's "empty calendar" trap: a UI-invited
therapist could end up with no `therapist_profile`, an empty calendar, no
place on the master view, and no screen to repair any of it — while the
booking screen attributed everything to the first practitioner (Ann) and
the sync pill showed someone else's mailbox as connected.

## The chain, as enforced now

```
Owner invites therapist  (Settings → Users & Roles → Invite)
  └─ "Treating therapist" toggle — DEFAULT ON for the therapist role
      ↓ registration (invite token)
User created, role=therapist, therapist_profile CREATED + linked
      ↓ onboarding wizard (9 steps)
SAFETY NET: completing onboarding provisions the profile if it is
somehow missing (also: promoting any user to therapist provisions one)
      ↓
Owner links the Splose practitioner id
  (Settings → Users & Roles → Team setup → "Link Splose ID";
   backend: PUT /api/therapists/:id — owner-only)
      ↓
Therapist connects Outlook (Settings → Integrations)
      ↓
Calendar shows THEIR mirror (events stamped with their profile id;
events synced before the profile existed are back-filled automatically)
      ↓
Splose access practitioner-scoped (Stage 1 RBAC: forced to own mapping,
fail-closed `practitioner_mapping_required` when unlinked)
```

## What changed

| Piece | Before | Now |
|---|---|---|
| Invite modal | No treating-therapist option → profile never created | Toggle, default ON for therapist role; flag flows through the existing `registerUserFromInvite` path (`database.js:1556-1584`) |
| Onboarding completion | Nothing | `ensureTherapistProfile()` safety net at the review step and at `complete-profile` (`register-routes.js`), idempotent, back-fills unstamped events |
| Role promotion | Role changed, no profile | `PATCH /api/admin/users/:id/role` → therapist provisions a profile |
| Missing-profile visibility | Silent | **My Profile → "Account setup status" card** (`GET /api/profile/setup-status`): role, onboarding, therapist profile, Splose link, Outlook (own!), travel base + ordered next actions incl. "Complete therapist profile setup" |
| Owner visibility | None | **Settings → Users & Roles → "Team setup status"** (`GET /api/admin/team-setup`, owner/admin): per-member chain badges + one-click "Create profile" / "Link Splose ID" actions (no more curl) |
| Booking practitioner | Hardcoded `practitioners[0]` (= Ann) + hardcoded confirm name | Resolved from the signed-in user's own mapping; owner/admin fall back to the practice default **shown by name**; unmapped therapist → booking disabled with an honest state |
| Header identity | Hardcoded "Ann Mary Mathew" badge | Bound to the signed-in user |
| Outlook status | Org-wide fallback (someone else's mailbox) | Strictly per-user (see Stage 2 Outlook fixes) |

## Data model (unchanged — no migration needed)

`users.therapist_profile_id` ↔ `therapist_profiles(user_id UNIQUE)`;
`therapist_profiles.splose_practitioner_id` is the Splose scope key
(Stage 1 RBAC reads it via the `getUser` join as `tp_splose_practitioner_id`);
`events.therapist_profile_id` stamps calendar rows (back-filled on
provisioning). `ensureTherapistProfile` only ever creates for
`role='therapist'` — admins/owners never get implicit profiles.

## Owner runbook for a new therapist (the happy path)

1. Pre-work: M365 mailbox in the practice tenant; Splose practitioner
   record created (note its ID).
2. Settings → Users & Roles → Invite: email + name, role Therapist,
   leave "Treating therapist" ON → send (or Copy link if email is not
   configured).
3. Therapist registers, verifies (or you approve directly from Team),
   completes onboarding.
4. Settings → Users & Roles → Team setup: confirm profile ✅, click
   **Link Splose ID**, paste the practitioner ID.
5. Therapist connects Outlook (Settings → Integrations).
6. Verify on Team setup: all badges green; their calendar shows their
   mirror within ~2 minutes.

## Proof

`tests/integration/stage2-pilot-readiness.itest.js`: invite-path profile
creation + linking; onboarding-completion provisioning incl. event
back-fill; idempotency; role-promotion provisioning; no implicit profiles
for non-therapists; setup-status truthfulness before/after; team-setup RBAC
+ token-free payloads. Frontend static guards pin the UI half
(`tests/frontend-stage2-guards.test.js`).
