# Feature folders — index

One line per tracker idea. Stage and environment are the tracker's own;
evidence label is tonight's (2026-11-14). "Addressed" = commits since the
last audit (2026-11-13) touched the located files.

| Folder | Tracker stage | Evidence label | Addressed this window | START |
|---|---|---|---|---|
| `xero-integration-works/` | idea | tab-unproven | no | [START](xero-integration-works/START.md) |
| `update-opal-docs-register/` | idea | untouched | no | [START](update-opal-docs-register/START.md) |
| `report-templates/` | idea | tab-unproven | no | [START](report-templates/START.md) |
| `password-master-document/` | idea | untouched | no | [START](password-master-document/START.md) |
| `opa-mobile-companion/` | idea | proven | yes | [START](opa-mobile-companion/START.md) |
| `interactive-assessments/` | idea | tab-unproven | no | [START](interactive-assessments/START.md) |
| `employee-personal-page-my-profile-tab/` | idea | built-untested | no | [START](employee-personal-page-my-profile-tab/START.md) |
| `automated-reminders/` | idea | needs-refinement | no | [START](automated-reminders/START.md) |
| `professional-development/` | idea | tab-unproven | no | [START](professional-development/START.md) |
| `inductions/` | idea | proven | no | [START](inductions/START.md) |
| `clinical-resources/` | idea | proven | no | [START](clinical-resources/START.md) |
| `portal-onboarding-workflow/` | idea | proven (Stages 1-2); Stage 3 has no scope | no | [START](portal-onboarding-workflow/START.md) |
| `portal-splose-outlook-integration-works/` | idea | proven, 1 flagged gap | yes | [START](portal-splose-outlook-integration-works/START.md) |

## Tonight's counts

proven: 5 (Opa Mobile Companion, Inductions, Clinical resources, Portal
Onboarding Workflow, Portal-Splose-Outlook) · tab-unproven: 4 (Xero
Integration Works, Report Templates, Interactive Assessments, Professional
Development) · built-untested: 1 (Employee Personal Page) ·
needs-refinement: 1 (Automated Reminders) · untouched: 2 (Update Opal Docs
Register, Password Master Document) · broken: 0.

These match the 2026-11-13 audit's counts exactly (5/4/1/1/2/0) — every
targeted test was independently re-run tonight rather than copied forward,
and nothing changed: no commit since 2026-11-13 touched a file located
under any of these 13 features except Opa Mobile Companion
(`e222a77`) and Portal-Splose-Outlook (`8edfa9b`, `c1793d1`), neither of
which altered either feature's classification.
