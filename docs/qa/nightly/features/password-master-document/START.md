/opal-fast-change

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
Nothing — and nothing should. This describes an external OneDrive document, not a portal feature. The only codebase references near this idea are the portal's own password reset/create flows (reset-password.html, create-password.html, forgot-password.html) and Azure Key Vault entries in deploy scripts, both unrelated to a shared login-details vault.

## Start here
No engineering task applies. Create and share the OneDrive document directly, outside the portal.

## Done means
There is no test for this — it is done when the OneDrive document exists and is shared with the relevant parties. Evidence label stays `untouched` by design, not `proven`: nothing in this codebase will ever "prove" an external document.

Tracker: f1e01029-71d9-46fa-acc1-1c955cd86da2
