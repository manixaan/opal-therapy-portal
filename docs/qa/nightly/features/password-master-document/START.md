/opal-fast-change

**Idea**: A master doc that exists on onedrive with all accounts login details for all portals in
use.

**Why**: Forgetting passwords, confusion surrounding login details.

**Who uses it**: Owner/Admin

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: All login details will be contained in one area accessed by relevant parties.

**Decisions**: (none recorded)

**Tracker's next_action**: "Maintain the OneDrive document directly, or write a new scoped card
if an in-portal credential area is wanted."

## Where it lives today

Nothing yet — and nothing should be built here unless the team decides it wants an in-portal
credential store instead of the OneDrive document.

## Start here

Not a coding task. If the team ever wants this moved into the portal (a credentials vault for
Owner/Admin), that would be a new, clearly-scoped CRITICAL-level card — storing login secrets in
the application's own database is a materially different risk profile from a OneDrive document,
and deserves its own decision, not a quiet addition to this one.

## Done means

Either the OneDrive document stays the design (no code), or a new tracker card is written for an
in-portal credential area with its own scope and security review.

Tracker: f1e01029-71d9-46fa-acc1-1c955cd86da2
