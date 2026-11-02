# Password Master Document

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **untouched**
- Addressed this window (since 2026-11-01): no
- Created (any located code): no

## Reason

This card describes an external OneDrive document holding login details for
all portals in use — not a portal feature. A search under `backend/` and
`frontend/current/` for password-vault / credential-register style code
found nothing, and none is implied by the idea text. Building an in-portal
credential store would be its own properly scoped, security-reviewed card
(it would hold live account passwords, which is a different risk class to
anything else in this tracker).

## Located files

None.

## Tests and results

Not applicable — no code to test.

## Open tasks from the tracker

None recorded.

## Commits in window that touched it

None — there is nothing in this repository for this card to touch.

## Disagreement

None. The tracker's own `claude_update` already correctly says this needs a
new, separately scoped card before any code is written, not this one.
