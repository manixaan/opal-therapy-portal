# XSS & Rendering Safety Notes

Stage 1 launch-blocker fix (2026-07-31) for audit finding H4: user-authored
and Splose-sourced fields were interpolated into `innerHTML` unescaped in
multiple renderers — under a CSP that allows `'unsafe-inline'` scripts, one
crafted string (e.g. a leave reason viewed on the owner's approval screen)
meant script execution across the privilege boundary.

## What was fixed (25 sink repairs in `frontend/current/mockup_v3.html`)

All now route through the existing global `escapeHtml()` helper:

| Surface | Fields escaped | Who authors → who views |
|---|---|---|
| Leave approval rows + tables | staff name, reason | therapist → **owner/admin** |
| CPD approval rows + tables | staff name, title, provider, notes, review comments | therapist → owner/admin (comments: owner → therapist) |
| PD documents table | title, file name | therapist → self (and future admin views) |
| Credentials cards | credential name, staff name, issuing body, registration number | therapist → owner/admin (verify screen) |
| Resource Hub cards | title, description, safety notes, resource type, tag names | staff → **all staff** |
| Resource external link | `external_url` now **scheme-allowlisted to http(s)** (kills `javascript:` hrefs) and attribute-escaped, `rel="noopener noreferrer"` | staff → all staff |
| Smart Booking patient cards | first/last name, suburb, postcode | **Splose data** → staff |
| Dormant clients table | first/last name, NDIS number, email | Splose data → owner/admin |
| Leave type / doc type label fallbacks | raw enum passthrough on unknown values | API-created rows → any viewer |

Already-safe surfaces verified and pinned (not changed): both notification
panel renderers, team-management list (names were already escaped), invite
pending list, email templates (server-side `escapeHtml` in `email.js`).

Also corrected while in these renderers: the leave approve/reject toasts no
longer claim "The staff member will be notified" (no notification exists
yet — the toast now says so).

## Approach

- Escape-on-render (output encoding), not sanitise-on-store: the API keeps
  raw text (data integrity), the DOM gets inert text. `escapeHtml()`
  handles `& < > "` and is null/number-safe. No intended-formatting
  surfaces exist in these fields, so nothing needed a sanitiser.
- URLs: only `external_url` renders as an attribute; it is allowlisted to
  `^https?://` and attribute-escaped.

## Tests

- `backend/tests/frontend-xss-guards.test.js` — static regression guards:
  asserts every fixed sink still wraps its fields in `escapeHtml(`, the
  exact pre-fix raw interpolations never reappear, the URL allowlist is
  present, the invite UI's truthful email states exist, and the
  notification renderers keep escaping. Crude by design (the 24k-line
  frontend has no JS test harness); if a renderer is refactored, update the
  guard alongside it.
- Staging smoke includes a live payload check: a leave request containing
  `<script>` stored via the API comes back as raw JSON (API untouched) and
  the served HTML contains the escaped renderer (execution path closed).

## CSP position (documented, deliberately not rewritten in Stage 1)

The helmet CSP still allows `'unsafe-inline'` script/style — required today
by the single-file frontend's hundreds of inline handlers. Escaping now
removes the known injection *sources*; the CSP remains the missing
second layer. The planned path (Stage 2+, sequenced with the
self-hosted-socket.io refresh fix): move to nonce-based script-src, which
requires consolidating inline handlers — real work on a 24k-line file, not
a Stage 1 change. Until then: every new render of user-influenced data MUST
use `escapeHtml()`; the static guard test is the tripwire.

## Residual risks (accepted for Stage 1, tracked)

- Unknown sinks: the pass covered every sink identified by the audit
  sweep plus verified-safe surfaces; the file is large and prototype-era
  views (hidden legacy tabs, dead code) were not exhaustively re-audited —
  they are slated for deletion instead.
- Calendar tile titles come from Outlook/Splose content through a mix of
  textContent and template paths; Outlook-sourced content is
  lower-adversarial but not zero — flagged for the Stage 2 pass.
- `'unsafe-inline'` CSP as above.
