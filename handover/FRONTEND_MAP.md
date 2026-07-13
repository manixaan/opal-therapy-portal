# FRONTEND_MAP.md — `frontend/current/mockup_v3.html`

> 23,868 lines. One file = all HTML + CSS + JS for the main app. No framework, no build, no modules.
> Served at `GET /` (auth-guarded). Auxiliary auth pages are separate small files (see PROJECT_TREE).
> Line numbers are from commit `5581ab1` and are approximate anchors, not exact contracts.

## Entry & boot sequence
1. HTML parsed; inline `<script>` blocks run top-to-bottom.
2. Google Maps SDK loaded dynamically via `GET /api/maps/sdk-url` (no key in HTML) → `onGoogleMapsReady`.
3. Socket.IO connects (same origin) → joins `user:<id>` server-side.
4. `GET /api/auth/me` → `window.APP_USER`; `GET /api/settings` → `window.APP_SETTINGS` / `APP_ORG_SETTINGS`.
5. `loadOutlookEventsToCalendar()` → `GET /api/events` → `window.__outlookEventsCache` → render current week.
6. `bootstrapSploseConfig()` (~:7208) → services / practitioners / locations / busy-time-types / categories.
7. Tab handlers wired; default view = Smart Booking.

## Major sections (tab → view id → loader)
| Tab | View | Primary loader / behaviour |
|---|---|---|
| My Profile | `#view-profile` | APP_USER + `/api/profile/*` (leave, cpd, credentials, documents, work-schedule) |
| Smart Booking | `#view-book` | wizard (see below) |
| Calendar | `#view-calendar` | `loadOutlookEventsToCalendar` + Splose merge; week/day/month modes |
| Contacts | `#view-contacts` | Splose patients/contacts |
| Activity | `#view-activity` | Splose appointments feed |
| Billing | `#view-billing` | Splose invoices/payments (owner/admin) |
| NDIS | `#view-ndis` | Splose cases |
| Dormant | `#view-dormant` | `/api/splose/dormant-cases` |
| Travel | `#view-travel` | Google Maps routes/places |
| Logbook | `#view-logbook` | `/api/splose/support-items` |
| Settings | `#view-settings` | `/api/settings*`, integrations, user management |
| (hidden) Auto-fit | `#view-autofit` | `display:none!important` + org-flag disabled — **dormant/planned** |

## Global variables & state (verified via grep)

### `window.*` application config/state
`APP_USER`, `APP_SETTINGS`, `APP_ORG_SETTINGS`, `OUTLOOK_CATEGORY_COLOURS`, `SPLOSE_CONFIG` (practitionerId/locationId/services/busyTimeTypes, filled at boot), `WEEK_START`, `ATO_RATE`, `DEFAULT_APPT_DURATION`, `DEFAULT_BOOKING_TYPE`, `DORMANT_WEEK_THRESHOLD`, `RPT_WEEKLY_TARGET_H`, `TRAVEL_WARN_MIN`, `NOTIF_FILTER`.

### `window.__*` runtime/calendar state
`__outlookEventsCache` (raw `/api/events` array — the client-side event cache), `__currentWeekMonday` (visible week anchor, UTC-midnight Date), `__selectedDate`, `__currentDayOffset`, `__currentMonthAnchor`, `__calendarMode` ('week'|'day'|'month'), `__notifications`, `__syncInFlight`, `__travelBlocksPushed`, `__notesCurrentId`, `__bdCurrentSessionId`.

### Module-scope state objects
- `SESSIONS` (`:11133`, `const SESSIONS = {}` — also aliased to `window.SESSIONS`): id → `{...eventFields, element}`. **The calendar canvas model.** Holds a merge of DB events + live Splose appointments + optimistic bookings. This is the client-side "unified" store that ARCHITECTURE flags should eventually be replaced by a backend-reconciled feed.
- `PATIENTS` (`:6955`, `let PATIENTS = []`): Splose patient list for the picker.
- `BOOKING_STATE` (`:10522`): Smart Booking wizard state — `category`, `selectedPatient`, `selectedSessionType`, `selectedSlot`, `selectedCaseId`, `prefillTime`, `formData{}`, `timingFields`.
- `_bspPrefill` / `_bspSelectedTherapist` / `_bspDurManual`: booking-panel (drag-to-book) state.
- `DAY_DATES` / `DAY_LABELS` (`:7190`): current week's day-key → ISO date / label; **mutated on every week navigation** by `__renderWeekHeader` (this was the source of the "wrong date" bug — fixed).

### Storage
- **localStorage** (13 uses, 4 distinct keys):
  - `opal_calendar_week` — persists the viewed week across refresh (`_saveWeekPos`/restore in loadOutlookEventsToCalendar).
  - `manual_addr_splose_<sploseId>` — manual routing-address overrides for **Splose-only** sessions (⚠ browser-local only; not synced to DB or other devices — KNOWN_ISSUES #15).
  - `session_note_<id>` — free-text per-session notes (⚠ browser-local only, never persisted server-side).
  - (Outlook-backed events save location overrides via the DB PATCH route, not localStorage.)
- **sessionStorage**: `SploseSync` module cache (`_key(module)` → cached payload + timestamp, the stale-while-revalidate layer) and `GAP_DISMISSED_KEY` (dismissed idle-gap suggestions for the session).

### Socket.IO events (client)
`connect`, `disconnect`, `error` (connection status UI) and **`calendarUpdated`** → `loadOutlookEventsToCalendar()` (the live-refresh trigger; added commit `e467444`).

## Key rendering functions
- `renderCurrentWeek()` (`:15780`) — clears + repaints the visible week from `__outlookEventsCache` (via `__eventsInVisibleWeek`), groups by day, calls `renderToday`, then conflict/rural decorations.
- `__renderWeekHeader()` (`:15258`) — writes day-number headers AND syncs `DAY_DATES`/`DAY_LABELS` + BSP day-chip labels for the visible week.
- `addSession(col, opts)` (`:11262`) — creates a tile DOM node, registers it in `SESSIONS`, wires interactivity (drag/resize/right-click), reflows overlaps.
- `renderToday()`, `renderCalendarPreviewBlocks()`, `renderSlotSuggestions()`, `renderConfirmSummary()`, `renderRightContext()`.
- `SploseSync` service (`~:16416`) — sessionStorage-cached, rate-limit-aware fetch wrapper with per-module TTLs and visibility-change refresh.

## Key event handlers
- `switchTab(tab)` / `_rawSwitchTab` — view switching + per-tab lazy load.
- `_calColPointerDown/Move/Up` (`~:9563`) — calendar drag-to-create.
- `attachBlockInteractivity` (`:11914`) — per-tile pointerdown (click vs drag vs resize), keyboard, **contextmenu → `showCalContextMenu` → `ctxDeleteEvent`**.
- `openBookingPanel` / `closeBookingPanel` (`~:18815`) — drag-to-book slide-over (`_bspPrefill`).
- `goStep(n)` / `step1Next()` / `goStepBack4()` — Smart Booking wizard nav.
- `confirmBooking()` (`:10698`) — the write path (Splose + Outlook + local canvas).
- `bdDeleteEvent` / `bdRecalc` — detail-drawer edit/delete.
- `gotoPrevWeek/NextWeek/ThisWeek/WeekOf` — week nav (+ localStorage persist).

## Flow anchors
- **Smart Booking**: `selectBookingCat` → `step1Next` → (client: step 2 type → step 3 `renderSlotSuggestions` → step 4) / (non-client: straight to step 4) → `confirmBooking`. Duration/day/time read live from BSP panel + `_bspPrefill` merge.
- **Master calendar** (owner/admin): `loadMasterCalendar` → `GET /api/calendar/master` → multi-therapist overlay (dormant — no profiles).
- **Employee calendar**: `loadOutlookEventsToCalendar` → `GET /api/events` → `renderCurrentWeek`.
- **User management** (owner): Settings → `GET /api/admin/users` (**broken**) + PATCH approve/role/suspend/activate.
- **Settings**: `GET/PATCH /api/settings`, integrations status, change-password (**broken**), org settings.
- **Onboarding** (`onboarding.html`, separate file): step wizard → `complete-onboarding-step`; Outlook step **broken route**.

## Modularisation targets (for Phase 9)
The single file cleanly separates into: (1) calendar engine (grid, week maths, SESSIONS, render*), (2) SploseSync service, (3) Smart Booking wizard, (4) notifications UI, (5) settings, (6) profile/HR panels, (7) travel/maps, (8) a shared `api.js` (one `API_BASE`, one fetch wrapper — would also kill the hardcoded-localhost problem). No shared build tooling exists yet; introducing ES modules + a bundler (or just `<script type=module>` splits) is the first step.
