# Nightly audit — feature folders index

One folder per tracker idea. `STATUS.md` is rewritten every night; `START.md` is the starter prompt (replaced with two lines once a feature is `proven`). See `docs/qa/nightly/README.md` for how this works.

Last updated: 2026-10-30, commit `338f5dc` (previous audit: 2026-10-29, commit `15acf0c`). Tonight's real window is 5 commits (travel/traffic-alerts feature, a travel-test timing fix, a mobile-diary dedup fix, and a case-note approval-on-edit fix + its laptop-UI revert). Only one tracker feature — Opa Mobile Companion — was touched by that window; every other "addressed" column below is `no`.

| Folder | Stage | Evidence label | Addressed since last audit | START.md |
|---|---|---|---|---|
| [portal-splose-outlook-integration-works](portal-splose-outlook-integration-works/STATUS.md) | idea | broken | no | [Start](portal-splose-outlook-integration-works/START.md) |
| [portal-onboarding-workflow](portal-onboarding-workflow/STATUS.md) | idea | broken | no | [Start](portal-onboarding-workflow/START.md) |
| [clinical-resources](clinical-resources/STATUS.md) | idea | tab-unproven | no | [Start](clinical-resources/START.md) |
| [inductions](inductions/STATUS.md) | idea | tab-unproven (2/3 sub-parts proven) | no | [Start](inductions/START.md) |
| [professional-development](professional-development/STATUS.md) | idea | needs-refinement | no | [Start](professional-development/START.md) |
| [automated-reminders](automated-reminders/STATUS.md) | idea | needs-refinement (mixed) | no | [Start](automated-reminders/START.md) |
| [employee-personal-page-my-profile-tab](employee-personal-page-my-profile-tab/STATUS.md) | idea | needs-refinement | no | [Start](employee-personal-page-my-profile-tab/START.md) |
| [interactive-assessments](interactive-assessments/STATUS.md) | idea | tab-unproven | no | [Start](interactive-assessments/START.md) |
| [opa-mobile-companion](opa-mobile-companion/STATUS.md) | idea | needs-refinement | **yes** | [Start](opa-mobile-companion/START.md) |
| [password-master-document](password-master-document/STATUS.md) | idea | untouched | no | [Start](password-master-document/START.md) |
| [report-templates](report-templates/STATUS.md) | idea | tab-unproven | no | [Start](report-templates/START.md) |
| [update-opal-docs-register](update-opal-docs-register/STATUS.md) | idea | untouched | no | [Start](update-opal-docs-register/START.md) |
| [xero-integration-works](xero-integration-works/STATUS.md) | idea | tab-unproven | no | [Start](xero-integration-works/START.md) |

**Note:** the tracker's `stage` field reads `idea` for all 13 cards, same as every prior night — this is a standing tracker-hygiene gap, not specific to any one card. Eleven of the 13 already have built, guarded, and (mostly) tested code in the repository.
