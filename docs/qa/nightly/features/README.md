# Nightly audit — feature folder index

One folder per tracker idea. `STATUS.md` is rewritten every night; `START.md` is a starter
prompt, replaced with a two-line "proven" note once a card reaches that label. See
`scripts/nightly-audit/PROMPT.md` for what each evidence label means.

| Folder | Tracker stage | Evidence label | Addressed since last audit | START.md |
|---|---|---|---|---|
| [opa-mobile-companion](opa-mobile-companion/START.md) | idea | needs-refinement | no | [open](opa-mobile-companion/START.md) |
| [portal-splose-outlook-integration-works](portal-splose-outlook-integration-works/START.md) | idea | needs-refinement | no | [open](portal-splose-outlook-integration-works/START.md) |
| [automated-reminders](automated-reminders/START.md) | idea | built-untested | no | [open](automated-reminders/START.md) |
| [portal-onboarding-workflow](portal-onboarding-workflow/START.md) | idea | needs-refinement | no | [open](portal-onboarding-workflow/START.md) |
| [clinical-resources](clinical-resources/START.md) | idea | **proven** | no | [open](clinical-resources/START.md) |
| [inductions](inductions/START.md) | idea | needs-refinement | no | [open](inductions/START.md) |
| [professional-development](professional-development/START.md) | idea | built-untested | no | [open](professional-development/START.md) |
| [employee-personal-page-my-profile-tab](employee-personal-page-my-profile-tab/START.md) | idea | built-untested | no | [open](employee-personal-page-my-profile-tab/START.md) |
| [interactive-assessments](interactive-assessments/START.md) | idea | tab-unproven | no | [open](interactive-assessments/START.md) |
| [password-master-document](password-master-document/START.md) | idea | untouched | no | [open](password-master-document/START.md) |
| [report-templates](report-templates/START.md) | idea | tab-unproven | no | [open](report-templates/START.md) |
| [update-opal-docs-register](update-opal-docs-register/START.md) | idea | untouched | no | [open](update-opal-docs-register/START.md) |
| [xero-integration-works](xero-integration-works/START.md) | idea | tab-unproven | **yes** | [open](xero-integration-works/START.md) |

Last updated: 2026-11-28, commit `d8c861c`. 14 commits landed since the last audit
(2026-11-26, commit `f5fc28d`): 4 `feat(invoicing)` (touch Xero Integration Works — see
that card), 5 `fix/feat(calendar)` and 5 `feat(assist)` (neither has a tracker card — see
tonight's brief, §6). Every label above was independently re-verified against the current
code and tests tonight, not carried forward from last night's write-up.
