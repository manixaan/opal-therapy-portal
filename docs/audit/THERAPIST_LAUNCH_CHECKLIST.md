# Therapist Launch Checklist

Concrete go/no-go checklist for giving the new therapist access. Every box
is checkable (no vague items). Boxes marked ⛔ are hard blockers — do not
send login details while any ⛔ is unchecked.

## Technical readiness

- [ ] ⛔ Environment decision executed: production provisioned + DNS
      `portal.opaltherapy.com.au` + managed cert bound, **or** staging
      hardened (NODE_ENV strictness fix applied, deploy freeze agreed)
- [ ] ⛔ HTTPS-only confirmed on the chosen URL (already true today)
- [ ] ⛔ EMAIL_HOST/USER/PASS/FROM + APP_BASE_URL set; test email received
      by a real mailbox (invite + verify + reset each proven once)
- [ ] ⛔ Invite chain dry-run passed end-to-end with a scratch account
      (invite → register → verify → approve → login) with **no log-fishing**
- [ ] ⛔ Therapist role assigned; therapist_profile created with correct
      `splose_practitioner_id` and `outlook_calendar_id`; appears on
      owner's Master calendar
- [ ] ⛔ Splose RBAC fixes deployed (financial routes gated; ungated
      patient-create closed; routes.js on the permissions choke point) —
      or written owner acceptance of whole-practice visibility on file
- [ ] ⛔ All external write flags verified false on the launch environment
      (`ENABLE_OUTLOOK_WRITE`, `ENABLE_SPLOSE_WRITE`,
      `ENABLE_AUTOMATIC_REMOTE_DELETE`, all `ENABLE_XERO_*` writes)
- [ ] ⛔ Synthetic @example.test accounts removed from the launch
      environment; `ALLOWED_EMAILS` stale value cleared (invite-only)
- [ ] Outlook connect-state fixes deployed (per-user status, working
      re-auth, disconnect available)
- [ ] Live refresh working (socket self-hosted or polling); fake sync pill
      removed
- [ ] Fake-success flows removed (booking/case-noting/gap-block/leave copy)
- [ ] Browser/device support stated: Chrome or Edge on a laptop (mobile
      explicitly unsupported for now)
- [ ] Permissions spot-check as the scratch therapist: cannot open
      accounting (403), cannot see Billing/NDIS/Dormant, sees own calendar
      only

## Operational readiness

- [ ] ⛔ Owner onboarding runbook written and rehearsed once (M365 mailbox
      → Splose practitioner → invite → approve → profile → Outlook)
- [ ] ⛔ Therapist quick-start guide (2–4 pages) ready to hand over
- [ ] Support/escalation one-pager: what to do if the calendar looks
      wrong, who to contact, expected response, the emergency sync-stop
      (owner-side)
- [ ] Resource Hub seeded: 12 folders, 2–3 approved items each, including
      induction pack, leave policy note, travel/rural-trip info, key
      templates (owner supplies content; loading path proven)
- [ ] Leave policy note published (types, how to request, what approval
      does and does NOT do yet — no auto-blocking)
- [ ] PD/CPD expectations note (30h target, how to log, evidence uploads)
- [ ] Supervision arrangements communicated (outside the portal for now —
      the portal has no supervision module)
- [ ] First-week check-in scheduled + PILOT_LOG.md started

## Data readiness

- [ ] ⛔ Therapist's M365 mailbox exists in the practice tenant BEFORE
      their Outlook-connect step
- [ ] ⛔ Splose practitioner record exists; ID captured in their profile;
      a test booking in Splose shows up in their portal calendar within
      ~2 minutes
- [ ] First-week calendar reconcile run for THEIR mailbox (repeat the
      65=65 check; keep the output)
- [ ] Travel base/home suburb entered; travel overlay sanity-checked
- [ ] Organisation profile/settings reviewed (practice details correct)
- [ ] No client data seeded anywhere it shouldn't be (portal stores
      mirrors only; confirmed no clinical notes server-side)

## Safety readiness

- [ ] ⛔ One PG restore drill completed and timed on the launch
      environment's server (procedure exists; never yet executed)
- [ ] Blob soft-delete enabled for employee documents
- [ ] Alert rules live: 5xx, health, slow-response (exist) + safety-block
      fired + failed-login burst (to add); alert email monitored by owner
- [ ] Audit log spot-checked (login/approval/document events appearing)
- [ ] Error monitoring glanced daily during week one (App Insights)
- [ ] Rollback plan agreed: suspend the account (kills sessions) — plus
      the gap noted: revoke/clear their Outlook tokens (fix 1.10) —
      nothing else needs to change
- [ ] Offboarding checklist exists (what to do the day anyone leaves:
      suspend, token revocation, document handover, Splose/M365 dedup)
- [ ] Owner knows the KV-rotation gotcha (rewrite app setting, not just
      restart) — runbook corrected

## Final gate

- [ ] All ⛔ boxes checked
- [ ] Security audit C1/C2 + H3/H4/H5 resolved or owner-signed
- [ ] Dry-run therapist account deleted/suspended after test
- [ ] Owner declares go — record date + environment + commit hash here:
      __________________
