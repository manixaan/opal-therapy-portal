# Nightly tracker audit — how it works

A scheduled cloud agent runs every night at 2am Perth time. It reads the Opal
Development Manager tracker, checks each feature against this repository,
and leaves a morning brief here as `YYYY-MM-DD.md` (and `LATEST.md`) on the
branch `claude/nightly-audit`, with a pull request that is never merged.

**Concepts**

- *Tracker* — the Development Manager's `features` and `tasks` (Supabase).
  The agent reads it through the REST API using a key held by the cloud
  environment, never by the agent or this repo.
- *Evidence label* — what the code proves: `proven`, `built-untested`,
  `needs-refinement`, `broken`, `untouched`, `tab-unproven`. Defined in
  `scripts/nightly-audit/PROMPT.md`.
- *Disagreement* — the tracker stage claims more than the evidence supports.
  The agent reports it; a person decides what to do.
- *Report only* — the agent changes nothing outside this folder and writes
  nothing back to the tracker. Write-back is a later, opt-in step.
- *Weekly deep run* — Sunday UTC (Monday morning Perth) also runs the full
  unit and integration suites. Other nights run only targeted tests.

**Pieces**

| Piece | Where |
|---|---|
| Agent prompt | `scripts/nightly-audit/PROMPT.md` |
| Tracker fetch | `scripts/nightly-audit/fetch-tracker.mjs` |
| Schedule | claude.ai → Code → Routines ("Nightly tracker audit") |
| Environment | claude.ai cloud environment: `SUPABASE_URL` variable, Supabase key as an API credential for `*.supabase.co`, network access "Custom" allowing `*.supabase.co` |

**If a brief says DID NOT RUN**, the first line names the reason; the usual
causes are the environment credential, the network allowlist, or GitHub
access for the repository.
