# Calendar Reconciliation — week 27 Jul–2 Aug 2026 (Ann's mailbox)

Evidence-based comparison of Graph (source of truth) vs local DB vs rendered
calendar. All checks read-only; no data was modified.

## Ground truth vs mirror

| Layer | Active events in week |
|---|---|
| Microsoft Graph `calendarView` (truth) | **63** (0 cancelled, 11 recurring occurrences, 0 private, 0 empty-subject) |
| Local DB — Ann's mirror | **69** |
| Local DB — synthetic.owner's mirror **of the same mailbox** | 69 (+2 tombstones) |

## Root cause 1 — DOUBLE MIRROR (the big visual culprit)

The `synthetic.owner` account's Outlook connection was re-pointed from
`adminservices@` to **Ann's mailbox** (a reconnect in the owner browser chose
her account). Ann's own account is also connected. Result: **all 138 week
rows are twin-paired** — every real event exists twice. Any aggregated/master
calendar view renders each appointment twice, and conflict detection sees
each event overlapping its own twin → mass conflict blocks. This alone
explains most "events not in Outlook".

## Root cause 2 — RECURRING SERIES MASTERS STORED AS EVENTS (6 rows)

Graph delta sync returns `seriesMaster` records alongside expanded
occurrences. The sync upserts masters as ordinary events. Verified: all 6
DB-not-in-Graph rows are `type=seriesMaster` (weekly series, original tz
W. Australia Standard Time), stored at the series' pattern time — rendering
as an EXTRA block 8 h offset from (and in addition to) the true occurrence
instances that calendarView expands. Every recurring series therefore shows
one phantom block per week plus its real occurrences.

## "(No subject)" and conflict blocks

Neither Graph nor the DB contains any empty-subject event (0/0) — these
blocks are **frontend artifacts of the two defects above** (twin/master
blocks rendered without full title context, and conflict blocks derived from
twin self-overlap). No third data source exists.

## Classification summary

| Class | Count (week) | Notes |
|---|---|---|
| MATCHES_OUTLOOK | 63 | Ann's mirror minus masters — byte-faithful |
| OUTLOOK_EVENT_MISSING_FROM_APP | 0 | |
| APP_EVENT_NOT_IN_OUTLOOK | 6 (+6 twins) | all seriesMaster records |
| DUPLICATE_MIRROR_TWIN | 69 | synthetic.owner's copy of Ann's mailbox |
| DERIVED_CONFLICT_EVENT | frontend-only | generated from twin overlap |

## Proposed repair (approval required before any data change)

**Code (no approval needed — read-path fixes):**
1. Delta/initial sync: skip `type=seriesMaster` items (store occurrences and
   exceptions only). Regression test added.
2. Conflict detection: only active, visible, non-twin events.
3. Week view: 7 days; Outlook-only filter; visual refresh (Parts C–E).

**Data cleanup (SAFE — soft-delete only, nothing touches Outlook/Splose):**
- A. Tombstone the 12 seriesMaster rows (6 per mirror) — `is_deleted=TRUE`,
  reason recorded in sync_log. Reversible.
- B. Disconnect `synthetic.owner`'s Outlook connection and tombstone its
  entire duplicate mirror of Ann's mailbox (~5,000 rows incl. history) —
  removes the double-render permanently. Reversible (tombstones, not
  deletes). Ann's own mirror is untouched and remains the single source.
- Note: this exceeds the sync-safety auto-delete caps by design — it will be
  performed as an explicit, audited owner-approved operation, not by the
  automatic pipeline.

**Approval requested from the owner for A + B.**
