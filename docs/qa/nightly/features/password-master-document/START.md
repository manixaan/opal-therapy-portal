/opal-feature

**Idea:** A master doc that exists on onedrive with all accounts login details for all portals in use.
**Why:** Forgetting passwords, confusion surrounding login details.
**Who uses it:** Owner/Admin
**What they see:** (not yet written in the tracker)
**What should happen:** (not yet written in the tracker)
**Outcome:** All login details will be contained in one area accessed by relevant parties.
(No recorded decisions.)

## Where it lives today

Nothing yet. This describes an external OneDrive document, not a portal feature — confirmed by a repo-wide search for every plausible term.

## Start here

This is a decision for the team, not a coding task: decide whether a password/credential vault belongs inside the portal at all (a real feature, with its own threat model — storing login credentials is high-risk) or whether the OneDrive document should simply stay external and get updated directly. If the team decides it should be a portal feature, treat it as a new CRITICAL-level feature (credential storage) and scope it properly before writing any code.

## Done means

A team decision recorded in the tracker (build it in-portal, or keep it external) before any code is written.

Tracker: f1e01029-71d9-46fa-acc1-1c955cd86da2
