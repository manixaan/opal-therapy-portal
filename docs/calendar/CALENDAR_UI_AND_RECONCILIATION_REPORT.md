# Calendar UI & Reconciliation Report — 2026-07-27

## Root causes (proven, docs/calendar/CALENDAR_RECONCILIATION_2026-07-27.md)
1. **Double mirror** — synthetic.owner's Outlook connection had been
   re-pointed to Ann's mailbox; every event existed twice → phantom
   "extras" + mass conflict blocks from twin self-overlap.
2. **seriesMaster records stored as events** — Graph sync feeds include
   recurring-series masters; stored at series pattern time (8 h offset)
   they rendered as ghost blocks alongside the real occurrences.
3. "(No subject)" blocks: frontend artifacts of 1+2 — zero empty-subject
   events exist in Graph or the DB.

## Data changes (owner-approved cleanup, audited, soft-delete only)
12 seriesMaster rows + synthetic.owner's 5,140-row duplicate mirror
tombstoned; synthetic.owner disconnected; delta state removed. Ann's mirror
untouched. Snapshot exported pre-change. Nothing touched Outlook/Splose.

## Code changes (deployed via run 30234306014, all green)
- `upsertOutlookEvent` skips `type='seriesMaster'` (DB choke point) +
  explicit skip in initial-sync mapping — regression itest added
- `GET /api/calendar/reconcile` (owner/admin, redacted, read-only)
- **Outlook-only toolbar toggle** (owner/admin): renders only
  source=outlook events, suppresses derived decorations — 1:1 comparison
- Conflict marking operates on rendered visible tiles (verified design);
  with twins gone, self-overlap conflicts are gone
- Restrained visual pass: compact tiles, thinner borders, left accent,
  today-circle
- Weekends: 7-day support pre-existed; Mon–Fri was the saved
  "Show weekends" user setting (Settings toggle) — no code change needed

## Validation
- Local: 138 unit + 87 integration, clean exits
- Staging smoke: reconcile RBAC (admin 409-no-connection / therapist 403 /
  unauth 401) ✓ · sync flags all false ✓ · Splose ok ✓ · Accounting 403
  for therapist ✓ · Resources 200 ✓
- **Final week comparison (27 Jul–2 Aug): Outlook 65 = mirror 65, zero
  mismatches both directions** (week grew 63→65 during the work and the
  mirror tracked it)

## Remaining limitations
- Owner should flip "Show weekends" in Settings for the 7-day view and
  visually confirm the Outlook-only toggle against Outlook side-by-side
- Reconcile endpoint requires the CALLER's own connection (Ann is
  therapist; owner/admin currently have no connection) — by design; the
  direct comparison above covers validation meanwhile
- Visual refresh intentionally restrained; iterate on feedback
