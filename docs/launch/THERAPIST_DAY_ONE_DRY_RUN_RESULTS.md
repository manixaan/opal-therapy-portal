# Therapist Day-One Dry Run — Results

Executed 2026-07-31 against staging (`opal-portal-staging.azurewebsites.net`,
build `f2496f7`) with a scratch therapist account
(`dryrun2.therapist@example.test`, invited → registered → approved →
onboarded → suspended afterwards). Read-only toward Outlook/Splose/Xero;
only local app data was created, and it was cleaned up (invite consumed,
draft leave rows deleted, account suspended). All write flags off
throughout.

## Results (20-step checklist)

| # | Step | Result | Evidence/notes |
|---|---|---|---|
| 1 | Owner invites therapist | ✅ | Invite created with treating-therapist flag via API (modal carries the same flag) |
| 2 | Email or copy-link works | ✅ | No SMTP on staging → response honestly `emailSkipped:true`; copy-link `https://opal-portal-staging…/register?token=…` (never localhost) |
| 3 | Therapist accepts invite | ✅ | Registration via invite token accepted |
| 4 | Therapist logs in | ✅ | After owner approval (the no-SMTP escape hatch: approve accepts `pending_verification`) |
| 5 | Onboarding completes | ✅ | Review step 200, `onboardingComplete:true` |
| 6 | Therapist profile created | ✅ | Profile existed already at registration (invite flag) and the onboarding safety net is idempotent — `therapistProfile.exists:true`, persisted |
| 7 | Home/travel base state | ✅ | Not yet set → setup card correctly lists the `travel_base` next action |
| 8 | Accurate Outlook not-connected state | ✅ | `outlookConnected:false`, `status:not_connected`, `connectedAs:null` — **no other user's mailbox shown** (the old org-wide fallback is gone) |
| 9 | Connect Outlook test mailbox | ⚠ NOT VALIDATED | No test M365 mailbox exists for the scratch account. The connect flow itself is unchanged-and-validated for Ann's real account, and the callback now 302s into the app (integration-tested). Real validation happens with the real therapist's mailbox |
| 10 | Calendar shows only own data | ✅ | Scratch calendar empty — zero events from Ann/anyone else; no Ann default anywhere |
| 11 | Splose mapping state clear | ✅ | Fresh unmapped account fails closed with `practitioner_mapping_required` (live-verified on staging today); setup card lists/clears the mapping action truthfully; owner linked an ID via the Team-setup path (PUT /api/therapists/:id) and the therapist's card updated |
| 12 | Cannot access all Splose clients | ✅ | 403 |
| 13 | Cannot access invoices/payments | ✅ | 403 + 403 |
| 14 | Cannot write Splose | ✅ | 403 `feature_disabled` (flag off, gate holds even with a mapping) |
| 15 | Cannot access owner accounting | ✅ | 403 |
| 16 | Can view Resource Hub | ✅ | 200 (content still empty — seeding is a Stage 3 owner task) |
| 17 | Can request leave | ✅ | Draft created + deleted (dry-run script initially mis-read the response key; verified directly: `leaveRequest.id` returned) |
| 18 | Owner sees setup status | ✅ | Team-setup shows onboarding ✓, profile ✓, Splose link ✓, Outlook not connected, travel base pending — no token material in the payload |
| 19 | Logout/login persists state | ✅ | Re-login OK; profile + mapping persisted |
| 20 | No confusing fake success | ✅ | Fake sync pill gone from the served build; truthful invite email states present (both verified on the served HTML) |

**Effective result: 19 of 20 validated; step 9 (real Outlook mailbox
connect for a brand-new account) is the single deliberate gap** — it needs
a real M365 mailbox and will be executed as the first step of the real
therapist's onboarding (the same flow is proven for Ann's account, and the
new per-user status/disconnect/callback behaviours are integration-tested).

## What could NOT be validated, exactly

1. Step 9 as above (no test mailbox).
2. Splose scoping against REAL practitioner data: the owner-link flow used
   a placeholder ID (`dryrun-prac-test`), which proves enforcement and the
   owner workflow but not real-appointment retrieval; that occurs when the
   real therapist's actual Splose practitioner ID is linked.
3. Email delivery end-to-end (SMTP not configured — copy-link path
   validated instead; see EMAIL_AND_INVITE_SETUP.md for the owner session).

## Dry-run artifacts + cleanup log

- `dryrun.therapist@example.test` — first attempt, stalled by a script bug
  (shell `UID` readonly), account left `pending_verification`, then
  suspended. No profile/mapping/data.
- `dryrun2.therapist@example.test` — full chain executed; **suspended** at
  the end (sessions killed). Retained suspended as pilot reference; delete
  or reuse for the next dry-run at will.
- Draft leave rows: deleted (both the dry-run row and a shape-probe row on
  synthetic.therapist).
- Invites: consumed/revoked — zero pending invites for dry-run addresses.

## Script-vs-app honesty note

The scripted run reported 29/33; the four scripted FAILs were script
defects or ordering artifacts, each re-verified directly: (11a/11b) the
resumed account already had its mapping — the *fresh* fail-closed state
was re-proven live on `synthetic.therapist`; (17) wrong JSON key in the
script; (20b) the 1.17 MB HTML fetch flaking under the script's timeout —
marker confirmed present directly. No app defect was found by the dry run.
