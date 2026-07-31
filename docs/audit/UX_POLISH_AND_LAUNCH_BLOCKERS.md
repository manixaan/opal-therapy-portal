# UX Polish & Launch Blockers

Reviewed as if a new employee opens the app on day one. Overall: **11 of 13
tabs are wired to real backend data with loading/error states — this is far
more product than prototype — but the prototype scar tissue is exactly
where a new user's trust forms.** The app currently: renders in quirks mode
from a corrupted DOCTYPE, titles itself "v2 Mockup", greets the user with a
hardcoded "Ann · Mon 20 Apr – Fri 24 Apr 2026" booking screen, shows a
permanently fake "Synced with Splose · 14s ago" pill, contains one fully
dead tab, and reports success for at least four actions that do nothing.

**General assessment**
- Visual polish: good bones (consistent card/table language, Settings and
  Profile genuinely professional); two brand palettes clash (login indigo
  vs app cyan).
- Navigation: 13 top tabs is too many for a therapist; three are named
  "Travel"-something; several are admin-only concepts leaking into view.
- Speed: fine at this scale; Splose-heavy tabs hang on cold cache (2 req/s
  throttle) with good SWR indicators on six tabs, none on booking/calendar.
- Empty states: good on data tabs (Retry buttons); missing on first-run
  ("what do I do first?") — no dashboard/home exists.
- Errors: raw internal messages leak ("Splose write-back disabled (set
  ENABLE_SPLOSE_WRITE=true)"); several silent failures (CSP-blocked chart).
- Mobile/tablet: not supported (1 media query in 24,460 lines; nav can't
  wrap). Laptop-only is acceptable for launch if stated.
- Mac/laptop: fine on evergreen Chromium; Safari/Firefox untested.
- Feel: an experienced eye sees a strong internal tool mid-hardening; a new
  employee sees "Mockup" in the browser tab and a dead Flights tab. First
  impressions are cheap to fix and currently squandered.

## Ranked polish list

| Priority | Issue | Why it matters | Recommended fix | Effort |
|---|---|---|---|---|
| P0 | Corrupted DOCTYPE with stray button spliced into line 1–2 (committed at HEAD) → quirks mode for everyone | Layout becomes browser-dependent; a stray Outlook-only button renders at page top for owner/admin | Repair `<!DOCTYPE html>`; move #btn-outlook-only into the calendar toolbar | XS |
| P0 | Fake success flows: booking with missing fields shows success-styled "Booking recorded" and does nothing (mockup 9633-9640); case-noting scheduler (10852) and idle-gap "Add block" (23482) toast success, persist nothing; "staff will be notified" on leave decisions is false | The app lies. A clinician plans their week around blocks that vanish and tells clients they're booked when they aren't | Make each either real or an explicit "not available yet" message | S |
| P0 | Bookings attributed to practitioners[0] = Ann for every user; confirm screen hardcodes "Practitioner: Ann Mary Mathew" (7794, 8363) | Second therapist's bookings would be clinically/billing-wrong from day one | Resolve practitioner from the logged-in user's splose_practitioner_id; block booking if unmapped; de-hardcode | S–M |
| P0 | No data refresh after page load: zero polling; socket.io + Chart.js CDNs blocked by CSP (server.js:95-101 vs mockup 15137/18797); header pill fakes "Synced · 14s ago" | The calendar is a frozen snapshot while claiming freshness — drive-to-cancelled-session territory | Self-host socket.io (or add a 60s poll), make the pill real or delete it, self-host/remove Chart.js | S |
| P0 | Travel & Flights tab is a dead stub for all roles — both buttons call functions that don't exist (4665, 4670) | Instant ReferenceErrors + credibility loss in week one | Hide the tab (one line) now; decide fate later | XS |
| P0 | Invite modal claims "They'll receive an email" + toast "Invite sent!" when no email exists; backend's registerUrl ignored (22044-22065) | The owner's very first onboarding action silently fails | Handle emailSkipped: show + copy the registration link | S |
| P1 | Default landing = Smart Booking wizard with frozen April-2026 header (3603); no home/dashboard | New user's first screen is a broken-looking prototype page | Land therapists on Calendar; owner on Master/Team; defer a real dashboard | S |
| P1 | Stale April-2026 date constants drive block-detail Day row, travel labels, move-session confirm (11720→12602, 13371, 13735); planEndsSoon frozen at 2026-04-20 (7593) | Wrong dates in real dialogs; wrong NDIS plan-expiry warnings | Replace constants with live date derivation | S |
| P1 | Hardcoded identity: header badge "Ann Mary Mathew / OT · Willetton WA" (3275-3281); "Monday's schedule — Ann" headings (12108-12172) | Every other user is labelled as Ann | Bind to APP_USER; remove legacy Today view | S |
| P1 | Cancelled-session drawer: "Open reschedule inbox" blanks the entire app (12688); bare Reschedule button has no handler (12669) | Looks like a crash, on an emotionally-charged path | Fix or remove both actions | XS |
| P1 | Duplicate showToast definitions — later (msg, isError) wins; 34 two-string call sites lose subtitles and render as error-styled (10060 vs 21911) | Broken/alarming toasts across the app | Unify to one signature | XS |
| P1 | Browser tab title "Opal Therapy Scheduler — v2 Mockup" (line 6); file served as mockup_v3.html | First impression: "I was given a prototype" | Retitle; serve at /app (keep file name internally if needed) | XS |
| P1 | Session notes + manual addresses saved to localStorage while showing "Saved · HH:MM" (13136-13152, 12920) | Clinical text on one unmanaged device; lost on browser clear; invisible to colleagues | Short-term: label honestly ("saved on this device only"); proper fix: server persistence | XS / M |
| P1 | Activity tab shows practice invoice/payment amounts to therapists (17853-17866) | Contradicts the financial-visibility model | Backend-gate (preferred) or admin-only the tab | S |
| P1 | Notification badge fetched once per session (21179-21193) | Approvals/safety alerts invisible until reload | 60s poll of /api/notifications | XS |
| P1 | Raw flag/error strings surface to users ("set ENABLE_SPLOSE_WRITE=true", axios internals) | Alarming, unprofessional | Map to friendly read-only-mode messages | S |
| P2 | 13-tab nav for therapists incl. three "Travel" concepts; role labels render raw `read_only` | Cognitive load + rough edges | Trim therapist tab set; label map | S |
| P2 | No responsive support (846-854 nav; single media query 3014) | Phones/tablets unusable | Post-pilot responsive pass; state laptop-only at launch | L |
| P2 | Brand split: login indigo #5b6af0 vs app cyan #00a8cc | Feels like two products | Unify tokens | S |
| P2 | Search fires per keystroke, no debounce (4247); no retry on Activity/Billing failures | Minor jank | Debounce; add Retry | XS |
| P2 | Dead code visible to maintainers: renderPatientsTable + MOCK_CLIENTS + hidden legacy views; 1,140 lines of dead backend scripts; frontend/archive 512K | Confuses every future fix; live-API footgun scripts | Delete in a cleanup PR | S |
| P3 | Emoji role badges/⏻ sign-out glyph; no proper account menu | Cosmetic | Later | S |
| P3 | Settings advertises "MFA" that doesn't exist (app-routes.js:1094) | Over-promise | Remove word or build MFA | XS |
| P3 | PWA/installability, dashboards, month-view perf | Nice-to-haves | Post-pilot | — |

**Cross-references:** functional blockers that read as UX but are backend
(dead email, Splose RBAC, therapist_profile creation, Outlook
masked-connect state, Resource Hub upload limit) are tracked in the
readiness matrix and SECURITY audit — they outrank everything in this file.
