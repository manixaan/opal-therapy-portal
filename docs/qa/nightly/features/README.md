# Nightly audit — feature folder index

One folder per Opal Development Manager tracker idea. `STATUS.md` is
rewritten every night; `START.md` is a starter prompt (replaced with a
two-line "proven" note once a feature reaches that label). Full method:
`scripts/nightly-audit/PROMPT.md`.

| Folder | Tracker stage | Evidence label | Addressed this window (09-24→09-25) | START.md |
|---|---|---|---|---|
| [xero-integration-works](xero-integration-works/) | idea | tab-unproven | no | [Start](xero-integration-works/START.md) |
| [update-opal-docs-register](update-opal-docs-register/) | idea | untouched | no | [Start](update-opal-docs-register/START.md) |
| [report-templates](report-templates/) | idea | tab-unproven | no | [Start](report-templates/START.md) |
| [professional-development](professional-development/) | idea | tab-unproven | no | [Start](professional-development/START.md) |
| [portal-splose-outlook-integration-works](portal-splose-outlook-integration-works/) | idea | tab-unproven | no | [Start](portal-splose-outlook-integration-works/START.md) |
| [portal-onboarding-workflow](portal-onboarding-workflow/) | idea | needs-refinement | no | [Start](portal-onboarding-workflow/START.md) |
| [password-master-document](password-master-document/) | idea | untouched | no | [Start](password-master-document/START.md) |
| [opa-mobile-companion](opa-mobile-companion/) | idea | tab-unproven | no | [Start](opa-mobile-companion/START.md) |
| [interactive-assessments](interactive-assessments/) | idea | tab-unproven | no | [Start](interactive-assessments/START.md) |
| [inductions](inductions/) | idea | needs-refinement | no | [Start](inductions/START.md) |
| [employee-personal-page-my-profile-tab](employee-personal-page-my-profile-tab/) | idea | tab-unproven | no | [Start](employee-personal-page-my-profile-tab/START.md) |
| [clinical-resources](clinical-resources/) | idea | proven | no | [Proven](clinical-resources/START.md) |
| [automated-reminders](automated-reminders/) | idea | tab-unproven | no | [Start](automated-reminders/START.md) |

Counts: 1 proven · 8 tab-unproven · 2 needs-refinement · 2 untouched · 0 built-untested · 0 broken
(unchanged from every prior night since 2026-09-22, at both the label level and the underlying
evidence — this was another completely quiet window: `develop` did not move at all since the last
audit, sitting on commit `74601fc` for the fourth night running, and the tracker itself was untouched
by any human since the 2026-09-24 write-back. Every feature was re-verified fresh tonight anyway:
targeted unit and integration tests re-run from a cold state by this session, all passing with the
same two known non-code sandbox artifacts as every prior night since 2026-09-20 — see the morning
brief's §7).

Untracked, no matching feature card: **Opal Assist** (`backend/assist-routes.js`,
`backend/assist/`, `frontend/current/assist*`) — flagged for an **eighth** consecutive night; still no
tracker card, still no browser/E2E coverage.
