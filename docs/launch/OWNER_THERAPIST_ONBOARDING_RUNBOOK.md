# Owner Runbook — Onboarding a Therapist

For Antony. Every step is a click in the portal unless marked TERMINAL.
Dry-run-validated end-to-end on staging 2026-07-31 (19/20; the only
untested step is a real Outlook mailbox connect, which happens live here).

## Pre-work (outside the portal, once per therapist)

1. **M365 mailbox** for the therapist in the practice tenant (their portal
   Outlook connection only works with a practice-tenant account).
2. **Splose practitioner record** created — copy its practitioner ID
   (Splose → Team; ask the developer if you can't find the ID).

## The chain (10 minutes of clicking)

1. **Invite**: Settings → Users & Roles → Invite Team Member → email +
   name → role **Therapist** → leave **“Treating therapist” ticked** →
   Send invite.
2. **Copy-link fallback** (email not configured yet): the modal shows the
   registration link with a **Copy link** button — send it to the
   therapist yourself (SMS/Teams), to them only: the link is what lets them
   create the account. Later: their row in Users & Roles → **Copy link**
   retrieves it again (each retrieval is audit-logged). If the invite has
   expired, **Resend** renews it with a fresh link (the old one stops
   working); Resend says "Email not sent — copy the link instead" when email
   is not configured.
3. **They register from the link**: opening the invitation link and choosing
   a password makes their account **active straight away**. There is
   nothing for you to approve and no verification email. They must use the
   link: typing their email into the register page does not find the
   invite. (**Approve** is only for people who self-registered through the
   allowlist, and only after they have verified their email. A row that
   says "waiting for email verification" cannot be approved.)
4. **Check the profile**: Settings → Users & Roles → **Team setup status** —
   their row should show `account ✅ onboarding … profile ✅`. If profile
   shows ⚠ (only possible if the treating toggle was off), click
   **Create profile**.
5. **Link Splose**: same row → **Link Splose ID** → paste the practitioner
   ID from pre-work. Their row shows `Splose link ✅`.
6. **Role check**: their chip says `therapist`; they should NOT see
   Billing/NDIS/Dormant/Accounting tabs (spot-check by asking them).
7. **Outlook — before they connect**: their row shows `⚠ Outlook` and
   THEIR calendar shows "Outlook not connected" — correct and honest.
8. **Support the connect**: they do Settings → Integrations → Connect
   Outlook with the PRACTICE Microsoft account. Wrong-account fix:
   **Disconnect** on the same screen, then reconnect properly.
9. **Verify the mailbox**: Team setup row now shows `Outlook: <their
   practice address>` + a last-sync time. If it shows any other address,
   have them Disconnect and reconnect.
10. **Verify Splose scoping**: ask them to open their calendar/appointments
    — they should see only their own; if they report a
    "not linked to a Splose practitioner" message, redo step 5.
11. **Resource Hub**: they can open it and see the starter folders
    (Induction folder first).
12. **Leave path**: have them submit a draft leave request and delete it;
    remind them approvals are manual and don't auto-block Splose yet.
13. **Audit check** (optional): the audit log records the invite, link
    retrievals, approval, profile/mapping changes and their logins.

## Offboarding / suspension (any staff member)

Settings → Users & Roles → **Suspend** (kills their sessions immediately).
Suspend and Deactivate also release their Outlook connection: tokens,
connected mailbox and sync state are cleared, so their calendar stops
syncing (nothing changes in Outlook itself). If they are re-activated they
reconnect Outlook from Settings → Integrations. Their mirrored events and
records remain (soft-delete policy).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Invite email never arrived | Expected while SMTP is unconfigured — use **Copy link** (Pending invites) |
| “Pending approval” after registering | They self-registered through the allowlist and verified their email: Users & Roles → Approve |
| “Pending email” / waiting for email verification | They self-registered but have not clicked the verification email yet. Approve is refused until they do — ask them to check their inbox for the verification email |
| Wrong mailbox connected | Their Settings → Integrations → Disconnect → reconnect with the practice account |
| Calendar empty after connect | Wait 2 min (first sync); still empty → check Team setup shows a last-sync time; none → have them reconnect; still stuck → developer |
| “Not linked to a Splose practitioner” | Runbook step 5 (Link Splose ID) |
| Profile row shows ⚠ profile | Team setup → Create profile |
| Data looks stale | Header pill click = refresh; pill shows real sync ages — if hours old, see calendar-empty fix |
| Anything else | Screenshot + exact time → developer. Nothing they do can write to Outlook/Splose/Xero during the pilot |

## TERMINAL — only two owner terminal jobs exist

- SMTP setup (once): the exact session is in
  `docs/launch/EMAIL_AND_INVITE_SETUP.md`.
- Production provisioning (if you approve Option B): the developer runs it
  from `docs/launch/PRODUCTION_ENVIRONMENT_CUTOVER_PLAN.md` after your
  explicit go-ahead.
