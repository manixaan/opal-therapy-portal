No Claude Code skill applies — this is not a coding task, so it is not prefixed with /opal-fast-change, /opal-feature or /opal-critical.

## Idea
A master doc that exists on onedrive with all accounts login details for all portals in use.

## Why
Forgetting passwords, confusion surrounding login details.

## Who uses it
Owner/Admin

## What they see
(not yet written in the tracker)

## What should happen
(not yet written in the tracker)

## Outcome
All login details will be contained in one area accessed by relevant parties.

## Decisions
(none recorded)

## Where it lives today
Nothing — this card describes an external OneDrive document, not portal
code.

## Start here
Maintain the OneDrive document directly: one row per account/portal with
its login details, shared only with Owner/Admin. If an in-portal credential
store is wanted instead of (or alongside) the OneDrive document, that is a
new, separately scoped card — it would hold live account passwords, a
different risk class to anything else in this tracker, and needs its own
security review before any code is written. Do not fold that into this
card.

## Done means
The OneDrive document exists, is current, and only Owner/Admin can open it.
This never becomes a code "proven" state unless a new scoped card for an
in-portal store is written and built.

Tracker: f1e01029-71d9-46fa-acc1-1c955cd86da2
